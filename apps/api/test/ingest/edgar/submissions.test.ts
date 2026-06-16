import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSubmissions } from '../../../src/ingest/edgar/submissions';
import type { ParsedSubmissions } from '../../../src/ingest/edgar/submissions';

/**
 * EDGAR submissions 피드 파서 골든 테스트(RED → GREEN, PLAN §인제스트, ARCH §빠른 레인).
 *
 * `data.sec.gov/submissions/CIK{10}.json` 의 **columnar** `filings.recent` 를 정규화 행으로
 * 풀고, 추적 양식만 남기며, 폴딩(`13F-HR`)/이벤트(`4`/`13D`/`13G`) 양식과 lane 을 태깅하고,
 * raw 문서 URL(xsl 렌더 프리픽스 제거)을 만든다. 순수 함수: JSON → 정규화. 네트워크·DB 없음.
 *
 * fixture 는 **실제** 버크셔 피드를 대표 행으로 트림(test/fixtures/submissions/README.md):
 *  - `SC`/`SCHEDULE` 두 표기, `/A` 수정분 정규화(4/A→4, SCHEDULE 13D/A→13D/A)
 *  - 구조화 XML(xsl.../*.xml) vs 구형 HTML(.htm, 파서 불가) → isStructured
 *  - fast(4·13D·13G) vs slow(13F-HR) 레인, reportDate 유무(빈문자→null)
 *  - 미추적 양식(11-K·3·8-K)은 필터 제외, `files` 오버플로(백필용) 보존
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

describe('parseSubmissions — 버크셔 피드 트림 골든', () => {
  const { json, expected } = loadFixture('berkshire-submissions-trimmed');

  it('정규화 출력이 expected 와 정확히 일치', () => {
    expect(parseSubmissions(json)).toEqual(expected);
  });

  it('미추적 양식(11-K·3·8-K)은 제외, 추적 8건만 피드 순서로 유지', () => {
    const p = parseSubmissions(json);
    expect(p.filings).toHaveLength(8);
    expect(p.filings.map((f) => f.formRaw)).toEqual([
      '4',
      'SCHEDULE 13G/A',
      'SCHEDULE 13G',
      '13F-HR',
      'SCHEDULE 13D/A',
      '4/A',
      'SC 13G',
      'SC 13D',
    ]);
  });

  it('cik 는 0패딩 제거(investors.external_id 형식), 오버플로 파일명 보존', () => {
    const p = parseSubmissions(json);
    expect(p.cik).toBe('1067983'); // JSON: 0001067983
    expect(p.overflowFiles).toEqual(['CIK0001067983-submissions-001.json']);
  });
});

describe('parseSubmissions — 양식 정규화(SC/SCHEDULE 두 표기 + /A 수정분)', () => {
  const { json } = loadFixture('berkshire-submissions-trimmed');
  const byAcc = (acc: string) => {
    const f = parseSubmissions(json).filings.find((x) => x.accessionNumber === acc);
    if (!f) throw new Error(`fixture 누락: ${acc}`);
    return f;
  };

  it('SCHEDULE 13G → 정규 SC 13G (구형 표기 흡수)', () => {
    const f = byAcc('0001193125-26-227126');
    expect(f.formRaw).toBe('SCHEDULE 13G');
    expect(f.formType).toBe('SC 13G');
    expect(f.isAmendment).toBe(false);
  });

  it('SCHEDULE 13D/A → 정규 13D/A, 수정분 플래그', () => {
    const f = byAcc('0001193125-25-277436');
    expect(f.formType).toBe('13D/A');
    expect(f.isAmendment).toBe(true);
  });

  it('4/A 수정분은 정규 4 로 흡수(form_type enum 에 4/A 없음) + isAmendment 보존', () => {
    const f = byAcc('0000919574-25-001652');
    expect(f.formType).toBe('4');
    expect(f.formRaw).toBe('4/A');
    expect(f.isAmendment).toBe(true);
  });
});

describe('parseSubmissions — lane 태깅 + raw 문서 URL(xsl 프리픽스 제거)', () => {
  const { json } = loadFixture('berkshire-submissions-trimmed');
  const byAcc = (acc: string) =>
    parseSubmissions(json).filings.find((x) => x.accessionNumber === acc)!;

  it('4·SC 13D·SC 13G·13D/A·13G/A=fast, 13F-HR=slow', () => {
    expect(byAcc('0001193125-26-239886').lane).toBe('fast'); // 4
    expect(byAcc('0001193125-26-227126').lane).toBe('fast'); // SC 13G
    expect(byAcc('0001193125-25-277436').lane).toBe('fast'); // 13D/A
    expect(byAcc('0001193125-26-226661').lane).toBe('slow'); // 13F-HR
  });

  it('구조화 XML: xsl 렌더 프리픽스를 벗겨 raw 기계판독 문서 URL 을 만든다', () => {
    const f = byAcc('0001193125-26-239886'); // xslF345X06/ownership.xml
    expect(f.isStructured).toBe(true);
    expect(f.primaryDocName).toBe('ownership.xml');
    expect(f.primaryDocUrl).toBe(
      'https://www.sec.gov/Archives/edgar/data/1067983/000119312526239886/ownership.xml',
    );
  });

  it('구형 HTML(.htm)은 구조화 아님 → isStructured=false, 문서명 그대로', () => {
    const f = byAcc('0001193125-24-258561'); // d49764dsc13g.htm
    expect(f.isStructured).toBe(false);
    expect(f.primaryDocName).toBe('d49764dsc13g.htm');
  });

  it('빈 reportDate 는 null, 채워진 reportDate 는 보존', () => {
    expect(byAcc('0001193125-26-227126').reportDate).toBeNull(); // 13G report ""
    expect(byAcc('0001193125-26-239886').reportDate).toBe('2026-05-22'); // Form 4
  });
});
