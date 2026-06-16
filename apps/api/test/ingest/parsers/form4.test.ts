import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseForm4, mapTransactionToEventType } from '../../../src/ingest/parsers/form4';
import type { ParsedForm4 } from '../../../src/ingest/parsers/form4';

/**
 * Form 4 파서 골든 테스트(RED → GREEN, ADR-0012/0014, PLAN §검증).
 *
 * **실제** SEC 공시 fixture 로 회귀를 막는다. 파서는 순수 함수(raw XML → 정규화 행);
 * 식별자 해소(CIK/CUSIP→investor/security)·집계·멱등은 인제스트 레이어 책임.
 * 커버리지: 매수(P)·매도(S, 부호 음수)·파생 거래(Table II)·보유 제외·다중/누락 관계 플래그·스키마 버전.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', '..', 'fixtures', 'form4');

function loadFixture(base: string): { xml: string; expected: ParsedForm4 } {
  const xml = readFileSync(join(fixtures, `${base}.xml`), 'utf8');
  const expected = JSON.parse(
    readFileSync(join(fixtures, `${base}.expected.json`), 'utf8'),
  ) as ParsedForm4;
  return { xml, expected };
}

describe('parseForm4 — 버크셔 OXY 매수 골든(비파생 P, 보유 제외)', () => {
  const { xml, expected } = loadFixture('berkshire-oxy-2022-03-16');

  it('정규화 출력이 expected 와 정확히 일치', () => {
    expect(parseForm4(xml)).toEqual(expected);
  });

  it('발행사·다중 보고인을 추출(이중집계는 인제스트가 처리, ADR-0015)', () => {
    const parsed = parseForm4(xml);
    expect(parsed.issuer).toEqual({
      cik: '797468',
      name: 'OCCIDENTAL PETROLEUM CORP /DE/',
      tradingSymbol: 'OXY',
    });
    expect(parsed.reportingOwners.map((o) => o.cik)).toEqual(['1067983', '315090']);
    expect(parsed.reportingOwners.every((o) => o.isTenPercentOwner)).toBe(true);
  });

  it('거래만 이벤트로 — 우선주·워런트 보유(holding)는 제외, 7건 전부 BUY(+)', () => {
    const parsed = parseForm4(xml);
    expect(parsed.events).toHaveLength(7);
    expect(parsed.events.every((e) => e.eventType === 'BUY')).toBe(true);
    expect(parsed.events.every((e) => e.transactionCode === 'P')).toBe(true);
    expect(parsed.events.every((e) => e.sharesDelta > 0)).toBe(true);
  });

  it('CIK 은 0패딩 제거 → investors.external_id(시드) 형식', () => {
    const parsed = parseForm4(xml);
    expect(parsed.issuer.cik).toBe('797468'); // XML: 0000797468
    expect(parsed.reportingOwners[0]!.cik).toBe('1067983'); // XML: 0001067983
  });
});

describe('parseForm4 — 버크셔 BAC 매도 골든(비파생 S, 부호 음수 컨벤션)', () => {
  const { xml, expected } = loadFixture('berkshire-bac-2024-07-19');

  it('정규화 출력이 expected 와 정확히 일치', () => {
    expect(parseForm4(xml)).toEqual(expected);
  });

  it('매도(S→SELL)는 sharesDelta·value 가 음수 — 다운스트림 네팅 정합(리뷰 #1)', () => {
    const parsed = parseForm4(xml);
    expect(parsed.events).toHaveLength(4);
    expect(parsed.events.every((e) => e.eventType === 'SELL')).toBe(true);
    expect(parsed.events.every((e) => e.acquiredDisposed === 'D')).toBe(true);
    expect(parsed.events.every((e) => e.sharesDelta < 0)).toBe(true);
    expect(parsed.events.every((e) => (e.value ?? 0) < 0)).toBe(true);
  });
});

describe('parseForm4 — Oracle RSU 골든(Table II 파생 거래, 코드 A, 누락 관계 플래그)', () => {
  const { xml, expected } = loadFixture('oracle-rsu-2026-05-31');

  it('정규화 출력이 expected 와 정확히 일치', () => {
    expect(parseForm4(xml)).toEqual(expected);
  });

  it('파생 테이블 워킹: derivativeTransaction → table=derivative, A→BUY(+), price 0→value 0', () => {
    const parsed = parseForm4(xml);
    expect(parsed.events).toHaveLength(1);
    const e = parsed.events[0]!;
    expect(e.table).toBe('derivative');
    expect(e.eventType).toBe('BUY');
    expect(e.sharesDelta).toBe(1550);
    expect(e.pricePerShare).toBe(0);
    expect(e.value).toBe(0); // 가격 0 은 null 이 아님(미보고와 구분)
  });

  it('누락된 관계 플래그는 false 로 기본값(isDirector 만 present)', () => {
    const owner = parseForm4(xml).reportingOwners[0]!;
    expect(owner).toEqual({
      cik: '1142624',
      name: 'RUSCKOWSKI STEPHEN H',
      isDirector: true,
      isOfficer: false,
      isTenPercentOwner: false,
      isOther: false,
    });
  });
});

describe('parseForm4 — 부호 컨벤션 불변식(BUY ⇒ +, SELL ⇒ −)', () => {
  it('모든 골든에서 sharesDelta·value 부호가 eventType 과 일치', () => {
    for (const base of [
      'berkshire-oxy-2022-03-16',
      'berkshire-bac-2024-07-19',
      'oracle-rsu-2026-05-31',
    ]) {
      const { xml } = loadFixture(base);
      for (const e of parseForm4(xml).events) {
        if (e.eventType === 'SELL') {
          expect(e.sharesDelta, `${base} SELL sharesDelta`).toBeLessThan(0);
          expect(e.value ?? 0, `${base} SELL value`).toBeLessThanOrEqual(0);
        } else {
          expect(e.sharesDelta, `${base} BUY sharesDelta`).toBeGreaterThan(0);
          expect(e.value ?? 0, `${base} BUY value`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe('mapTransactionToEventType — transactionCode → BUY/SELL(PLAN: P/A=BUY, S=SELL, M=행사)', () => {
  it('명시 코드 매핑', () => {
    expect(mapTransactionToEventType('P', 'A')).toBe('BUY');
    expect(mapTransactionToEventType('S', 'D')).toBe('SELL');
    expect(mapTransactionToEventType('A', 'A')).toBe('BUY');
    expect(mapTransactionToEventType('M', 'A')).toBe('BUY');
    expect(mapTransactionToEventType('M', 'D')).toBe('SELL');
  });

  it('미지정 코드는 취득/처분(A/D)으로 폴백', () => {
    expect(mapTransactionToEventType('G', 'A')).toBe('BUY');
    expect(mapTransactionToEventType('G', 'D')).toBe('SELL');
    expect(mapTransactionToEventType('F', 'D')).toBe('SELL');
  });
});

describe('parseForm4 — 신형 스키마(X0609 true/false 불리언) + 보유 전용 → 이벤트 0건', () => {
  const x0609 = `<?xml version="1.0"?>
<ownershipDocument>
  <schemaVersion>X0609</schemaVersion>
  <documentType>4</documentType>
  <periodOfReport>2026-05-22</periodOfReport>
  <issuer>
    <issuerCik>0000320193</issuerCik>
    <issuerName>APPLE INC</issuerName>
    <issuerTradingSymbol>AAPL</issuerTradingSymbol>
  </issuer>
  <reportingOwner>
    <reportingOwnerId>
      <rptOwnerCik>0001214156</rptOwnerCik>
      <rptOwnerName>COOK TIMOTHY D</rptOwnerName>
    </reportingOwnerId>
    <reportingOwnerRelationship>
      <isDirector>true</isDirector>
      <isOfficer>true</isOfficer>
      <officerTitle>Chief Executive Officer</officerTitle>
      <isTenPercentOwner>false</isTenPercentOwner>
      <isOther>false</isOther>
    </reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeHolding>
      <securityTitle><value>Common Stock</value></securityTitle>
      <postTransactionAmounts>
        <sharesOwnedFollowingTransaction><value>3280215</value></sharesOwnedFollowingTransaction>
      </postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
    </nonDerivativeHolding>
  </nonDerivativeTable>
</ownershipDocument>`;

  it('true/false 불리언과 단일 reportingOwner 를 파싱, 보유 전용이면 이벤트 0건', () => {
    const parsed = parseForm4(x0609);
    expect(parsed.issuer).toEqual({ cik: '320193', name: 'APPLE INC', tradingSymbol: 'AAPL' });
    expect(parsed.reportingOwners).toHaveLength(1);
    expect(parsed.reportingOwners[0]).toEqual({
      cik: '1214156',
      name: 'COOK TIMOTHY D',
      isDirector: true,
      isOfficer: true,
      isTenPercentOwner: false,
      isOther: false,
    });
    expect(parsed.events).toHaveLength(0);
  });
});
