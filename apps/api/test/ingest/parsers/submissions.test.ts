import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseSubmissions,
  FAST_LANE_FORMS,
  SLOW_LANE_FORMS,
} from '../../../src/ingest/parsers/submissions';
import type { ParsedSubmissions } from '../../../src/ingest/parsers/submissions';

/**
 * submissions 피드 파서 골든 테스트(RED → GREEN, PLAN §인제스트, ARCHITECTURE §6).
 *
 * **실제** SEC `data.sec.gov/submissions/CIK{10}.json`(트리밍) fixture 로 회귀를 막는다.
 * 파서는 순수 함수(raw JSON → 정규화 공시 목록 + 문서 URL); 미수집 accession 선별·문서 fetch·
 * 폼별 분기 파서 호출·멱등 적재는 인제스트(폴러) 레이어 책임.
 * 커버리지: 병렬배열 zip·신선순 보존·CIK 0패딩·빈문자→null·문서 URL(XSL 접두 처리)·폼 필터(정확 일치).
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', '..', 'fixtures', 'submissions');

function loadFixture(base: string): { json: string; expected: ParsedSubmissions } {
  const json = readFileSync(join(fixtures, `${base}.json`), 'utf8');
  const expected = JSON.parse(
    readFileSync(join(fixtures, `${base}.expected.json`), 'utf8'),
  ) as ParsedSubmissions;
  return { json, expected };
}

describe('parseSubmissions — Pershing Square 피드 골든(트리밍 9건)', () => {
  const { json, expected } = loadFixture('pershing-square-2026-06');

  it('정규화 출력이 expected 와 정확히 일치(raw JSON 문자열 입력)', () => {
    expect(parseSubmissions(json)).toEqual(expected);
  });

  it('이미 파싱된 객체도 동일하게 처리(string | object 입력)', () => {
    expect(parseSubmissions(JSON.parse(json))).toEqual(expected);
  });

  it('CIK 0패딩 제거 + 엔티티명 추출(investors.external_id 시드 형식)', () => {
    const parsed = parseSubmissions(json);
    expect(parsed.cik).toBe('1336528'); // 피드: 0001336528
    expect(parsed.name).toBe('Pershing Square Capital Management, L.P.');
  });

  it('병렬 배열을 신선순(최신 먼저) 그대로 9건으로 zip', () => {
    const parsed = parseSubmissions(json);
    expect(parsed.filings).toHaveLength(9);
    expect(parsed.filings.map((f) => f.formType)).toEqual([
      '4',
      '13F-HR',
      '3',
      '13F-HR/A',
      'SC 13D/A',
      'SC 13D',
      'SC 13G/A',
      'SC 13G',
      'DFAN14A',
    ]);
    // 신선순 단조 감소(또는 동일) 불변식
    const dates = parsed.filings.map((f) => f.filingDate);
    expect([...dates].sort((a, b) => (a < b ? 1 : -1))).toEqual(dates);
  });

  it('빈 문자열 reportDate/primaryDocDescription → null', () => {
    const parsed = parseSubmissions(json);
    const sc13d = parsed.filings.find((f) => f.formType === 'SC 13D')!;
    expect(sc13d.reportDate).toBeNull(); // 피드: ""
    expect(sc13d.primaryDocDescription).toBeNull(); // 피드: ""

    const form4 = parsed.filings.find((f) => f.formType === '4')!;
    expect(form4.reportDate).toBe('2026-06-04'); // 존재 시 그대로
    expect(form4.primaryDocDescription).toBe('FORM 4');
  });
});

describe('parseSubmissions — 문서 URL 빌드(XSL 렌더 접두 처리)', () => {
  const { json } = loadFixture('pershing-square-2026-06');

  it('Form 4: documentUrl 은 XSL 경로 그대로, rawDocumentUrl 은 접두 제거(파서가 먹는 원본 XML)', () => {
    const f = parseSubmissions(json).filings.find((x) => x.formType === '4')!;
    const dir = 'https://www.sec.gov/Archives/edgar/data/1336528/000114036126024482/';
    expect(f.accessionNoDashes).toBe('000114036126024482');
    expect(f.directoryUrl).toBe(dir);
    expect(f.documentUrl).toBe(`${dir}xslF345X06/form4.xml`);
    expect(f.rawDocumentUrl).toBe(`${dir}form4.xml`);
  });

  it('13F-HR: xslForm13F_X02 접두 제거 → primary_doc.xml(인포테이블은 directoryUrl 기준 별도 탐색)', () => {
    const f = parseSubmissions(json).filings.find((x) => x.formType === '13F-HR')!;
    expect(f.documentUrl).toContain('/xslForm13F_X02/primary_doc.xml');
    expect(f.rawDocumentUrl).toMatch(/\/000117266126002336\/primary_doc\.xml$/);
  });

  it('HTML 문서(.htm, XSL 접두 없음): rawDocumentUrl === documentUrl', () => {
    const f = parseSubmissions(json).filings.find((x) => x.formType === 'SC 13D')!;
    expect(f.documentUrl).toMatch(/\/c109608_sc13d\.htm$/);
    expect(f.rawDocumentUrl).toBe(f.documentUrl);
  });
});

describe('parseSubmissions — 폼 필터(정확 일치, 빠른/느린 레인 선별)', () => {
  const { json } = loadFixture('pershing-square-2026-06');

  it('forms 미지정 → 전체 반환', () => {
    expect(parseSubmissions(json).filings).toHaveLength(9);
  });

  it('FAST_LANE_FORMS: 4·SC 13D·SC 13D/A·SC 13G·SC 13G/A 만(3·DFAN14A·13F 제외)', () => {
    const parsed = parseSubmissions(json, { forms: FAST_LANE_FORMS });
    expect(parsed.filings.map((f) => f.formType)).toEqual([
      '4',
      'SC 13D/A',
      'SC 13D',
      'SC 13G/A',
      'SC 13G',
    ]);
  });

  it('Form 3 은 빠른 레인 아님 — 접두가 아닌 정확 일치(4 ≠ 3)', () => {
    const parsed = parseSubmissions(json, { forms: ['4'] });
    expect(parsed.filings).toHaveLength(1);
    expect(parsed.filings[0]!.formType).toBe('4');
  });

  it('SLOW_LANE_FORMS: 13F-HR·13F-HR/A 만', () => {
    const parsed = parseSubmissions(json, { forms: SLOW_LANE_FORMS });
    expect(parsed.filings.map((f) => f.formType)).toEqual(['13F-HR', '13F-HR/A']);
  });

  it('cik/name 은 필터와 무관하게 보존', () => {
    const parsed = parseSubmissions(json, { forms: [] });
    expect(parsed.cik).toBe('1336528');
    expect(parsed.name).toBe('Pershing Square Capital Management, L.P.');
    expect(parsed.filings).toHaveLength(0); // 빈 forms → 매칭 0
  });
});

describe('parseSubmissions — 레인 폼 상수(빠른/느린 레인 척추)', () => {
  it('빠른 레인은 사건 기반(4·13D/G), 느린 레인은 13F — 교집합 없음', () => {
    const fast = new Set<string>(FAST_LANE_FORMS);
    const slow = new Set<string>(SLOW_LANE_FORMS);
    expect([...fast].some((f) => slow.has(f))).toBe(false);
    expect(fast.has('4')).toBe(true);
    expect(fast.has('3')).toBe(false); // Form 3(초기 보유)은 빠른 레인 아님
    expect(slow.has('13F-HR')).toBe(true);
  });
});
