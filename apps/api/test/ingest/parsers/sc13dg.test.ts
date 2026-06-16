import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSchedule13DG } from '../../../src/ingest/parsers/sc13dg';
import type { ParsedSchedule13DG } from '../../../src/ingest/parsers/sc13dg';

/**
 * Schedule 13D/13G 파서 골든 테스트(RED → GREEN, ADR-0012/0014, PLAN §검증).
 *
 * **실제** SEC 구조화 XML(2024-12 의무화) fixture 로 회귀를 막는다. 파서는 순수 함수
 * (raw XML → 정규화 스냅샷); 식별자 해소(CIK/CUSIP→investor/security)·이중집계 방지·
 * 멱등은 인제스트 레이어 책임. 커버리지: 13D(원본·active·STAKE_NEW)·13D/A(수정·eventType null)·
 * 13G(passive·보고인 CIK 부재·복수 reporting-person-type)·X01/X02 스키마·CUSIP 형태 차이.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', '..', 'fixtures', 'sc13dg');

function loadFixture(base: string): { xml: string; expected: ParsedSchedule13DG } {
  const xml = readFileSync(join(fixtures, `${base}.xml`), 'utf8');
  const expected = JSON.parse(
    readFileSync(join(fixtures, `${base}.expected.json`), 'utf8'),
  ) as ParsedSchedule13DG;
  return { xml, expected };
}

describe('parseSchedule13DG — 아이칸 Centuri 원본 SC 13D 골든(active, STAKE_NEW, X01)', () => {
  const { xml, expected } = loadFixture('icahn-centuri-2025-11-13');

  it('정규화 출력이 expected 와 정확히 일치', () => {
    expect(parseSchedule13DG(xml)).toEqual(expected);
  });

  it('13D=active·원본=STAKE_NEW, filer/issuer/보고인 CIK 0패딩 제거', () => {
    const p = parseSchedule13DG(xml);
    expect(p.formType).toBe('SC 13D');
    expect(p.intent).toBe('active');
    expect(p.eventType).toBe('STAKE_NEW');
    expect(p.isAmendment).toBe(false);
    expect(p.filerCik).toBe('921669'); // XML: 0000921669
    expect(p.issuer).toEqual({
      cik: '1981599',
      name: 'Centuri Holdings, Inc.',
      cusip: '155923105',
    });
    expect(p.reportingPersons.map((r) => r.cik)).toEqual(['813762', '921669']);
  });

  it('dateOfEvent MM/DD/YYYY → ISO(YYYY-MM-DD)', () => {
    expect(parseSchedule13DG(xml).eventDate).toBe('2025-11-10'); // XML: 11/10/2025
  });
});

describe('parseSchedule13DG — Pershing Howard Hughes SC 13D/A 골든(수정, 다중 계열 보고인, X02)', () => {
  const { xml, expected } = loadFixture('pershing-howard-hughes-2026-06-08');

  it('정규화 출력이 expected 와 정확히 일치', () => {
    expect(parseSchedule13DG(xml)).toEqual(expected);
  });

  it('수정분(13D/A)은 단일 문서로 증감 방향 불명 → eventType=null(인제스트가 결정)', () => {
    const p = parseSchedule13DG(xml);
    expect(p.formType).toBe('13D/A');
    expect(p.isAmendment).toBe(true);
    expect(p.amendmentNo).toBe(33);
    expect(p.eventType).toBeNull();
    expect(p.previousAccessionNumber).toBe('0001193125-19-306193');
  });

  it('다중 계열 보고인을 합산하지 않고 그대로 나열(이중집계는 인제스트가 filer CIK 로 귀속)', () => {
    const p = parseSchedule13DG(xml);
    expect(p.reportingPersons).toHaveLength(6);
    expect(p.filerCik).toBe('1336528');
    // reportingPersonNoCIK=Y 보고인은 cik=null, 첫 보고인(PSCM)만 CIK 보유
    expect(p.reportingPersons.map((r) => r.cik)).toEqual(['1336528', null, null, null, null, null]);
    // 계열 중복 보고라 합산지분이 동일(47%는 한 그룹의 지분이지 6배가 아님)
    expect(p.reportingPersons[0]!.sharesOwned).toBe(27852064);
    expect(p.reportingPersons[0]!.pctOfClass).toBe(46.7);
  });
});

describe('parseSchedule13DG — Tiger Cerebras 원본 SC 13G 골든(passive, 보고인 CIK 부재, X02)', () => {
  const { xml, expected } = loadFixture('tiger-cerebras-2026-05-22');

  it('정규화 출력이 expected 와 정확히 일치', () => {
    expect(parseSchedule13DG(xml)).toEqual(expected);
  });

  it('13G=passive·원본=STAKE_NEW, 다른 스키마(coverPageHeaderReportingPersonDetails)도 정규화', () => {
    const p = parseSchedule13DG(xml);
    expect(p.formType).toBe('SC 13G');
    expect(p.intent).toBe('passive');
    expect(p.eventType).toBe('STAKE_NEW');
    expect(p.eventDate).toBe('2026-05-15'); // eventDateRequiresFilingThisStatement
    expect(p.issuer).toEqual({ cik: '2021728', name: 'Cerebras Systems Inc.', cusip: '15675D103' });
  });

  it('표지에 보고인 CIK 없음 → 모두 null, classPercent/aggregate 매핑, 복수 type 결합', () => {
    const p = parseSchedule13DG(xml);
    expect(p.reportingPersons).toHaveLength(4);
    expect(p.reportingPersons.every((r) => r.cik === null)).toBe(true);
    const tgm = p.reportingPersons[2]!; // Tiger Global Management, LLC
    expect(tgm.sharesOwned).toBe(3496222);
    expect(tgm.pctOfClass).toBe(9.99);
    expect(tgm.typeOfReportingPerson).toBe('IA,OO'); // 두 typeOfReportingPerson 결합
  });
});

describe('parseSchedule13DG — 불변식(intent·formType·shares 부호)', () => {
  it('13D→active / 13G→passive, sharesOwned·pctOfClass 는 음수 아님(스냅샷)', () => {
    for (const base of [
      'icahn-centuri-2025-11-13',
      'pershing-howard-hughes-2026-06-08',
      'tiger-cerebras-2026-05-22',
    ]) {
      const { xml } = loadFixture(base);
      const p = parseSchedule13DG(xml);
      const is13D = p.formType === 'SC 13D' || p.formType === '13D/A';
      expect(p.intent, `${base} intent`).toBe(is13D ? 'active' : 'passive');
      for (const r of p.reportingPersons) {
        expect(r.sharesOwned ?? 0, `${base} shares`).toBeGreaterThanOrEqual(0);
        expect(r.pctOfClass ?? 0, `${base} pct`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('parseSchedule13DG — 13G/A 완전 청산(보유 0) → STAKE_EXIT(단일 문서로 결정)', () => {
  // 인라인 합성 fixture(form4 X0609 테스트와 동일 패턴): 보유 0 인 수정분은 청산으로 단정.
  const exit13ga = `<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission xmlns="http://www.sec.gov/edgar/schedule13g" xmlns:com="http://www.sec.gov/edgar/common">
  <schemaVersion>X0202</schemaVersion>
  <headerData>
    <submissionType>SCHEDULE 13G/A</submissionType>
    <previousAccessionNumber>0000919574-26-001142</previousAccessionNumber>
    <filerInfo><filer><filerCredentials><cik>0001167483</cik></filerCredentials></filer></filerInfo>
  </headerData>
  <formData>
    <coverPageHeader>
      <amendmentNo>2</amendmentNo>
      <securitiesClassTitle>Common Stock</securitiesClassTitle>
      <eventDateRequiresFilingThisStatement>12/31/2025</eventDateRequiresFilingThisStatement>
      <issuerInfo>
        <issuerCik>0002021728</issuerCik>
        <issuerName>Cerebras Systems Inc.</issuerName>
        <issuerCusips><issuerCusipNumber>15675D103</issuerCusipNumber></issuerCusips>
      </issuerInfo>
    </coverPageHeader>
    <coverPageHeaderReportingPersonDetails>
      <reportingPersonName>Tiger Global Management, LLC</reportingPersonName>
      <reportingPersonBeneficiallyOwnedNumberOfShares>
        <soleVotingPower>0.00</soleVotingPower>
        <sharedVotingPower>0.00</sharedVotingPower>
        <soleDispositivePower>0.00</soleDispositivePower>
        <sharedDispositivePower>0.00</sharedDispositivePower>
      </reportingPersonBeneficiallyOwnedNumberOfShares>
      <reportingPersonBeneficiallyOwnedAggregateNumberOfShares>0.00</reportingPersonBeneficiallyOwnedAggregateNumberOfShares>
      <classPercent>0.0</classPercent>
      <typeOfReportingPerson>IA</typeOfReportingPerson>
    </coverPageHeaderReportingPersonDetails>
  </formData>
</edgarSubmission>`;

  it('보유 0 + 수정분 → STAKE_EXIT, passive, amendmentNo 파싱', () => {
    const p = parseSchedule13DG(exit13ga);
    expect(p.formType).toBe('13G/A');
    expect(p.isAmendment).toBe(true);
    expect(p.amendmentNo).toBe(2);
    expect(p.intent).toBe('passive');
    expect(p.eventType).toBe('STAKE_EXIT');
    expect(p.reportingPersons[0]!.sharesOwned).toBe(0);
  });
});
