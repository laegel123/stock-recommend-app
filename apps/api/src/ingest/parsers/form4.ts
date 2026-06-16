import { XMLParser } from 'fast-xml-parser';
import type { EventType } from '@app/shared';

/**
 * Form 4(내부자·10%↑ 보유자 매매, 빠른 레인) ownershipDocument XML 파서.
 *
 * 순수 함수: raw XML → 정규화 이벤트(`ParsedForm4`). 네트워크·DB 없음.
 * Table I(비파생) + Table II(파생: 워런트/옵션)의 **거래(transaction)**만 이벤트로 산출하고,
 * **보유(holding)**는 제외한다(거래만 `activity_events`, ADR-0002/0015, ARCHITECTURE §6).
 *
 * 식별자 해소(issuer/owner CIK → securities/investors)·다중 보고인 이중집계 방지·
 * (investor, accession, security) 멱등 집계는 **인제스트 레이어**가 책임진다. 파서는 사실에 충실.
 */

/** Form 4 보고인(내부자/10%↑ 보유자). 관계 플래그로 Form 4 발생 사유를 보존. */
export interface Form4ReportingOwner {
  /** EDGAR CIK(0패딩 제거 → investors.external_id 시드 형식). */
  cik: string;
  name: string;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  isOther: boolean;
}

/** 정규화된 Form 4 거래 1건(→ activity_events 한 행의 후보). 보유는 포함하지 않는다. */
export interface Form4Event {
  /** 비파생(Table I) / 파생(Table II). */
  table: 'nonDerivative' | 'derivative';
  securityTitle: string;
  /**
   * SEC 거래 코드: P=매수, S=매도, A=수령(부여/배당 등), M=행사 등.
   * ⚠️ 다운스트림 합의(consensus)는 P(시장 매수)와 A(보상성 수령)를 구분하려면 이 코드로 가중해야 한다.
   */
  transactionCode: string;
  /** BUY/SELL 로 정규화(빠른 레인 피드 척추). PLAN: P/A=BUY, S=SELL, M=행사(취득/처분 방향에 따름). */
  eventType: EventType;
  /** 거래일(YYYY-MM-DD). */
  eventDate: string;
  /** 취득(A)/처분(D). */
  acquiredDisposed: 'A' | 'D' | null;
  /**
   * **부호 있는** 보유 변동량: 취득(BUY) = +, 처분(SELL) = −(분수 가능: 옵션/워런트).
   * 이름 그대로 델타라서 `SUM(shares_delta)` = 순증감(매도가 음수로 가산). 컬럼명 `shares_delta` 와 일치.
   */
  sharesDelta: number;
  /** 주당 가격(미보고 시 null; 무상/증여·RSU 부여 등 0 가능). 가중평균가일 수 있음(footnote). */
  pricePerShare: number | null;
  /** 거래 후 보유 수량(잔고, 항상 양수). */
  sharesAfter: number | null;
  /**
   * **부호 있는** 거래 금액 = sharesDelta × pricePerShare(센트 반올림; 가격 없으면 null).
   * 가중평균가 기반이라 정확한 약정금액의 **근사**. 표시용 총액은 abs() 권장.
   */
  value: number | null;
  /** 직접(D)/간접(I) 보유. */
  directOrIndirect: 'D' | 'I' | null;
}

/** Form 4 ownershipDocument 정규화 결과. */
export interface ParsedForm4 {
  documentType: string;
  /** 보고 기간(periodOfReport, YYYY-MM-DD). */
  periodOfReport: string;
  issuer: { cik: string; name: string; tradingSymbol: string | null };
  reportingOwners: Form4ReportingOwner[];
  /** Table I+II 거래(보유 제외)의 정규화 이벤트. */
  events: Form4Event[];
}

// ── XML 탐색 헬퍼(parseTagValue:false → 모든 스칼라는 문자열, 결정적) ─────────
const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/** SEC 패턴은 스칼라를 `<value>…</value>` 로 감싼다. 감싼 경우와 평문 모두에서 텍스트 추출. */
function valueText(node: unknown): string | undefined {
  const rec = asRecord(node);
  if (rec && 'value' in rec) return scalar(rec.value);
  return scalar(node);
}

