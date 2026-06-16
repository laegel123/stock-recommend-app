import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { Market, Source, EventType, InvestorType } from '@app/shared';
import * as schema from '../../src/db/schema';

/**
 * Phase 0 slice 2 — Drizzle 스키마 전체의 결정적(DB 불필요) 골든 계약 테스트.
 * `getTableConfig` 로 스키마 객체를 introspection 하여 ARCH §5 데이터 모델과 1:1 검증한다.
 * Docker/Postgres 없이도 그린이어야 한다(스키마는 순수 메타데이터).
 */

/** export 이름 → SQL 테이블명. ARCH §5 의 13개 테이블 전체. */
const TABLES: ReadonlyArray<readonly [PgTable, string]> = [
  [schema.investors, 'investors'],
  [schema.securities, 'securities'],
  [schema.cusipMap, 'cusip_map'],
  [schema.corpCodeMap, 'corp_code_map'],
  [schema.fxRates, 'fx_rates'],
  [schema.filings, 'filings'],
  [schema.holdings, 'holdings'],
  [schema.activityEvents, 'activity_events'],
  [schema.positionChanges, 'position_changes'],
  [schema.consensusScores, 'consensus_scores'],
  [schema.prices, 'prices'],
  [schema.benchmarks, 'benchmarks'],
  [schema.investorPerformance, 'investor_performance'],
];

/** 테이블의 컬럼명 → 컬럼 메타 맵. */
function columnsOf(
  table: PgTable,
): Record<string, ReturnType<typeof getTableConfig>['columns'][number]> {
  return Object.fromEntries(getTableConfig(table).columns.map((c) => [c.name, c]));
}

/** 테이블의 unique 제약을 "정렬된 컬럼명 join" 문자열 집합으로. */
function uniqueColumnSets(table: PgTable): string[] {
  return getTableConfig(table).uniqueConstraints.map((u) =>
    u.columns
      .map((c) => c.name)
      .sort()
      .join(','),
  );
}

const key = (...cols: string[]): string => cols.sort().join(',');

describe('drizzle schema — 테이블 표면', () => {
  it.each(TABLES)('테이블 "%o" 가 SQL 명 %s 으로 존재한다', (table, sqlName) => {
    expect(table).toBeDefined();
    expect(getTableConfig(table).name).toBe(sqlName);
  });

  it('ARCH §5 의 13개 테이블이 모두 정의되어 있다', () => {
    expect(TABLES).toHaveLength(13);
  });
});

describe('drizzle enums — @app/shared 단일 진실원 미러(ADR-0006)', () => {
  it('market / source / event_type / investor_type 가 shared Zod enum 과 1:1', () => {
    expect([...schema.marketEnum.enumValues]).toEqual(Market.options);
    expect([...schema.sourceEnum.enumValues]).toEqual(Source.options);
    expect([...schema.eventTypeEnum.enumValues]).toEqual(EventType.options);
    expect([...schema.investorTypeEnum.enumValues]).toEqual(InvestorType.options);
  });

  it('DB 전용 enum(form_type/change_type/intent/confidence) 값이 ARCH 와 일치', () => {
    expect([...schema.formTypeEnum.enumValues]).toEqual([
      '13F-HR',
      '13F-HR/A',
      '4',
      'SC 13D',
      'SC 13G',
      '13D/A',
      '13G/A',
      'majorstock',
      'elestock',
    ]);
    expect([...schema.changeTypeEnum.enumValues]).toEqual(['NEW', 'ADD', 'REDUCE', 'EXIT', 'HOLD']);
    expect([...schema.intentEnum.enumValues]).toEqual(['active', 'passive']);
    expect([...schema.confidenceEnum.enumValues]).toEqual(['exact', 'fuzzy', 'manual']);
  });
});

describe('drizzle schema — 멱등 unique 키(ADR-0002, 인제스트 재실행 안전)', () => {
  it('filings 는 (investor_id, accession_number) 가 unique', () => {
    expect(uniqueColumnSets(schema.filings)).toContain(key('investor_id', 'accession_number'));
  });

  it('activity_events 는 (investor_id, accession_number, security_id) 가 unique', () => {
    expect(uniqueColumnSets(schema.activityEvents)).toContain(
      key('investor_id', 'accession_number', 'security_id'),
    );
  });

  it('position_changes 는 (investor_id, security_id, quarter) 가 unique', () => {
    expect(uniqueColumnSets(schema.positionChanges)).toContain(
      key('investor_id', 'security_id', 'quarter'),
    );
  });

  it('consensus_scores 는 (security_id, quarter) 가 unique', () => {
    expect(uniqueColumnSets(schema.consensusScores)).toContain(key('security_id', 'quarter'));
  });
});

describe('drizzle schema — 핵심 컬럼/제약', () => {
  it('activity_events(빠른 레인 척추)의 필수 컬럼이 NOT NULL', () => {
    const cols = columnsOf(schema.activityEvents);
    for (const name of ['investor_id', 'security_id', 'event_type', 'event_date', 'filing_date']) {
      expect(cols[name], `컬럼 ${name}`).toBeDefined();
      expect(cols[name]!.notNull, `${name} NOT NULL`).toBe(true);
    }
    // 소스별 뉘앙스는 nullable(ADR-0002)
    expect(cols['price_per_share']!.notNull).toBe(false);
    expect(cols['intent']!.notNull).toBe(false);
  });

  it('holdings(느린 레인 척추)의 shares/quarter 가 NOT NULL', () => {
    const cols = columnsOf(schema.holdings);
    expect(cols['shares']!.notNull).toBe(true);
    expect(cols['quarter']!.notNull).toBe(true);
  });

  it('investors.parent_investor_id 는 investors 를 self-reference(ADR-0010, NPS 이중집계 방지)', () => {
    const fks = getTableConfig(schema.investors).foreignKeys;
    const selfRef = fks.some((fk) => {
      const ref = fk.reference();
      return (
        getTableConfig(ref.foreignTable).name === 'investors' &&
        ref.columns.some((c) => c.name === 'parent_investor_id')
      );
    });
    expect(selfRef).toBe(true);
  });

  it('holdings.filing_id 는 filings 를 참조(느린 레인 스냅샷 연결)', () => {
    const fks = getTableConfig(schema.holdings).foreignKeys;
    const refsFilings = fks.some(
      (fk) => getTableConfig(fk.reference().foreignTable).name === 'filings',
    );
    expect(refsFilings).toBe(true);
  });
});

describe('drizzle 마이그레이션 — 생성·커밋 확인(PLAN Phase 0-2)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const drizzleDir = join(here, '..', '..', 'drizzle');

  it('drizzle/*.sql 마이그레이션이 13개 테이블 CREATE TABLE 을 모두 포함', () => {
    const sql = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(drizzleDir, f), 'utf8'))
      .join('\n');
    for (const [, sqlName] of TABLES) {
      expect(sql, `CREATE TABLE ${sqlName}`).toContain(`CREATE TABLE "${sqlName}"`);
    }
  });
});
