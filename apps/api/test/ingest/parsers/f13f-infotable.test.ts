import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse13FInfoTable } from '../../../src/ingest/parsers/f13f-infotable';
import type { Parsed13FInfoTable } from '../../../src/ingest/parsers/f13f-infotable';

/**
 * 13F information table 파서 골든 테스트(RED → GREEN, ADR-0012/0014, PLAN §검증).
 *
 * **실제** SEC 13F-HR information table XML fixture(버크셔)로 회귀를 막는다. 파서는 순수 함수
 * (raw XML → 정규화 `holdings` 후보); CUSIP→security 해소·중복 CUSIP 합산·pct_of_portfolio·
 * (filing, security) 멱등은 인제스트 레이어 책임. 커버리지: **값 스케일 정규화**(2023 이전=천 달러
 * ×1000 / 2023+=달러), 중복 CUSIP 충실 보고, sshPrnamtType(SH/PRN), putCall, FIGI(2023+ 신규).
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', '..', 'fixtures', 'f13f-infotable');

function loadFixture(base: string): { xml: string; expected: Parsed13FInfoTable } {
  const xml = readFileSync(join(fixtures, `${base}.xml`), 'utf8');
  const expected = JSON.parse(
    readFileSync(join(fixtures, `${base}.expected.json`), 'utf8'),
  ) as Parsed13FInfoTable;
  return { xml, expected };
}

describe('parse13FInfoTable — 버크셔 2025 Q1 골든(달러 시대, 2023+)', () => {
  const { xml, expected } = loadFixture('berkshire-2025q1-dollars');
  // 2025-05-15 제출 → 달러 시대(2023-01-03 이후 제출분은 value 를 달러로 보고).
  const parsed = parse13FInfoTable(xml, { filedAt: '2025-05-15' });

  it('정규화 출력이 expected 와 정확히 일치', () => {
    expect(parsed).toEqual(expected);
  });

  it('달러 시대는 value 를 그대로(×1000 미적용): valueUsd === valueReported', () => {
    expect(parsed.valueScale).toBe('dollars');
    for (const h of parsed.holdings) {
      expect(h.valueUsd, h.nameOfIssuer).toBe(h.valueReported);
    }
  });

  it('중복 CUSIP(ALLY FINL 02005N100)을 합산하지 않고 충실히 두 행으로 보고(합산은 인제스트)', () => {
    const ally = parsed.holdings.filter((h) => h.cusip === '02005N100');
    expect(ally).toHaveLength(2);
    // 인제스트가 (filing, security) 1행으로 합산하면 이 종목 총 포지션이 됨
    const summed = ally.reduce((s, h) => s + h.shares, 0);
    expect(summed).toBe(12719675 + 2803875);
  });
});

describe('parse13FInfoTable — 버크셔 2022 Q1 골든(천 달러 시대, 2023 이전)', () => {
  const { xml, expected } = loadFixture('berkshire-2022q1-thousands');
  // 2022-05-16 제출 → 천 달러 시대 → value × 1000 로 정규화.
  const parsed = parse13FInfoTable(xml, { filedAt: '2022-05-16' });

  it('정규화 출력이 expected 와 정확히 일치', () => {
    expect(parsed).toEqual(expected);
  });

  it('천 달러 시대는 value × 1000 정규화: valueUsd === valueReported * 1000', () => {
    expect(parsed.valueScale).toBe('thousands');
    for (const h of parsed.holdings) {
      expect(h.valueUsd, h.nameOfIssuer).toBe(h.valueReported * 1000);
    }
  });

  it('명시적 valueScale 옵션이 filedAt 보다 우선', () => {
    // 같은 XML 을 강제로 달러로 해석하면 ×1000 미적용
    const asDollars = parse13FInfoTable(xml, { valueScale: 'dollars' });
    expect(asDollars.valueScale).toBe('dollars');
    expect(asDollars.holdings[0]!.valueUsd).toBe(asDollars.holdings[0]!.valueReported);
  });
});

describe('parse13FInfoTable — 불변식(총액·행수·음수 없음)', () => {
  it('totalValueUsd = Σ valueUsd, holdingCount = holdings.length, 값/수량 음수 아님', () => {
    for (const base of ['berkshire-2025q1-dollars', 'berkshire-2022q1-thousands']) {
      const { xml } = loadFixture(base);
      const p = parse13FInfoTable(xml, { filedAt: '2025-05-15' });
      const sum = p.holdings.reduce((s, h) => s + h.valueUsd, 0);
      expect(p.totalValueUsd, `${base} total`).toBe(sum);
      expect(p.holdingCount, `${base} count`).toBe(p.holdings.length);
      for (const h of p.holdings) {
        expect(h.valueUsd, `${base} valueUsd`).toBeGreaterThanOrEqual(0);
        expect(h.shares, `${base} shares`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('parse13FInfoTable — 합성 fixture: putCall / FIGI / PRN(채권 원금) / ns-prefix', () => {
  // 버크셔는 옵션·FIGI·채권을 보고하지 않으므로 이 엣지는 합성 info table 로 검증
  // (sc13dg 의 합성 STAKE_EXIT 패턴과 동일). ns-prefix(n1:) 사용 변형도 함께 검증.
  const synthetic = `<?xml version="1.0" encoding="UTF-8"?>
<n1:informationTable xmlns:n1="http://www.sec.gov/edgar/document/thirteenf/informationtable">
  <n1:infoTable>
    <n1:nameOfIssuer>SPDR S&amp;P 500 ETF TR</n1:nameOfIssuer>
    <n1:titleOfClass>PUT</n1:titleOfClass>
    <n1:cusip>78462F103</n1:cusip>
    <n1:figi>BBG000BDTBL9</n1:figi>
    <n1:value>1000000</n1:value>
    <n1:shrsOrPrnAmt>
      <n1:sshPrnamt>2000</n1:sshPrnamt>
      <n1:sshPrnamtType>SH</n1:sshPrnamtType>
    </n1:shrsOrPrnAmt>
    <n1:putCall>Put</n1:putCall>
    <n1:investmentDiscretion>SOLE</n1:investmentDiscretion>
    <n1:votingAuthority>
      <n1:Sole>0</n1:Sole>
      <n1:Shared>0</n1:Shared>
      <n1:None>2000</n1:None>
    </n1:votingAuthority>
  </n1:infoTable>
  <n1:infoTable>
    <n1:nameOfIssuer>US TREASURY NOTE</n1:nameOfIssuer>
    <n1:titleOfClass>NOTE</n1:titleOfClass>
    <n1:cusip>912828YY0</n1:cusip>
    <n1:value>5000000</n1:value>
    <n1:shrsOrPrnAmt>
      <n1:sshPrnamt>5000000</n1:sshPrnamt>
      <n1:sshPrnamtType>PRN</n1:sshPrnamtType>
    </n1:shrsOrPrnAmt>
    <n1:investmentDiscretion>SOLE</n1:investmentDiscretion>
    <n1:votingAuthority>
      <n1:Sole>5000000</n1:Sole>
      <n1:Shared>0</n1:Shared>
      <n1:None>0</n1:None>
    </n1:votingAuthority>
  </n1:infoTable>
</n1:informationTable>`;

  it('putCall=Put, FIGI 매핑, ns-prefix 제거 후 정규화', () => {
    const p = parse13FInfoTable(synthetic, { valueScale: 'dollars' });
    expect(p.holdingCount).toBe(2);
    const put = p.holdings[0]!;
    expect(put.putCall).toBe('Put');
    expect(put.figi).toBe('BBG000BDTBL9');
    expect(put.sharesType).toBe('SH');
    expect(put.nameOfIssuer).toBe('SPDR S&P 500 ETF TR');
    expect(put.votingAuthority).toEqual({ sole: 0, shared: 0, none: 2000 });
  });

  it('채권 보고는 sshPrnamtType=PRN, putCall=null, figi 미기재 → null', () => {
    const p = parse13FInfoTable(synthetic, { valueScale: 'dollars' });
    const note = p.holdings[1]!;
    expect(note.sharesType).toBe('PRN');
    expect(note.putCall).toBeNull();
    expect(note.figi).toBeNull();
    expect(note.shares).toBe(5000000); // sshPrnamt = 채권 원금액
  });
});

describe('parse13FInfoTable — 값 스케일 해소(경계·fail-loud, M1/ADR-0015)', () => {
  // 스케일 해소는 value 내용과 무관하므로 최소 1행짜리 info table 로 검증.
  const minimal = `<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
  <infoTable>
    <nameOfIssuer>X CORP</nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <cusip>000000000</cusip>
    <value>100</value>
    <shrsOrPrnAmt><sshPrnamt>10</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
    <investmentDiscretion>SOLE</investmentDiscretion>
    <votingAuthority><Sole>10</Sole><Shared>0</Shared><None>0</None></votingAuthority>
  </infoTable>
</informationTable>`;

  it('filedAt === 2023-01-03(개정 발효일, inclusive >=) → 달러', () => {
    expect(parse13FInfoTable(minimal, { filedAt: '2023-01-03' }).valueScale).toBe('dollars');
  });

  it('filedAt === 2023-01-02(발효 직전 하루) → 천 달러', () => {
    const p = parse13FInfoTable(minimal, { filedAt: '2023-01-02' });
    expect(p.valueScale).toBe('thousands');
    expect(p.holdings[0]!.valueUsd).toBe(100 * 1000); // ×1000 정규화
  });

  it('filedAt·valueScale 둘 다 미지정이면 throw(조용한 달러 기본값 금지)', () => {
    expect(() => parse13FInfoTable(minimal)).toThrow();
    expect(() => parse13FInfoTable(minimal, {})).toThrow();
  });

  it('비-ISO filedAt(MM/DD/YYYY)은 lexicographic 1000× 오판 위험 → throw', () => {
    // '05/15/2025' >= '2023-01-03' 는 '0' < '2' 라 천 달러로 오판 → 거부해야 함.
    expect(() => parse13FInfoTable(minimal, { filedAt: '05/15/2025' })).toThrow(/ISO/);
    // 0패딩 안 된 ISO 변형도 거부(엄격 형식).
    expect(() => parse13FInfoTable(minimal, { filedAt: '2023-1-3' })).toThrow(/ISO/);
  });

  it('비-ISO filedAt 이라도 명시적 valueScale 이 있으면 우선 적용(throw 안 함)', () => {
    const p = parse13FInfoTable(minimal, { filedAt: '05/15/2025', valueScale: 'dollars' });
    expect(p.valueScale).toBe('dollars');
  });
});

describe('parse13FInfoTable — 합성: putCall=Call(콜 옵션) 경로', () => {
  // 버크셔 골든엔 옵션이 없어 'Call' 분기는 합성으로만 커버('Put'은 위 합성 describe).
  const call = `<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
  <infoTable>
    <nameOfIssuer>INVESCO QQQ TR</nameOfIssuer>
    <titleOfClass>CALL</titleOfClass>
    <cusip>46090E103</cusip>
    <value>2500000</value>
    <shrsOrPrnAmt><sshPrnamt>5000</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
    <putCall>Call</putCall>
    <investmentDiscretion>SOLE</investmentDiscretion>
    <votingAuthority><Sole>0</Sole><Shared>0</Shared><None>5000</None></votingAuthority>
  </infoTable>
</informationTable>`;

  it('putCall=Call 로 매핑', () => {
    const p = parse13FInfoTable(call, { valueScale: 'dollars' });
    expect(p.holdings[0]!.putCall).toBe('Call');
  });
});

describe('parse13FInfoTable — 빈 표/루트 검증', () => {
  it('infoTable 0건이면 holdings=[] · total=0 · count=0', () => {
    const empty = `<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable"></informationTable>`;
    const p = parse13FInfoTable(empty, { valueScale: 'dollars' });
    expect(p.holdings).toEqual([]);
    expect(p.totalValueUsd).toBe(0);
    expect(p.holdingCount).toBe(0);
  });

  it('informationTable 루트가 없으면 throw', () => {
    expect(() => parse13FInfoTable('<foo/>', { valueScale: 'dollars' })).toThrow();
  });
});
