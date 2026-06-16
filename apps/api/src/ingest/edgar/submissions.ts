import type { Lane } from '@app/shared';
import { stripCik } from '../parsers/xml';

/**
 * SEC EDGAR submissions 피드(`data.sec.gov/submissions/CIK{10}.json`) 파서(PLAN §인제스트, ARCH §빠른 레인).
 *
 * 순수 함수: raw JSON → 정규화 `ParsedSubmissions`. 네트워크·DB 없음(폴링·페치는 인제스트 레이어).
 * 피드의 `filings.recent` 는 **columnar**(병렬 배열) 이라 행으로 풀고, **추적 양식만** 남긴다.
 *
 * 정규화 책임:
 *  - 양식 표기 흡수: SEC 는 같은 공시를 `SC 13G`(신) 와 `SCHEDULE 13G`(구) 두 표기로 낸다 →
 *    canonical `form_type` enum 으로 통일. 수정분(`/A`)은 base 양식 + `isAmendment` 로 보존
 *    (단 `4/A` 는 enum 에 없어 `4` 로 흡수 — 수정 사실은 `isAmendment` 가 유지).
 *  - lane 태깅: 사건기반(4·13D·13G)=fast, 분기 포트폴리오(13F-HR)=slow.
 *  - raw 문서 URL: 2024 구조화 의무화 후 `primaryDocument` 는 **xsl 렌더 경로**
 *    (`xslF345X06/ownership.xml`)라 기계판독 raw XML 은 프리픽스를 벗긴 경로
 *    (`ownership.xml`)에 있다 → `primaryDocUrl` 은 raw 문서를 가리킨다. 구형(.htm)은
 *    구조화 아님(`isStructured=false`) → 파서가 못 먹으니 인제스트가 스킵해야 한다.
 *
 * ⚠️ `filings.recent` 는 최근 ~1000건만 담는다. 더 오래된 공시는 `filings.files` 오버플로
 * (분할 JSON)로 빠지며 백필 전용이다. 본 파서는 `recent` 만 풀고 오버플로 **파일명**만 노출한다.
 */

/** EDGAR 인제스트가 다루는 canonical 양식(formTypeEnum 중 source=edgar). */
export type EdgarFormType = '4' | 'SC 13D' | '13D/A' | 'SC 13G' | '13G/A' | '13F-HR' | '13F-HR/A';

/** 정규화된 공시 1건(→ 페치/파싱 대상). */
export interface EdgarFilingRef {
  /** dashed accession(0001193125-26-239886). filings.accession_number 형식. */
  accessionNumber: string;
  /** canonical 양식(표기·수정분 흡수). */
  formType: EdgarFormType;
  /** 피드 원본 양식 문자열(SCHEDULE 13G / 4/A 등) — 디버깅·감사용 보존. */
  formRaw: string;
  /** 수정분(/A) 여부. `4/A`→`4` 처럼 흡수돼도 이 플래그로 수정 사실을 유지. */
  isAmendment: boolean;
  /** 피드 레인: 사건기반=fast, 분기 13F=slow. */
  lane: Lane;
  /** 제출일(YYYY-MM-DD). */
  filingDate: string;
  /** 보고 기준일(YYYY-MM-DD). 사건 공시(13D/G 등)는 빈 값 → null. */
  reportDate: string | null;
  /** 수리 시각(ISO). 같은 날 공시의 결정적 정렬 키. */
  acceptanceDateTime: string;
  /** 피드 원본 primaryDocument(구조화 시 xsl 렌더 경로 포함). */
  primaryDocument: string;
  /** raw 기계판독 문서명(xsl 렌더 프리픽스 제거). */
  primaryDocName: string;
  /** raw 문서가 구조화 XML(.xml)인지 — false 면 구형 HTML(파서 불가). */
  isStructured: boolean;
  /** 공시 폴더 절대 URL(끝에 `/`). */
  filingDirUrl: string;
  /** raw 문서 절대 URL(= filingDirUrl + primaryDocName). */
  primaryDocUrl: string;
}

/** submissions 피드 정규화 결과. */
export interface ParsedSubmissions {
  /** 0패딩 제거 CIK(investors.external_id 형식). */
  cik: string;
  /** 발행/제출 엔터티명. */
  name: string;
  /** 추적 양식만, 피드 순서(최신순) 유지. */
  filings: EdgarFilingRef[];
  /** 백필용 오버플로 파일명(구형 공시 분할 JSON). 없으면 []. */
  overflowFiles: string[];
}

