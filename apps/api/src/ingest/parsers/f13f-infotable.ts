import { XMLParser } from 'fast-xml-parser';
import { asRecord, num, scalar, toArray } from './xml';

/**
 * 13F-HR information table(느린 레인) XML 파서 → `holdings` 후보(ARCHITECTURE §5/§6, PLAN step 5).
 *
 * 순수 함수: raw XML → 정규화 보유(`Parsed13FInfoTable`). 네트워크·DB 없음. 한 13F 공시의
 * 전체 포트폴리오 스냅샷(각 `<infoTable>` 1행)을 **원문 순서·중복 그대로** 산출한다. 식별자 해소
 * (CUSIP→securities)·**중복 CUSIP 합산**((filing, security) 1행)·`pct_of_portfolio` 계산·멱등은
 * **인제스트 레이어** 책임. 파서는 사실에 충실하되 **단 한 가지 정규화만 책임진다: 값 스케일**.
 *
 * ⚠️ 파서는 `value`/`shares` 의 **타당성(range/plausibility)을 검증하지 않는다** — 비수치는 0 으로
 * 충실히 강제할 뿐이다(`num`). 손상값 거부·범위 검사는 **인제스트 레이어 책임**이다.
 *
 * ⚠️ **값 스케일 quirk(ADR-0015)**: SEC 는 2023-01-03 이후 *제출분*부터 `value` 를 **천 달러 단위가
 * 아닌 달러 단위**로 보고하도록 Form 13F 를 개정했다. 그 이전 제출분은 `value × 1000` 가 실제 USD.
 * information table XML 자체엔 제출일이 없으므로(표지 primary_doc 에 있음) 호출자가 `filedAt`(또는
 * 명시적 `valueScale`)을 넘겨야 한다. `valueUsd` 는 항상 **달러 정수**로 정규화한다.
 *
 * ⚠️ 일부 제출인은 information table 을 **네임스페이스 접두사**(`<ns1:infoTable>`)로 보낸다 →
 * `removeNSPrefix:true` 로 접두사를 제거해 기본 네임스페이스 형태와 동일하게 처리한다.
 */

/** value 스케일 시대: 2023 이전 제출=천 달러, 2023-01-03 이후 제출=달러(ADR-0015). */
export type ValueScale = 'thousands' | 'dollars';

/** sshPrnamtType: SH=주식 수, PRN=채권 등 원금액. */
export type SharesType = 'SH' | 'PRN';

/** 정규화된 13F 보유 1행(→ holdings 한 행의 후보; 중복 CUSIP 미합산). */
export interface Parsed13FHolding {
  nameOfIssuer: string;
  titleOfClass: string;
  /** 9자리 CUSIP(원문 그대로). 티커 해소는 인제스트(cusip_map/OpenFIGI). */
  cusip: string;
  /** Bloomberg FIGI(2023+ 스키마 신규, optional). 미기재면 null. */
  figi: string | null;
  /** **정규화된** 시장가치(USD 정수). 천 달러 시대는 ×1000 적용 후 값. */
  valueUsd: number;
  /** 원문 `value`(정규화 전; 감사·디버깅용). 달러 시대면 valueUsd 와 동일. */
  valueReported: number;
  /** 보유 수량(SH) 또는 원금액(PRN) = sshPrnamt(항상 양수). */
  shares: number;
  sharesType: SharesType;
  /** 풋/콜 옵션이면 'Put'|'Call', 보통주·채권 등은 null. holdings.put_call 미러. */
  putCall: 'Put' | 'Call' | null;
  /** 투자재량 코드(SOLE/DFND/OTR). */
  investmentDiscretion: string;
  /** 의결권 권한(주식 수). 옵션 등은 주로 None 에 계상. */
  votingAuthority: { sole: number; shared: number; none: number };
}

/** 13F information table 정규화 결과(한 공시의 전체 포트폴리오 스냅샷). */
export interface Parsed13FInfoTable {
  /** 적용된 값 스케일 시대(달러 정규화에 사용). */
  valueScale: ValueScale;
  /** 정규화 보유 행(원문 순서 유지, 중복 CUSIP 미합산). */
  holdings: Parsed13FHolding[];
  /** Σ valueUsd = 포트폴리오 총 시장가치(USD 정수). pct_of_portfolio 분모. */
  totalValueUsd: number;
  /** 보유 행 수(= holdings.length). */
  holdingCount: number;
}

/**
 * value 옵션: 호출자(인제스트)가 제출일 또는 스케일을 제공해 값 정규화를 결정.
 * ⚠️ `filedAt` 과 `valueScale` 중 **최소 하나는 필수** — 둘 다 없으면 스케일 미결정이라 throw.
 */
export interface Parse13FOptions {
  /** 13F 제출일(**엄격 ISO** `YYYY-MM-DD`). 2023-01-03 이후면 달러, 이전이면 천 달러로 해석. */
  filedAt?: string;
  /** 스케일 직접 지정(백필·테스트). 제공 시 `filedAt` 보다 **우선**. */
  valueScale?: ValueScale;
}