function scalar(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

/** 반복 요소는 배열, 단일이면 객체 → 항상 배열로 정규화. */
function toArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** EDGAR CIK 0패딩 제거('0000797468' → '797468'). investors.external_id 시드와 동일 형식. */
function stripCik(cik: string | undefined): string {
  return (cik ?? '').replace(/^0+(?=\d)/, '');
}

function toBool(v: string | undefined): boolean {
  return v === '1' || v?.toLowerCase() === 'true';
}

function toNumberOrNull(v: string | undefined): number | null {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 거래 코드(+취득/처분)를 BUY/SELL 로 정규화(PLAN: P=매수, S=매도, A=수령, M=행사).
 * 미지정 코드(G 증여·F 세금원천 등)는 취득(A)=BUY / 처분(D)=SELL 로 폴백.
 */
export function mapTransactionToEventType(
  code: string,
  acquiredDisposed: 'A' | 'D' | null,
): EventType {
  switch (code) {
    case 'P':
    case 'A':
      return 'BUY';
    case 'S':
      return 'SELL';
    case 'M':
      return acquiredDisposed === 'D' ? 'SELL' : 'BUY';
    default:
      return acquiredDisposed === 'D' ? 'SELL' : 'BUY';
  }
}

function mapTransaction(node: unknown, table: Form4Event['table']): Form4Event | null {
  const tx = asRecord(node);
  if (!tx) return null;

  const coding = asRecord(tx.transactionCoding);
  const amounts = asRecord(tx.transactionAmounts);
  const transactionCode = valueText(coding?.transactionCode) ?? '';
  const adRaw = valueText(amounts?.transactionAcquiredDisposedCode);
  const acquiredDisposed = adRaw === 'A' || adRaw === 'D' ? adRaw : null;

  const magnitude = toNumberOrNull(valueText(amounts?.transactionShares)) ?? 0;
  const pricePerShare = toNumberOrNull(valueText(amounts?.transactionPricePerShare));
  const sharesAfter = toNumberOrNull(
    valueText(asRecord(tx.postTransactionAmounts)?.sharesOwnedFollowingTransaction),
  );
  const doiRaw = valueText(asRecord(tx.ownershipNature)?.directOrIndirectOwnership);
  const directOrIndirect = doiRaw === 'D' || doiRaw === 'I' ? doiRaw : null;

  // 부호 있는 델타: SELL = 음수, BUY = 양수 → SUM(shares_delta)=순증감. eventType 라벨과 항상 일치.
  const eventType = mapTransactionToEventType(transactionCode, acquiredDisposed);
  const sign = eventType === 'SELL' ? -1 : 1;

  return {
    table,
    securityTitle: valueText(tx.securityTitle) ?? '',
    transactionCode,
    eventType,
    eventDate: valueText(tx.transactionDate) ?? '',
    acquiredDisposed,
    sharesDelta: sign * magnitude,
    pricePerShare,
    sharesAfter,
    value: pricePerShare === null ? null : sign * round2(magnitude * pricePerShare),
    directOrIndirect,
  };
}

/**
 * Form 4 ownershipDocument XML 을 정규화한다.
 *
 * ⚠️ Form 3(초기·보유)·Form 5(연차)도 동일한 ownershipDocument 스키마라 구조상 파싱된다.
 * `documentType` 을 출력에 보존하니 인제스트/소비자가 form='4' 만 먹이거나 필터해야 한다.
 */
export function parseForm4(xml: string): ParsedForm4 {
  const doc = asRecord(asRecord(parser.parse(xml))?.ownershipDocument);
  if (!doc) throw new Error('parseForm4: <ownershipDocument> 루트를 찾을 수 없음');

  const issuer = asRecord(doc.issuer);
  const reportingOwners: Form4ReportingOwner[] = toArray(doc.reportingOwner).map((ro) => {
    const r = asRecord(ro);
    const id = asRecord(r?.reportingOwnerId);
    const rel = asRecord(r?.reportingOwnerRelationship);
    return {
      cik: stripCik(valueText(id?.rptOwnerCik)),
      name: valueText(id?.rptOwnerName) ?? '',
      isDirector: toBool(valueText(rel?.isDirector)),
      isOfficer: toBool(valueText(rel?.isOfficer)),
      isTenPercentOwner: toBool(valueText(rel?.isTenPercentOwner)),
      isOther: toBool(valueText(rel?.isOther)),
    };
  });

  const nonDeriv = asRecord(doc.nonDerivativeTable);
  const deriv = asRecord(doc.derivativeTable);
  const events: Form4Event[] = [
    ...toArray(nonDeriv?.nonDerivativeTransaction).map((t) => mapTransaction(t, 'nonDerivative')),
    ...toArray(deriv?.derivativeTransaction).map((t) => mapTransaction(t, 'derivative')),
  ].filter((e): e is Form4Event => e !== null);

  return {
    documentType: valueText(doc.documentType) ?? '',
    periodOfReport: valueText(doc.periodOfReport) ?? '',
    issuer: {
      cik: stripCik(valueText(issuer?.issuerCik)),
      name: valueText(issuer?.issuerName) ?? '',
      tradingSymbol: valueText(issuer?.issuerTradingSymbol) || null,
    },
    reportingOwners,
    events,
  };
}
