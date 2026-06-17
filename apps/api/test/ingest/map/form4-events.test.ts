import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseForm4 } from '../../../src/ingest/parsers/form4';
import {
  mapForm4ToActivityEvent,
  type Form4MapContext,
} from '../../../src/ingest/map/form4-events';

/**
 * Form 4 → `activity_events` 매핑 골든 테스트(RED → GREEN, ADR-0012/0014/0018).
 *
 * 파서는 거래(transaction)별로 펼친 정규화 행을 내지만, `activity_events` 의 unique 키는
 * `(investor_id, accession_number, security_id)` 다 — 한 공시는 한 종목당 **정확히 한 행**으로
 * **집계**돼야 멱등하다. 이 레이어가 그 집계(순증감 네팅·VWAP·종료 잔고·순방향 BUY/SELL)를 책임진다.
 * 커버리지: 다중 매수 집계(OXY)·다중 매도 네팅(BAC, 음수)·파생 0원 부여(Oracle, 0≠null)·
 * 보유 전용 → null·멱등 키 보존·순방향 결정 규칙.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', '..', 'fixtures', 'form4');
const loadXml = (base: string): string => readFileSync(join(fixtures, `${base}.xml`), 'utf8');

/** 폴러가 submissions 피드·식별자 해소로 채워 넣는 컨텍스트(파서가 알 수 없는 값). */
const CTX: Form4MapContext = {
  investorId: 7,
  securityId: 42,
  filingDate: '2022-03-18',
  accessionNumber: '0000950123-22-002701',
  rawUrl: 'https://www.sec.gov/Archives/edgar/data/797468/000095012322002701/form4.xml',
};

describe('mapForm4ToActivityEvent — 버크셔 OXY(7건 매수 → 1행 집계)', () => {
  const row = mapForm4ToActivityEvent(parseForm4(loadXml('berkshire-oxy-2022-03-16')), CTX);

  it('7건 비파생 매수를 순증·VWAP·종료잔고로 묶은 단일 BUY 행', () => {
    expect(row).toEqual({
      investorId: 7,
      securityId: 42,
      source: 'edgar',
      formType: '4',
      eventType: 'BUY',
      eventDate: '2022-03-16', // 거래일 중 최신
      filingDate: '2022-03-18', // ctx(피드 filingDate)
      sharesDelta: 18102616, // 7건 합(전부 +)
      sharesAfter: 136373000, // 최신 거래의 러닝 잔고
      pctOfCompanyAfter: null, // Form 4 는 회사대비 비율 미보고
      pricePerShare: 54.409805, // 거래금액가중평균(VWAP, 6dp)
      value: 984959812.96, // 부호 있는 순거래금액 합
      intent: null, // 13D/G 전용
      accessionNumber: CTX.accessionNumber,
      rawUrl: CTX.rawUrl,
    });
  });

  it('멱등 키 3요소(investor·accession·security)를 ctx 그대로 보존', () => {
    expect(row).not.toBeNull();
    expect({
      investorId: row!.investorId,
      accessionNumber: row!.accessionNumber,
      securityId: row!.securityId,
    }).toEqual({ investorId: 7, accessionNumber: CTX.accessionNumber, securityId: 42 });
  });
});

describe('mapForm4ToActivityEvent — 버크셔 BAC(4건 매도 → 음수 네팅)', () => {
  const row = mapForm4ToActivityEvent(parseForm4(loadXml('berkshire-bac-2024-07-19')), CTX);

  it('순매도면 eventType=SELL, sharesDelta·value 음수(다운스트림 네팅 정합)', () => {
    expect(row).toMatchObject({
      eventType: 'SELL',
      eventDate: '2024-07-19',
      sharesDelta: -33890927,
      sharesAfter: 998961079,
      pricePerShare: 43.56324, // VWAP 은 항상 양수(부호는 shares/value 에)
      value: -1476398603.66,
    });
    expect(row!.sharesDelta).toBeLessThan(0);
    expect(row!.value!).toBeLessThan(0);
  });
});

describe('mapForm4ToActivityEvent — Oracle RSU(파생 0원 부여)', () => {
  const row = mapForm4ToActivityEvent(parseForm4(loadXml('oracle-rsu-2026-05-31')), CTX);

  it('단일 파생 취득(A)→BUY, 가격 0 은 보존(value 0 ≠ null)', () => {
    expect(row).toMatchObject({
      eventType: 'BUY',
      sharesDelta: 1550,
      sharesAfter: 1550,
      pricePerShare: 0,
      value: 0,
      eventDate: '2026-05-31',
    });
  });
});

describe('mapForm4ToActivityEvent — 보유 전용 공시(거래 0건) → null', () => {
  const holdingOnly = `<?xml version="1.0"?>
<ownershipDocument>
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
    <reportingOwnerRelationship><isDirector>true</isDirector></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeHolding>
      <securityTitle><value>Common Stock</value></securityTitle>
      <postTransactionAmounts>
        <sharesOwnedFollowingTransaction><value>3280215</value></sharesOwnedFollowingTransaction>
      </postTransactionAmounts>
    </nonDerivativeHolding>
  </nonDerivativeTable>
</ownershipDocument>`;

  it('거래가 없으면 적재할 이벤트도 없음 → null', () => {
    expect(mapForm4ToActivityEvent(parseForm4(holdingOnly), CTX)).toBeNull();
  });
});

