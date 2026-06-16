# Submissions feed fixtures

골든 테스트용 **실제 SEC EDGAR submissions 피드**(`data.sec.gov/submissions/CIK{10}.json`).
빠른/느린 레인 폴러의 진입점인 `parseSubmissions()` 회귀 방지(PLAN §인제스트, ARCHITECTURE §6).

## `pershing-square-2026-06.json`

- **출처**: <https://data.sec.gov/submissions/CIK0001336528.json> (2026-06 취득)
- **엔티티**: Pershing Square Capital Management, L.P. (CIK 1336528)
- **트리밍**: 실제 피드는 `filings.recent` 에 735건이 있다. 대표 11건만 남겨 **빠른·느린 레인 + 표기
  변형(레거시/수정분) + 비추적 폼**을 모두 커버하도록 잘랐다(필드명·값은 원본 그대로, **신선순=최신
  먼저** 정렬 보존). 16개 병렬 배열과 `filings.files`(여기선 빈 배열)는 구조 그대로 유지.
- **포함 폼**(신선순): `4`·`SCHEDULE 13D/A`·`13F-HR`·`3`·`13F-HR/A`·`SC 13D/A`·`SC 13D`·
  `SC 13G/A`·`SC 13G`·`4/A`·`DFAN14A`.
  - **빠른**: `4`·`4/A`·`SC 13D`·`SC 13D/A`·`SCHEDULE 13D/A`(레거시 표기)·`SC 13G`·`SC 13G/A`
  - **느린**: `13F-HR`·`13F-HR/A`
  - **비추적**: `3`(Form 3 — 빠른 레인 `4` 와 혼동 금지)·`DFAN14A`
- **실데이터 quirk(파서가 결정적으로 흡수)**:
  - `SCHEDULE 13D/A`(레거시 라벨)이 실제로는 **구조화 XML**(`xslSCHEDULE_13D_X02/primary_doc.xml`)
    → `canonicalForm='13D/A'`, `isStructured=true`. 즉 **표기는 레거시여도 문서는 파싱 가능**.
  - 반대로 일부 `SC 13D/A`·`SC 13D`·`SC 13G`(2021~24)는 `.htm` → `isStructured=false`(인제스트 스킵).
- **검증 포인트**:
  - 병렬 배열을 신선순 그대로 11건으로 zip, `cik` 0패딩 제거(`0001336528`→`1336528`).
  - 빈 문자열 `reportDate`/`primaryDocDescription` → `null`.
  - **정규 폼 폴딩**: `SC 13D`/`SCHEDULE 13D`→`SC 13D`, `…/A`→`13D/A`/`13G/A`, `4`·`4/A`→`4`;
    비추적(`3`·`DFAN14A`)→`null`. 레인 필터는 `canonicalForm` 정확 일치라 **레거시 표기·수정분을 누락하지 않는다**.
  - **isStructured**: 폼 라벨이 아니라 **원본 문서 확장자(.xml)** 기준.
  - 문서 URL: `.../Archives/edgar/data/{cik}/{accNoDashes}/{primaryDocument}`.
    **XSL 렌더 경로**(`xslF345X06/…`, `xslSCHEDULE_13D_X02/…`)는 `documentUrl` 에 그대로, **파싱 가능한
    원본 XML**은 `rawDocumentUrl`(`xsl…/` 접두 제거)로 노출 → 파서가 먹는 건 raw.

`pershing-square-2026-06.expected.json` 은 `parseSubmissions()` 의 정규화 출력(`ParsedSubmissions`)과
deep-equal 해야 한다. 원본은 SEC 공공 도메인. User-Agent `stock-recommend-app laegel1@gmail.com` 로 취득.