/** 양식 정규화 결과(추적 대상만). 미추적이면 null. */
interface FormClass {
  formType: EdgarFormType;
  isAmendment: boolean;
  lane: Lane;
}

/**
 * 피드 원본 양식 문자열 → canonical 분류. 미추적 양식(3·5·8-K·11-K 등)은 null.
 *
 * `SCHEDULE 13X` → `SC 13X` 흡수 후 base/수정분으로 가른다. `4/A` 는 enum 에 `4/A` 가 없어
 * `4` 로 흡수하되 `isAmendment=true` 로 수정 사실을 유지한다.
 */
export function classifyForm(formRaw: string): FormClass | null {
  const norm = formRaw
    .trim()
    .toUpperCase()
    .replace(/^SCHEDULE\s+/, 'SC ');
  const isAmendment = norm.endsWith('/A');
  switch (norm) {
    case '4':
    case '4/A':
      return { formType: '4', isAmendment, lane: 'fast' };
    case 'SC 13D':
      return { formType: 'SC 13D', isAmendment, lane: 'fast' };
    case 'SC 13D/A':
      return { formType: '13D/A', isAmendment, lane: 'fast' };
    case 'SC 13G':
      return { formType: 'SC 13G', isAmendment, lane: 'fast' };
    case 'SC 13G/A':
      return { formType: '13G/A', isAmendment, lane: 'fast' };
    case '13F-HR':
      return { formType: '13F-HR', isAmendment, lane: 'slow' };
    case '13F-HR/A':
      return { formType: '13F-HR/A', isAmendment, lane: 'slow' };
    default:
      return null;
  }
}

/** xsl 렌더 프리픽스(`xslF345X06/`)를 벗겨 raw 문서명을 얻는다. 없으면 그대로. */
function rawDocName(primaryDocument: string): string {
  return primaryDocument.replace(/^xsl[^/]*\//, '');
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))) : [];
}

/**
 * submissions 피드 JSON 을 정규화한다. 추적 양식만 피드 순서로 남긴다.
 *
 * @throws `filings.recent` 컬럼 구조가 없으면(스키마 변경 등) throw — 조용한 빈 결과 방지.
 */
export function parseSubmissions(json: string): ParsedSubmissions {
  const doc = JSON.parse(json) as Record<string, unknown>;
  const filings = (doc.filings ?? {}) as Record<string, unknown>;
  const recent = (filings.recent ?? {}) as Record<string, unknown>;

  const accessionNumber = asStringArray(recent.accessionNumber);
  const form = asStringArray(recent.form);
  if (accessionNumber.length === 0 || form.length !== accessionNumber.length) {
    throw new Error('parseSubmissions: filings.recent 의 columnar 배열이 비었거나 불일치');
  }
  const filingDate = asStringArray(recent.filingDate);
  const reportDate = asStringArray(recent.reportDate);
  const acceptanceDateTime = asStringArray(recent.acceptanceDateTime);
  const primaryDocument = asStringArray(recent.primaryDocument);

  const cik = stripCik(String(doc.cik ?? ''));
  const name = String(doc.name ?? '');

  const refs: EdgarFilingRef[] = [];
  for (let i = 0; i < accessionNumber.length; i++) {
    const cls = classifyForm(form[i] ?? '');
    if (!cls) continue; // 미추적 양식 제외

    const accNoDashes = (accessionNumber[i] ?? '').replace(/-/g, '');
    const filingDirUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDashes}/`;
    const primaryDocName = rawDocName(primaryDocument[i] ?? '');
    const report = reportDate[i] ?? '';

    refs.push({
      accessionNumber: accessionNumber[i] ?? '',
      formType: cls.formType,
      formRaw: form[i] ?? '',
      isAmendment: cls.isAmendment,
      lane: cls.lane,
      filingDate: filingDate[i] ?? '',
      reportDate: report === '' ? null : report,
      acceptanceDateTime: acceptanceDateTime[i] ?? '',
      primaryDocument: primaryDocument[i] ?? '',
      primaryDocName,
      isStructured: primaryDocName.toLowerCase().endsWith('.xml'),
      filingDirUrl,
      primaryDocUrl: filingDirUrl + primaryDocName,
    });
  }

  const overflowFiles = Array.isArray(filings.files)
    ? (filings.files as Array<Record<string, unknown>>).map((f) => String(f.name ?? ''))
    : [];

  return { cik, name, filings: refs, overflowFiles };
}
