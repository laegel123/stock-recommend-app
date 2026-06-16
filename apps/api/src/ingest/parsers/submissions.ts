import { scalar, stripCik } from './xml';

/**
 * SEC EDGAR submissions 피드(`data.sec.gov/submissions/CIK{10}.json`) 파서 — 폴러 진입점.
 *
 * 순수 함수: raw JSON → 정규화 공시 목록(`ParsedSubmissions`). 네트워크·DB 없음.
 * 한 투자자(CIK)의 **최근 공시 인덱스**를 신선순(최신 먼저) 그대로 펼치고, 각 공시의
 * accession·raw 폼·**정규 폼(form_type enum)**·일자·원본 문서 URL·구조화 여부를 산출한다.
 * **무엇을 fetch/파싱/적재할지** 결정(미수집 accession 선별·폼별 분기 파서 호출·멱등 upsert)은
 * 인제스트(edgar-fast/13f) 레이어 책임.
 *
 * ⚠️ 피드의 `filings.recent` 는 16개 **병렬 배열**(accessionNumber[], form[], …)이다. 동일 인덱스가
 * 한 공시를 이룬다. 1000건 초과분은 `filings.files`(별도 페이지 JSON)로 분리되는데, 큐레이션 투자자는
 * 대개 그 안에 들어와 `files` 가 비어 있다. 백필이 필요하면 폴러가 `olderFilePages` 를 추가로 fetch.
 *
 * ⚠️ SEC 는 같은 양식을 **표기를 달리해** 내보낸다(신 `SC 13G` ↔ 구 `SCHEDULE 13G`, 수정분 `/A`).
 * raw `formType` 은 피드 그대로 보존하되, `canonicalForm` 으로 schema `form_type` enum 으로 폴딩해
 * **레인 필터가 표기 차이로 공시를 누락하지 않게** 한다. 비추적 폼(`3`·`5`·`DFAN14A`…)은 null.
 *
 * ⚠️ `primaryDocument` 는 SEC 가 **XSL 렌더 경로**(`xslF345X06/form4.xml`,
 * `xslSCHEDULE_13D_X02/primary_doc.xml`)로 줄 때가 있다. 이는 사람용 렌더 뷰라 파서가 못 먹는다.
 * → `rawDocumentUrl` 로 `xsl…/` 접두를 제거한 **원본 XML** URL을 따로 노출한다(HTML 공시는 동일).
 * `isStructured` 는 **폼 라벨이 아니라 원본 문서 확장자**(.xml) 기준 — 레거시 라벨이어도 문서가 구조화
 * XML 이면 true, 구형 `.htm` 공시는 false(인제스트가 XML 파서로 못 먹으니 스킵).
 */

/** schema `form_type` enum 의 EDGAR 부분집합(DART majorstock/elestock 제외). */
export type CanonicalForm = '4' | 'SC 13D' | '13D/A' | 'SC 13G' | '13G/A' | '13F-HR' | '13F-HR/A';

/** 빠른 레인(사건 기반) 정규 폼 — `canonicalForm` 기준 매칭(레거시/수정 표기 자동 흡수). */
export const FAST_LANE_FORMS: readonly CanonicalForm[] = [
  '4',
  'SC 13D',
  '13D/A',
  'SC 13G',
  '13G/A',
];
/** 느린 레인(13F 분기 포트폴리오) 정규 폼. */
export const SLOW_LANE_FORMS: readonly CanonicalForm[] = ['13F-HR', '13F-HR/A'];

/**
 * raw SEC 폼 → schema `form_type` enum 정규형. 미추적/미지원 폼은 null.
 *
 * 표기 변형 흡수: `SC 13D`/`SCHEDULE 13D` → `SC 13D`, `…/A` → `13D/A`(enum 의 수정분 표기),
 * 13G 동형. Form 4 계열(`4`·`4/A`) → `4`(enum 에 `4/A` 없음 — 수정 사실은 raw `formType` 에 남음).
 */
export function canonicalizeForm(raw: string): CanonicalForm | null {
  const f = raw.trim().toUpperCase();
  switch (f) {
    case '4':
    case '4/A':
      return '4';
    case 'SC 13D':
    case 'SCHEDULE 13D':
      return 'SC 13D';
    case 'SC 13D/A':
    case 'SCHEDULE 13D/A':
      return '13D/A';
    case 'SC 13G':
    case 'SCHEDULE 13G':
      return 'SC 13G';
    case 'SC 13G/A':
    case 'SCHEDULE 13G/A':
      return '13G/A';
    case '13F-HR':
      return '13F-HR';
    case '13F-HR/A':
      return '13F-HR/A';
    default:
      return null;
  }
}

