import { XMLParser } from 'fast-xml-parser';
import type { EventType } from '@app/shared';
import { asRecord, numOrNull, scalar, stripCik, toArray } from './xml';

/**
 * Schedule 13D / 13G(빠른·느린 레인) 구조화 XML 파서(2024-12 의무화, ARCHITECTURE §6).
 *
 * 순수 함수: raw XML → 정규화 스냅샷(`ParsedSchedule13DG`). 네트워크·DB 없음.
 * 한 공시의 표지(cover page) 사실만 추출한다 — 발행사(subject company)·CUSIP·보고인별
 * 합산지분/비율·active(13D)/passive(13G) intent. **이벤트 방향(증감)은 직전 보유와의
 * 비교가 필요**하므로 인제스트 레이어가 결정한다(아래 `eventType` 규칙).
 *
 * ⚠️ 13D 와 13G 는 **서로 다른 스키마**다(엘리먼트명·중첩 상이). 둘 다 공통 결과로 정규화:
 *  - 13D `xmlns=.../schedule13D`: `reportingPersons/reportingPersonInfo[]`, `aggregateAmountOwned`,
 *    `percentOfClass`, 보고인별 `reportingPersonCIK`, `coverPageHeader/dateOfEvent`, `issuerCIK`.
 *  - 13G `xmlns=.../schedule13g`: `coverPageHeaderReportingPersonDetails[]`,
 *    `reportingPersonBeneficiallyOwnedAggregateNumberOfShares`, `classPercent`(보고인 CIK 없음),
 *    `coverPageHeader/eventDateRequiresFilingThisStatement`, `issuerCik`(소문자).
 *  - CUSIP: X01 `issuerCUSIP`(직속) vs X02 `issuerCusips/issuerCusipNumber`.
 *
 * 식별자 해소(CIK/CUSIP→investors/securities)·다중 계열 보고인 이중집계 방지·
 * (investor, accession, security) 멱등 집계는 **인제스트 레이어**가 책임진다(`filerCik` 로 귀속).
 */

/** Schedule 13D/13G 정규화 양식(filings.form_type 미러, ADR-0006). */
export type Schedule13DGFormType = 'SC 13D' | '13D/A' | 'SC 13G' | '13G/A';

/** 표지 보고인 1인의 정규화 스냅샷(합산하지 않고 그대로 나열 — 이중집계는 인제스트). */
export interface Schedule13DGReportingPerson {
  /** 보고인 CIK(0패딩 제거). 13G 표지엔 보고인별 CIK 없음 → null. */
  cik: string | null;
  name: string;
  /** 총 수익적 소유 주식수(13D `aggregateAmountOwned` / 13G `...AggregateNumberOfShares`). */
  sharesOwned: number | null;
  /** 발행주식 대비 비율(%) (13D `percentOfClass` / 13G `classPercent`). */
  pctOfClass: number | null;
  soleVotingPower: number | null;
  sharedVotingPower: number | null;
  soleDispositivePower: number | null;
  sharedDispositivePower: number | null;
  /** SEC 보고인 유형 코드(IA/PN/OO/IN/HC…). 복수면 `,` 로 결합. */
  typeOfReportingPerson: string;
}

