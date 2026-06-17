import type { EventType, Source } from '@app/shared';
import type { Form4Event, ParsedForm4 } from '../parsers/form4';

/**
 * Form 4 정규화 출력 → `activity_events` 적재 행 매핑 레이어(ADR-0018).
 *
 * 파서(`parseForm4`)는 **거래(transaction)별로 펼친** 행을 내지만, `activity_events` 의 unique 키는
 * `(investor_id, accession_number, security_id)` 다. 한 Form 4 는 발행사 1곳(= 종목 1개)이므로
 * 그 공시의 모든 거래는 **정확히 한 행으로 집계**돼야 재실행이 중복을 만들지 않는다(멱등, ADR-0002).
 *
 * 집계 규칙(ADR-0018):
 *  - `sharesDelta` = 전 거래의 **부호 있는** 보유 변동 합(매수 +, 매도 −) → 순증감.
 *  - `eventType`   = 순증감 부호로 결정(≥0 → BUY, <0 → SELL). 빠른 레인 피드 척추.
 *  - `value`       = 가격 보고된 거래의 부호 있는 거래금액 합(전부 미보고 → null).
 *  - `pricePerShare` = 가격 보고된 거래의 **거래금액가중평균(VWAP, 양수)**. 부호는 shares/value 에만.
 *  - `sharesAfter` = **시간상 마지막 거래의 러닝 잔고**(종료 포지션). 그 거래에 잔고 미보고면 null.
 *  - `eventDate`   = 거래일 중 최신.
 *
 * 순수 함수: 네트워크·DB 없음. 식별자 해소(보고인 CIK→investorId, 발행사 CIK→securityId)와
 * **다중 보고인(버크셔+버핏 동일거래) 이중집계 방지**는 폴러 책임 — 폴러가 공시를 단일 투자자에
 * 귀속해 한 번만 이 함수를 부른다(`ctx.investorId`). `pctOfCompanyAfter`·`intent` 는 Form 4 에 없어 null.
 */

/** 폴러가 submissions 피드·식별자 해소로 채워 넣는, 파서가 알 수 없는 컨텍스트. */
export interface Form4MapContext {
  /** 해소된 투자자 id(보고인 CIK → investors.id). */
  investorId: number;
  /** 해소된 증권 id(발행사 CIK → securities.id). */
  securityId: number;
  /** submissions 피드의 제출일(YYYY-MM-DD) — 글로벌 피드 정렬 키. */
  filingDate: string;
  /** SEC accession(대시 포함) — 멱등 키. */
  accessionNumber: string;
  /** 원본 문서 URL(감사·UI 링크). */
  rawUrl: string;
}

/**
 * `activity_events` 적재 후보 행(도메인 표현, 숫자 타입).
 * drizzle insert(numeric→string) 변환은 DB 어댑터 레이어 책임.
 */
export interface NewActivityEvent {
  investorId: number;
  securityId: number;
  source: Source;
  formType: '4';
  eventType: EventType;
  eventDate: string;
  filingDate: string;
  /** 부호 있는 순보유변동(매수 +, 매도 −). */
  sharesDelta: number;
  /** 종료 잔고(마지막 거래 후, 양수). 미보고 → null. */
  sharesAfter: number | null;
  /** Form 4 는 회사대비 비율 미보고 → 항상 null. */
  pctOfCompanyAfter: null;
  /** VWAP(양수). 가격 보고 거래 없으면 null. */
  pricePerShare: number | null;
  /** 부호 있는 순거래금액. 전부 미보고 → null. */
  value: number | null;
  /** Form 4 에는 13D/G intent 없음 → 항상 null. */
  intent: null;
  accessionNumber: string;
  rawUrl: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** 시간상 마지막 거래(거래일 최신, 동일자면 문서 순서상 마지막)를 고른다 — 종료 잔고·eventDate 산출용. */
function latestEvent(events: Form4Event[]): Form4Event {
  let last = events[0]!;
  for (const e of events) {
    if (e.eventDate >= last.eventDate) last = e; // `>=`: 동일자에선 뒤 인덱스(나중 거래)가 이긴다.
  }
  return last;
}

/**
 * Form 4 한 건을 `activity_events` 한 행으로 집계한다(거래가 없으면 적재할 게 없어 null).
 *
 * ⚠️ `documentType` 필터(Form 3/5 배제)는 폴러 책임이다 — 이 함수는 넘어온 거래를 그대로 집계한다.
 */
export function mapForm4ToActivityEvent(
  parsed: ParsedForm4,
  ctx: Form4MapContext,
): NewActivityEvent | null {
  const events = parsed.events;
  if (events.length === 0) return null;

  const sharesDelta = events.reduce((s, e) => s + e.sharesDelta, 0);

  // 가격 보고된 거래만 VWAP·value 에 기여(value===null ⟺ price===null, 파서 컨벤션).
  const priced = events.filter((e) => e.value !== null);
  const value = priced.length ? round2(priced.reduce((s, e) => s + e.value!, 0)) : null;
  const absShares = priced.reduce((s, e) => s + Math.abs(e.sharesDelta), 0);
  const pricePerShare =
    absShares > 0 ? round6(priced.reduce((s, e) => s + Math.abs(e.value!), 0) / absShares) : null;

  const last = latestEvent(events);

  return {
    investorId: ctx.investorId,
    securityId: ctx.securityId,
    source: 'edgar',
    formType: '4',
    eventType: sharesDelta >= 0 ? 'BUY' : 'SELL',
    eventDate: last.eventDate,
    filingDate: ctx.filingDate,
    sharesDelta,
    sharesAfter: last.sharesAfter,
    pctOfCompanyAfter: null,
    pricePerShare,
    value,
    intent: null,
    accessionNumber: ctx.accessionNumber,
    rawUrl: ctx.rawUrl,
  };
}