describe('mapForm4ToActivityEvent — 순방향 결정 규칙(혼합 거래 네팅)', () => {
  // 행사(M, +1000) 후 같은 양 시장매도(S, −1000) 초과 → 순매도. 단일 종목, 단일 공시.
  const mixed = `<?xml version="1.0"?>
<ownershipDocument>
  <documentType>4</documentType>
  <periodOfReport>2026-01-10</periodOfReport>
  <issuer><issuerCik>0000320193</issuerCik><issuerName>APPLE INC</issuerName><issuerTradingSymbol>AAPL</issuerTradingSymbol></issuer>
  <reportingOwner><reportingOwnerId><rptOwnerCik>0001214156</rptOwnerCik><rptOwnerName>COOK TIMOTHY D</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isOfficer>true</isOfficer></reportingOwnerRelationship></reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-01-09</value></transactionDate>
      <transactionCoding><transactionCode>M</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>1000</value></transactionShares>
        <transactionPricePerShare><value>50</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>6000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-01-10</value></transactionDate>
      <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>2500</value></transactionShares>
        <transactionPricePerShare><value>200</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>3500</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`;

  it('순(+1000−2500=−1500)이 음수면 SELL, 종료잔고는 최신 거래(3500)', () => {
    const row = mapForm4ToActivityEvent(parseForm4(mixed), CTX);
    expect(row).toMatchObject({
      eventType: 'SELL',
      sharesDelta: -1500,
      sharesAfter: 3500,
      eventDate: '2026-01-10',
    });
    // VWAP = (|1000·50| + |2500·200|) / (1000 + 2500) = 550000/3500
    expect(row!.pricePerShare).toBeCloseTo(157.142857, 6);
    // 순거래금액 = +50000 − 500000 = −450000
    expect(row!.value).toBe(-450000);
  });
});

describe('mapForm4ToActivityEvent — 전부 가격 미보고(증여 G) → value·pricePerShare null', () => {
  // 가격 없는 증여 처분 2건(G/D). sharesDelta 는 전 거래로 합산되지만 가격 보고분이 0건이라
  // value·pricePerShare 는 null(ADR-0018 "전부 미보고 → null"). 부호 있는 수량은 여전히 SELL.
  const giftOnly = `<?xml version="1.0"?>
<ownershipDocument>
  <documentType>4</documentType>
  <periodOfReport>2026-03-02</periodOfReport>
  <issuer><issuerCik>0000320193</issuerCik><issuerName>APPLE INC</issuerName><issuerTradingSymbol>AAPL</issuerTradingSymbol></issuer>
  <reportingOwner><reportingOwnerId><rptOwnerCik>0001214156</rptOwnerCik><rptOwnerName>COOK TIMOTHY D</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isOfficer>true</isOfficer></reportingOwnerRelationship></reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-03-01</value></transactionDate>
      <transactionCoding><transactionCode>G</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>300</value></transactionShares>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>700</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-03-02</value></transactionDate>
      <transactionCoding><transactionCode>G</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>200</value></transactionShares>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>500</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`;

  it('가격 보고 거래 0건이면 value·pricePerShare 는 null(수량 네팅은 유지)', () => {
    const row = mapForm4ToActivityEvent(parseForm4(giftOnly), CTX);
    expect(row).toMatchObject({
      eventType: 'SELL',
      sharesDelta: -500, // −300 − 200, 전 거래 합
      sharesAfter: 500, // 최신 거래(2026-03-02)의 러닝 잔고
      eventDate: '2026-03-02',
      pricePerShare: null, // 가격 보고 거래 0건
      value: null, // 〃
    });
  });
});

describe('mapForm4ToActivityEvent — 최신 거래만 잔고 미보고 → sharesAfter null(폴백 없음, ADR-0018 ④)', () => {
  // 이른 거래엔 잔고(1000)가 있어도, 시간상 마지막 거래에 잔고가 없으면 종료 포지션을 알 수 없다.
  // 러닝 잔고는 누적값이라 이전 값/합/평균으로 대체하면 거짓이 되므로 null 이 유일하게 옳다.
  const lastBalanceMissing = `<?xml version="1.0"?>
<ownershipDocument>
  <documentType>4</documentType>
  <periodOfReport>2026-02-02</periodOfReport>
  <issuer><issuerCik>0000320193</issuerCik><issuerName>APPLE INC</issuerName><issuerTradingSymbol>AAPL</issuerTradingSymbol></issuer>
  <reportingOwner><reportingOwnerId><rptOwnerCik>0001214156</rptOwnerCik><rptOwnerName>COOK TIMOTHY D</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isOfficer>true</isOfficer></reportingOwnerRelationship></reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-02-01</value></transactionDate>
      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>1000</value></transactionShares>
        <transactionPricePerShare><value>10</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>1000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-02-02</value></transactionDate>
      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>500</value></transactionShares>
        <transactionPricePerShare><value>20</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`;

  it('이른 거래에 잔고(1000)가 있어도 최신 거래가 미보고면 sharesAfter=null(다른 필드는 정상 집계)', () => {
    const row = mapForm4ToActivityEvent(parseForm4(lastBalanceMissing), CTX);
    expect(row).toMatchObject({
      eventType: 'BUY',
      sharesDelta: 1500, // +1000 +500
      sharesAfter: null, // 최신 거래(2026-02-02)에 잔고 없음 → 폴백하지 않음
      eventDate: '2026-02-02',
      value: 20000, // 10000 + 10000(둘 다 가격 보고)
    });
    // VWAP = (|1000·10| + |500·20|) / (1000 + 500) = 20000/1500
    expect(row!.pricePerShare).toBeCloseTo(13.333333, 6);
  });
});