/** Schedule 13D/13G 구조화 XML 정규화 결과. */
export interface ParsedSchedule13DG {
  formType: Schedule13DGFormType;
  isAmendment: boolean;
  /** 수정 회차(`amendmentNo`). 원본이거나 미표기면 null. */
  amendmentNo: number | null;
  /** 13D=active(경영참여) / 13G=passive(패시브). intent enum 미러. */
  intent: 'active' | 'passive';
  /**
   * 단일 공시로 결정 가능한 이벤트 유형만 산출:
   *  - 원본(수정 아님) → `STAKE_NEW`(5% 신규 크로싱).
   *  - 수정분이며 보유 0(완전 청산) → `STAKE_EXIT`.
   *  - 그 외 수정분(증/감) → `null` → 인제스트가 직전 `shares_after` 와 비교해
   *    `STAKE_INCREASE`/`STAKE_DECREASE` 로 확정한다(스냅샷만으론 방향 불명).
   */
  eventType: Extract<EventType, 'STAKE_NEW' | 'STAKE_EXIT'> | null;
  /** 사건일(YYYY-MM-DD): 13D `dateOfEvent` / 13G `eventDateRequiresFilingThisStatement`. */
  eventDate: string;
  /** 직전 공시 accession(수정분 체이닝용). 없으면 null. */
  previousAccessionNumber: string | null;
  /** 제출 filer CIK(0패딩 제거) — 큐레이션 투자자 귀속의 1차 키(investors.external_id). */
  filerCik: string;
  securitiesClassTitle: string;
  issuer: { cik: string; name: string; cusip: string | null };
  reportingPersons: Schedule13DGReportingPerson[];
}

// ── XML 파서 인스턴스(parseTagValue:false → 모든 스칼라는 문자열, 결정적) ─────────
// 공용 탐색 헬퍼(asRecord/scalar/toArray/stripCik/numOrNull)는 `./xml` 에서 가져온다.
const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });

/** 보고인 CIK: 있으면 0패딩 제거, 없으면 null(13G 표지·NoCIK=Y 보고인). */
function cikOrNull(v: unknown): string | null {
  const raw = scalar(v);
  return raw ? stripCik(raw) : null;
}

