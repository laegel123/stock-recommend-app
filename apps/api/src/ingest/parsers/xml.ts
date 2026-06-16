/**
 * SEC EDGAR XML 파서 공용 탐색 헬퍼(`form4`·`sc13dg`·`f13f-infotable` 공유, ADR-0015 §DRY).
 *
 * `fast-xml-parser`(parseTagValue:false) 출력은 **모든 스칼라가 문자열**인 느슨한 객체 트리다
 * (반복 요소는 배열, 단일이면 객체). 이 모듈은 그 트리를 **결정적**으로 탐색·정규화하는 작은
 * 순수 함수만 모은다 — 파서 3종에 복붙되어 미세하게 분기(예: `num` 0폴백 vs `numOrNull` null)하던
 * 헬퍼를 단일 진실원으로 통일해 동작 일관성을 보장한다.
 *
 * ⚠️ `XMLParser` 인스턴스 설정(예: f13f 의 `removeNSPrefix`)은 파서별로 다르므로 각 파일에 둔다.
 */

/** 객체(비배열)면 `Record` 로 좁히고, 아니면 undefined. 중첩 노드 워킹의 기본 가드. */
export function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/** 문자열/숫자/불리언 스칼라를 문자열로. 그 외(객체·배열·null·undefined) → undefined. */
export function scalar(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

/** 반복 요소는 배열, 단일이면 객체 → 항상 배열로 정규화. */
export function toArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** EDGAR CIK 0패딩 제거('0000921669' → '921669'). investors.external_id 시드와 동일 형식. */
export function stripCik(cik: string | undefined): string {
  return (cik ?? '').replace(/^0+(?=\d)/, '');
}

/** 수치 스칼라(미기재·빈문자·비수치 → null). 값 부재를 0과 구분해야 하는 필드용. */
export function numOrNull(v: unknown): number | null {
  const s = scalar(v);
  if (s === undefined || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * 수치 스칼라(미기재·빈문자·비수치 → 0). 합산되는 필드(value/shares/votingAuthority)용.
 *
 * ⚠️ 손상된 비수치 입력을 **조용히 0** 으로 강제하므로 합산에 구멍이 날 수 있다. 파서는 사실에
 * 충실할 뿐 값의 타당성을 검증하지 않는다 → **range-check·plausibility 검증은 인제스트 레이어 책임**.
 */
export function num(v: unknown): number {
  return numOrNull(v) ?? 0;
}