/** 정규화된 공시 1건(submissions.recent 한 인덱스). */
export interface SubmissionFiling {
  /** SEC accession(대시 포함): `0001140361-26-024482`. */
  accessionNumber: string;
  /** 대시 제거 → 아카이브 폴더명: `000114036126024482`. */
  accessionNoDashes: string;
  /** raw SEC 폼: `4` · `SC 13D` · `SCHEDULE 13D/A` · `13F-HR` …(피드 그대로). */
  formType: string;
  /** schema `form_type` enum 정규형(표기 변형 폴딩). 비추적 폼은 null. */
  canonicalForm: CanonicalForm | null;
  /** 제출일(YYYY-MM-DD). 글로벌 피드 정렬 키. */
  filingDate: string;
  /** 보고기준일(YYYY-MM-DD). 사건 공시는 빈문자 → null. */
  reportDate: string | null;
  /** 접수 타임스탬프(ISO). 미기재 → null. */
  acceptanceDateTime: string | null;
  /** 피드의 primaryDocument(XSL 렌더 경로 포함 가능). */
  primaryDocument: string;
  /** primaryDocument 설명. 빈문자 → null. */
  primaryDocDescription: string | null;
  /** 원본 문서가 구조화 XML(.xml) 인가 — 폼 라벨 아닌 문서 확장자 기준. `.htm` 레거시는 false. */
  isStructured: boolean;
  /** 공시 폴더 URL(말미 슬래시 포함). info table 등 보조 문서 탐색 기준. */
  directoryUrl: string;
  /** primaryDocument 절대 URL(피드 그대로 — XSL 렌더 뷰일 수 있음). */
  documentUrl: string;
  /** 파싱 가능한 **원본** 문서 URL(`xsl…/` 접두 제거). HTML 공시는 documentUrl 과 동일. */
  rawDocumentUrl: string;
}

/** submissions 피드 정규화 결과. */
export interface ParsedSubmissions {
  /** CIK(0패딩 제거) — investors.external_id 시드 형식. */
  cik: string;
  /** 엔티티명(피드 `name`). */
  name: string;
  /** 최근 공시(신선순 보존), forms 옵션 지정 시 canonicalForm 정확 일치 필터링. */
  filings: SubmissionFiling[];
  /** 1000건 초과분 페이지 파일명(`filings.files[].name`). 백필용. 보통 빈 배열. */
  olderFilePages: string[];
}

export interface ParseSubmissionsOptions {
  /** 지정 시 `canonicalForm` 이 이 집합에 속한 공시만(예: FAST_LANE_FORMS). 미지정 → 전체. */
  forms?: Iterable<CanonicalForm>;
}

const SEC_ARCHIVES = 'https://www.sec.gov/Archives/edgar/data';

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/** 빈/공백 문자열·미기재 → null, 그 외 trim 문자열. */
function strOrNull(v: unknown): string | null {
  const s = scalar(v)?.trim();
  return s ? s : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** 병렬 배열에서 i 번째 스칼라를 문자열로(미기재 → ''). */
function at(arr: unknown, i: number): string {
  return scalar(asArray(arr)[i]) ?? '';
}

/** XSL 렌더 접두(`xslF345X06/`, `xslSCHEDULE_13D_X02/` …) 제거 → 원본 문서 경로. */
function stripXslPrefix(doc: string): string {
  return doc.replace(/^xsl[^/]*\//, '');
}

/**
 * submissions 피드 JSON 을 정규화한다(문자열 또는 이미 파싱된 객체 입력 모두 허용).
 *
 * @throws cik/name/filings.recent 구조를 못 찾으면 throw(피드 형식 변경·잘못된 입력 조기 발견).
 */
export function parseSubmissions(
  input: string | unknown,
  opts: ParseSubmissionsOptions = {},
): ParsedSubmissions {
  const root = asRecord(typeof input === 'string' ? JSON.parse(input) : input);
  if (!root) throw new Error('parseSubmissions: 최상위 객체를 찾을 수 없음');

  const filingsNode = asRecord(root.filings);
  const recent = asRecord(filingsNode?.recent);
  if (!recent) throw new Error('parseSubmissions: filings.recent 를 찾을 수 없음');

  const cik = stripCik(scalar(root.cik));
  const name = scalar(root.name) ?? '';

  const formFilter = opts.forms ? new Set<CanonicalForm>(opts.forms) : null;

  const accessions = asArray(recent.accessionNumber);
  const filings: SubmissionFiling[] = [];
  for (let i = 0; i < accessions.length; i++) {
    const formType = at(recent.form, i);
    const canonicalForm = canonicalizeForm(formType);
    if (formFilter && (canonicalForm === null || !formFilter.has(canonicalForm))) continue;

    const accessionNumber = at(recent.accessionNumber, i);
    const accessionNoDashes = accessionNumber.replace(/-/g, '');
    const primaryDocument = at(recent.primaryDocument, i);
    const rawDocument = stripXslPrefix(primaryDocument);
    const directoryUrl = `${SEC_ARCHIVES}/${cik}/${accessionNoDashes}/`;

    filings.push({
      accessionNumber,
      accessionNoDashes,
      formType,
      canonicalForm,
      filingDate: at(recent.filingDate, i),
      reportDate: strOrNull(asArray(recent.reportDate)[i]),
      acceptanceDateTime: strOrNull(asArray(recent.acceptanceDateTime)[i]),
      primaryDocument,
      primaryDocDescription: strOrNull(asArray(recent.primaryDocDescription)[i]),
      isStructured: rawDocument.toLowerCase().endsWith('.xml'),
      directoryUrl,
      documentUrl: directoryUrl + primaryDocument,
      rawDocumentUrl: directoryUrl + rawDocument,
    });
  }

  const olderFilePages = asArray(filingsNode?.files)
    .map((f) => scalar(asRecord(f)?.name))
    .filter((n): n is string => Boolean(n));

  return { cik, name, filings, olderFilePages };
}