/** MM/DD/YYYY → YYYY-MM-DD. 이미 ISO 면 그대로 통과. */
function toIsoDate(v: string | undefined): string {
  const s = (v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return s;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm!.padStart(2, '0')}-${dd!.padStart(2, '0')}`;
}

/** 단일/복수 `typeOfReportingPerson` → ',' 결합('IA','OO' → 'IA,OO'). */
function joinTypes(v: unknown): string {
  return toArray(v)
    .map(scalar)
    .filter((s): s is string => Boolean(s))
    .join(',');
}

/** 발행사 CUSIP: X01 `issuerCUSIP`(직속) 또는 X02 `issuerCusips/issuerCusipNumber`. */
function issuerCusip(issuerInfo: Record<string, unknown> | undefined): string | null {
  const direct = scalar(issuerInfo?.issuerCUSIP) ?? scalar(issuerInfo?.issuerCusip);
  if (direct) return direct;
  const cusips = asRecord(issuerInfo?.issuerCusips);
  return scalar(toArray(cusips?.issuerCusipNumber)[0]) ?? null;
}

function mapReportingPerson(node: unknown, schema: '13D' | '13G'): Schedule13DGReportingPerson {
  const rp = asRecord(node) ?? {};
  if (schema === '13D') {
    return {
      cik: cikOrNull(rp.reportingPersonCIK),
      name: scalar(rp.reportingPersonName) ?? '',
      sharesOwned: numOrNull(rp.aggregateAmountOwned),
      pctOfClass: numOrNull(rp.percentOfClass),
      soleVotingPower: numOrNull(rp.soleVotingPower),
      sharedVotingPower: numOrNull(rp.sharedVotingPower),
      soleDispositivePower: numOrNull(rp.soleDispositivePower),
      sharedDispositivePower: numOrNull(rp.sharedDispositivePower),
      typeOfReportingPerson: joinTypes(rp.typeOfReportingPerson),
    };
  }
  // 13G: 권리(power)는 reportingPersonBeneficiallyOwnedNumberOfShares 아래로 한 단계 더 들어간다.
  const powers = asRecord(rp.reportingPersonBeneficiallyOwnedNumberOfShares) ?? {};
  return {
    cik: cikOrNull(rp.reportingPersonCIK),
    name: scalar(rp.reportingPersonName) ?? '',
    sharesOwned: numOrNull(rp.reportingPersonBeneficiallyOwnedAggregateNumberOfShares),
    pctOfClass: numOrNull(rp.classPercent),
    soleVotingPower: numOrNull(powers.soleVotingPower),
    sharedVotingPower: numOrNull(powers.sharedVotingPower),
    soleDispositivePower: numOrNull(powers.soleDispositivePower),
    sharedDispositivePower: numOrNull(powers.sharedDispositivePower),
    typeOfReportingPerson: joinTypes(rp.typeOfReportingPerson),
  };
}

/**
 * Schedule 13D/13G 구조화 XML 을 정규화한다.
 *
 * ⚠️ `submissionType` 으로 13D/13G·원본/수정을 식별한다. 형식이 13D 도 13G 도 아니면 throw.
 */
export function parseSchedule13DG(xml: string): ParsedSchedule13DG {
  const doc = asRecord(asRecord(parser.parse(xml))?.edgarSubmission);
  if (!doc) throw new Error('parseSchedule13DG: <edgarSubmission> 루트를 찾을 수 없음');

  const headerData = asRecord(doc.headerData);
  const formData = asRecord(doc.formData);
  const coverPage = asRecord(formData?.coverPageHeader);
  const issuerInfo = asRecord(coverPage?.issuerInfo);

  const submissionType = (scalar(headerData?.submissionType) ?? '').trim();
  const is13D = submissionType.includes('13D');
  const is13G = submissionType.includes('13G');
  if (!is13D && !is13G) {
    throw new Error(`parseSchedule13DG: 13D/13G 가 아닌 submissionType: "${submissionType}"`);
  }
  const isAmendment = /\/A$/.test(submissionType);
  const formType: Schedule13DGFormType = is13D
    ? isAmendment
      ? '13D/A'
      : 'SC 13D'
    : isAmendment
      ? '13G/A'
      : 'SC 13G';
  const intent: 'active' | 'passive' = is13D ? 'active' : 'passive';

  // 보고인: 13D 와 13G 의 컨테이너/엘리먼트가 다르므로 스키마별로 워킹.
  const reportingPersons: Schedule13DGReportingPerson[] = is13D
    ? toArray(asRecord(formData?.reportingPersons)?.reportingPersonInfo).map((n) =>
        mapReportingPerson(n, '13D'),
      )
    : toArray(formData?.coverPageHeaderReportingPersonDetails).map((n) =>
        mapReportingPerson(n, '13G'),
      );

  // eventType: 원본=STAKE_NEW. 수정분은 보유 0(완전 청산)만 STAKE_EXIT 로 단정,
  // 그 외 증감은 단일 문서로 방향 불명 → null(인제스트가 직전 보유와 비교해 확정).
  const maxShares = reportingPersons.reduce((m, r) => Math.max(m, r.sharesOwned ?? 0), 0);
  const eventType: ParsedSchedule13DG['eventType'] = !isAmendment
    ? 'STAKE_NEW'
    : maxShares === 0
      ? 'STAKE_EXIT'
      : null;

  const filer = asRecord(toArray(asRecord(headerData?.filerInfo)?.filer)[0]);
  const filerCik = stripCik(scalar(asRecord(filer?.filerCredentials)?.cik));

  const eventDateRaw =
    scalar(coverPage?.dateOfEvent) ?? scalar(coverPage?.eventDateRequiresFilingThisStatement);

  return {
    formType,
    isAmendment,
    amendmentNo: numOrNull(coverPage?.amendmentNo),
    intent,
    eventType,
    eventDate: toIsoDate(eventDateRaw),
    previousAccessionNumber: scalar(headerData?.previousAccessionNumber) ?? null,
    filerCik,
    securitiesClassTitle: scalar(coverPage?.securitiesClassTitle) ?? '',
    issuer: {
      cik: stripCik(scalar(issuerInfo?.issuerCIK) ?? scalar(issuerInfo?.issuerCik)),
      name: scalar(issuerInfo?.issuerName) ?? '',
      cusip: issuerCusip(issuerInfo),
    },
    reportingPersons,
  };
}
