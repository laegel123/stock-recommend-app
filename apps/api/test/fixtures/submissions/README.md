# Submissions feed fixtures

골든 테스트용 **실제 SEC EDGAR submissions 피드**(`data.sec.gov/submissions/CIK{10}.json`).
빠른/느린 레인 폴러의 진입점인 `parseSubmissions()` 회귀 방지(PLAN §인제스트, ARCHITECTURE §6).

## `pershing-square-2026-06.json`

- **출처**: <https://data.sec.gov/submissions/CIK0001336528.json> (2026-06 취득)
- **엔티티**: Pershing Square Capital Management, L.P. (CIK 1336528)
- **트리밍**: 실제 피드는 `filings.recent` 에 735건이 있다. 대표 9건만 남겨 **빠른·느린 레인 + 비추적 폼**을
  모두 커버하도록 잘랐다(필드명·값은 원본 그대로, **신선순=최신 먼저** 정렬 보존). 16개 병렬 배열과
  `filings.files`(여기선 빈 배열)는 구조 그대로 유지.
- **포함 폼**: `4`(빠른), `13F-HR`·`13F-HR/A`(느린), `SC 13D`·`SC 13D/A`·`SC 13G`·`SC 13G/A`(빠른/패시브),
  그리고 **비추적** `3`(Form 3 — 빠른 레인 `4` 와 혼동 금지)·`DFAN14A`.
- **검증 포인트**:
  - 병렬 배열을 신선순 그대로 9건으로 zip, `cik` 0패딩 제거(`0001336528`→`1336528`).
  - 빈 문자열 `reportDate`/`primaryDocDescription` → `null`.
  - 문서 URL 빌드: `.../Archives/edgar/data/{cik}/{accNoDashes}/{primaryDocument}`.
    **XSL 렌더 경로**(`xslF345X06/form4.xml`, `xslForm13F_X02/primary_doc.xml`)는 `documentUrl` 에
    그대로 두되, **파싱 가능한 원본 XML**은 `rawDocumentUrl`(`xsl*/` 접두 제거)로 노출 → 파서가 먹는 건 raw.
  - 폼 필터(`FAST_LANE_FORMS`/`SLOW_LANE_FORMS`)는 **정확 일치** — `3`·`DFAN14A` 는 제외, `4` 만 빠른 레인.

`pershing-square-2026-06.expected.json` 은 `parseSubmissions()` 의 정규화 출력(`ParsedSubmissions`)과
deep-equal 해야 한다. 원본은 SEC 공공 도메인. User-Agent `stock-recommend-app laegel1@gmail.com` 로 취득.