/** SEC Form 13F 개정 발효일 — 이 날짜 **이후 제출분**부터 value 를 달러로 보고(ADR-0015). */
const DOLLARS_ERA_START = '2023-01-03';

// ── XML 파서 인스턴스(parseTagValue:false → 모든 스칼라는 문자열, 결정적; ns 접두사 제거) ──
// 탐색 헬퍼(asRecord/scalar/toArray/num)는 `./xml` 공용 모듈에서 가져온다.
const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  removeNSPrefix: true,
});

/** 엄격 ISO 날짜(YYYY-MM-DD)만 허용 — lexicographic 스케일 비교의 전제. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * filedAt/valueScale 옵션 → 적용 스케일. **fail-loud**(ADR-0015): 조용한 기본값을 두지 않는다.
 *
 * 값 스케일 오판은 정적으로 못 잡는 **1000× 데이터 오염**(다운스트림 합의·랭킹 붕괴)이라 두 가지
 * silent 실패 경로를 막는다:
 *  1. `valueScale` 우선. 없으면 `filedAt` 을 **엄격 ISO 검증** 후 2023-01-03(포함) 기준 비교.
 *     비-ISO(예: `05/15/2025`)는 `'0' < '2'` 로 천 달러 **오판** → 검증 실패 시 throw.
 *  2. 둘 다 없으면 throw — 과거 백필에서 `filedAt` 누락 시 달러로 가정해 1000× 작게 적재되는 사고 방지.
 */
function resolveScale(opts: Parse13FOptions): ValueScale {
  if (opts.valueScale) return opts.valueScale;
  if (opts.filedAt !== undefined) {
    if (!ISO_DATE.test(opts.filedAt)) {
      throw new Error(
        `parse13FInfoTable: filedAt 은 엄격 ISO(YYYY-MM-DD) 여야 함(받음: "${opts.filedAt}"). ` +
          '값 스케일을 lexicographic 으로 비교하므로 비-ISO 는 1000× 오판 위험 → 거부.',
      );
    }
    return opts.filedAt >= DOLLARS_ERA_START ? 'dollars' : 'thousands';
  }
  throw new Error(
    'parse13FInfoTable: filedAt(ISO) 또는 valueScale 중 하나는 필수 — ' +
      '값 스케일을 정할 수 없으면 1000× 오염 위험이라 조용한 달러 기본값을 두지 않음(ADR-0015).',
  );
}

function mapHolding(node: unknown, scale: ValueScale): Parsed13FHolding {
  const it = asRecord(node) ?? {};
  const amt = asRecord(it.shrsOrPrnAmt) ?? {};
  const voting = asRecord(it.votingAuthority) ?? {};

  const valueReported = num(it.value);
  const valueUsd = scale === 'thousands' ? valueReported * 1000 : valueReported;

  const pcRaw = scalar(it.putCall);
  const putCall = pcRaw === 'Put' ? 'Put' : pcRaw === 'Call' ? 'Call' : null;
  const sharesType: SharesType = scalar(amt.sshPrnamtType) === 'PRN' ? 'PRN' : 'SH';

  return {
    nameOfIssuer: scalar(it.nameOfIssuer) ?? '',
    titleOfClass: scalar(it.titleOfClass) ?? '',
    cusip: scalar(it.cusip) ?? '',
    figi: scalar(it.figi) ?? null,
    valueUsd,
    valueReported,
    shares: num(amt.sshPrnamt),
    sharesType,
    putCall,
    investmentDiscretion: scalar(it.investmentDiscretion) ?? '',
    votingAuthority: {
      sole: num(voting.Sole),
      shared: num(voting.Shared),
      none: num(voting.None),
    },
  };
}

/**
 * 13F information table XML 을 정규화한다.
 *
 * ⚠️ `value` 스케일 정규화에 제출일이 **필수**다 → `opts.filedAt`(엄격 ISO, 권장) 또는
 * `opts.valueScale` 제공. 둘 다 없거나 filedAt 이 비-ISO 면 1000× 오판 방지를 위해 throw.
 * 루트 `<informationTable>` 가 없으면 throw.
 */
export function parse13FInfoTable(xml: string, opts: Parse13FOptions = {}): Parsed13FInfoTable {
  const doc = asRecord(parser.parse(xml));
  // 빈 표(`<informationTable/>`)는 fast-xml-parser 가 ''로 파싱 → 루트 '존재'는 키 유무로 판단.
  if (!doc || !('informationTable' in doc)) {
    throw new Error('parse13FInfoTable: <informationTable> 루트를 찾을 수 없음');
  }
  const root = asRecord(doc.informationTable) ?? {};

  const scale = resolveScale(opts);
  const holdings = toArray(root.infoTable).map((n) => mapHolding(n, scale));
  const totalValueUsd = holdings.reduce((s, h) => s + h.valueUsd, 0);

  return { valueScale: scale, holdings, totalValueUsd, holdingCount: holdings.length };
}
