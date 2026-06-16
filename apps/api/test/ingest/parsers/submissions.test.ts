import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseSubmissions,
  canonicalizeForm,
  FAST_LANE_FORMS,
  SLOW_LANE_FORMS,
} from '../../../src/ingest/parsers/submissions';
import type { ParsedSubmissions } from '../../../src/ingest/parsers/submissions';

/**
 * submissions 피드 파서 골든 테스트(RED → GREEN, PLAN §인제스트, ARCHITECTURE §6).
 *
 * **실제** SEC `data.sec.gov/submissions/CIK{10}.json`(트리밍) fixture 로 회귀를 막는다.
 * 파서는 순수 함수(raw JSON → 정규화 공시 목록 + 정규 폼 + 문서 URL); 미수집 accession 선별·문서 fetch·
 * 폼별 분기 파서 호출·멱등 적재는 인제스트(폴러) 레이어 책임.
 * 커버리지: 병렬배열 zip·신선순 보존·CIK 0패딩·빈문자→null·문서 URL(XSL 접두)·
 * **레거시 폼 표기 폴딩**(SCHEDULE 13D/A→13D/A·4/A→4)·**isStructured**(.xml↔.htm)·레인 필터(정규형 기준).
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

describe('parseSubmissions — Pershing Square 피드 골든(트리밍 11건)', () => {
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

  it('병렬 배열을 신선순(최신 먼저) 그대로 11건으로 zip', () => {
    const parsed = parseSubmissions(json);
    expect(parsed.filings).toHaveLength(11);
    expect(parsed.filings.map((f) => f.formType)).toEqual([
      '4',
      'SCHEDULE 13D/A',
      '13F-HR',
      '3',
      '13F-HR/A',
      'SC 13D/A',
      'SC 13D',
      'SC 13G/A',
      'SC 13G',
      '4/A',
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

describe('parseSubmissions — 정규 폼(canonicalForm: 레거시 표기·수정분 폴딩 → form_type enum)', () => {
  const { json } = loadFixture('pershing-square-2026-06');
  const byForm = (raw: string) => parseSubmissions(json).filings.find((f) => f.formType === raw)!;

  it('레거시 SCHEDULE 표기를 정규형으로 흡수 — SCHEDULE 13D/A → 13D/A(레인 필터에서 누락 방지)', () => {
    expect(byForm('SCHEDULE 13D/A').canonicalForm).toBe('13D/A');
  });

  it('수정분 폴딩: SC 13D/A→13D/A · SC 13G/A→13G/A · 4/A→4(enum 에 4/A 없음)', () => {
    expect(byForm('SC 13D/A').canonicalForm).toBe('13D/A');
    expect(byForm('SC 13G/A').canonicalForm).toBe('13G/A');
    expect(byForm('4/A').canonicalForm).toBe('4');
  });

  it('원본 폼은 그대로: 4→4 · SC 13D→SC 13D · SC 13G→SC 13G · 13F-HR(/A)', () => {
    expect(byForm('4').canonicalForm).toBe('4');
    expect(byForm('SC 13D').canonicalForm).toBe('SC 13D');
    expect(byForm('SC 13G').canonicalForm).toBe('SC 13G');
    expect(byForm('13F-HR').canonicalForm).toBe('13F-HR');
    expect(byForm('13F-HR/A').canonicalForm).toBe('13F-HR/A');
  });

  it('비추적 폼(Form 3·DFAN14A)은 canonicalForm = null', () => {
    expect(byForm('3').canonicalForm).toBeNull();
    expect(byForm('DFAN14A').canonicalForm).toBeNull();
  });
});

describe('canonicalizeForm — raw SEC 폼 → form_type enum(순수 매핑)', () => {
  it('표기 변형 흡수(SC ↔ SCHEDULE, 수정분 /A)', () => {
    expect(canonicalizeForm('SC 13D')).toBe('SC 13D');
    expect(canonicalizeForm('SCHEDULE 13D')).toBe('SC 13D');
    expect(canonicalizeForm('SC 13D/A')).toBe('13D/A');
    expect(canonicalizeForm('SCHEDULE 13D/A')).toBe('13D/A');
    expect(canonicalizeForm('SC 13G')).toBe('SC 13G');
    expect(canonicalizeForm('SCHEDULE 13G')).toBe('SC 13G');
    expect(canonicalizeForm('SC 13G/A')).toBe('13G/A');
    expect(canonicalizeForm('SCHEDULE 13G/A')).toBe('13G/A');
  });

  it('Form 4 계열: 4·4/A → 4 / 13F-HR 계열 보존', () => {
    expect(canonicalizeForm('4')).toBe('4');
    expect(canonicalizeForm('4/A')).toBe('4');
    expect(canonicalizeForm('13F-HR')).toBe('13F-HR');
    expect(canonicalizeForm('13F-HR/A')).toBe('13F-HR/A');
  });

  it('비추적/미지원 폼 → null(공백·대소문자 관용)', () => {
    expect(canonicalizeForm('3')).toBeNull();
    expect(canonicalizeForm('5')).toBeNull();
    expect(canonicalizeForm('DFAN14A')).toBeNull();
    expect(canonicalizeForm('  sc 13d ')).toBe('SC 13D'); // trim + 대소문자 무관
    expect(canonicalizeForm('')).toBeNull();
  });
});

describe('parseSubmissions — isStructured(폼 라벨 아닌 문서 확장자 .xml 기준)', () => {
  const { json } = loadFixture('pershing-square-2026-06');
  const byForm = (raw: string) => parseSubmissions(json).filings.find((f) => f.formType === raw)!;

  it('구조화 XML(post-2024)은 true — 레거시 라벨이어도 문서가 .xml 이면 파싱 가능', () => {
    expect(byForm('4').isStructured).toBe(true); // xslF345X06/form4.xml
    expect(byForm('13F-HR').isStructured).toBe(true); // xslForm13F_X02/primary_doc.xml
    // 라벨은 레거시(SCHEDULE)지만 문서는 구조화 XML → true
    expect(byForm('SCHEDULE 13D/A').isStructured).toBe(true); // xslSCHEDULE_13D_X02/primary_doc.xml
  });

  it('레거시 HTML 공시(.htm)는 false — 인제스트가 XML 파서로 못 먹으니 스킵', () => {
    expect(byForm('SC 13D').isStructured).toBe(false); // c109608_sc13d.htm
    expect(byForm('SC 13G').isStructured).toBe(false); // d517007dsc13g.htm
    expect(byForm('SC 13D/A').isStructured).toBe(false); // form_13da_seg_*.htm
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

  it('레거시 라벨 구조화 XML: xslSCHEDULE_13D_X02 접두도 제거 → primary_doc.xml', () => {
    const f = parseSubmissions(json).filings.find((x) => x.formType === 'SCHEDULE 13D/A')!;
    expect(f.documentUrl).toContain('/xslSCHEDULE_13D_X02/primary_doc.xml');
    expect(f.rawDocumentUrl).toMatch(/\/000114036126024479\/primary_doc\.xml$/);
  });

  it('HTML 문서(.htm, XSL 접두 없음): rawDocumentUrl === documentUrl', () => {
    const f = parseSubmissions(json).filings.find((x) => x.formType === 'SC 13D')!;
    expect(f.documentUrl).toMatch(/\/c109608_sc13d\.htm$/);
    expect(f.rawDocumentUrl).toBe(f.documentUrl);
  });
});

describe('parseSubmissions — 레인 필터(정규형 기준, 빠른/느린 레인 선별)', () => {
  const { json } = loadFixture('pershing-square-2026-06');

  it('forms 미지정 → 전체 반환', () => {
    expect(parseSubmissions(json).filings).toHaveLength(11);
  });

  it('FAST_LANE_FORMS: 정규형 매칭이라 레거시 SCHEDULE 13D/A·4/A 도 포함(과거엔 누락되던 갭)', () => {
    const parsed = parseSubmissions(json, { forms: FAST_LANE_FORMS });
    expect(parsed.filings.map((f) => f.formType)).toEqual([
      '4',
      'SCHEDULE 13D/A',
      'SC 13D/A',
      'SC 13D',
      'SC 13G/A',
      'SC 13G',
      '4/A',
    ]);
  });

  it("정규형 '4' 필터는 4·4/A 모두 매칭(수정분 재파싱), Form 3 은 제외", () => {
    const parsed = parseSubmissions(json, { forms: ['4'] });
    expect(parsed.filings.map((f) => f.formType)).toEqual(['4', '4/A']);
    expect(parsed.filings.some((f) => f.formType === '3')).toBe(false);
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

describe('parseSubmissions — 레인 폼 상수(정규형, 빠른/느린 레인 척추)', () => {
  it('빠른 레인은 사건 기반(4·13D/G), 느린 레인은 13F — form_type enum 정규형, 교집합 없음', () => {
    const fast = new Set<string>(FAST_LANE_FORMS);
    const slow = new Set<string>(SLOW_LANE_FORMS);
    expect([...fast].some((f) => slow.has(f))).toBe(false);
    expect(fast.has('4')).toBe(true);
    expect(fast.has('13D/A')).toBe(true); // 정규형(SC 13D/A·SCHEDULE 13D/A 가 여기로 폴딩)
    expect(fast.has('3')).toBe(false); // Form 3(초기 보유)은 빠른 레인 아님
    expect(slow.has('13F-HR')).toBe(true);
  });
});
