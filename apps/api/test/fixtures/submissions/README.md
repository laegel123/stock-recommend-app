# EDGAR submissions feed fixtures

골든 테스트용 **실제 SEC EDGAR submissions 피드**(`data.sec.gov/submissions/CIK{10}.json`).
파서(`parseSubmissions`) 회귀 방지(PLAN §인제스트, ARCHITECTURE §빠른 레인). 이 피드는 한 CIK 의
모든 양식(13F·Form 4·13D/G·8-K…)을 **columnar**(병렬 배열) `filings.recent` 로 싣는다 →
파서가 행으로 풀고 **추적 양식만** 남겨 페치/파싱 대상으로 정규화한다.

## `berkshire-submissions-trimmed.json` — 버크셔(CIK 1067983) 피드 트림

- **출처**: <https://data.sec.gov/submissions/CIK0001067983.json> (User-Agent `stock-recommend-app laegel1@gmail.com` 로 취득, SEC 공공 도메인)
- **트림 사유**: 원본은 ~1000행/161KB 라 골든으로 부적합. 모든 정규화 분기를 커버하는 **실제 행만**
  피드 순서대로 발췌(컬럼 구조·값은 원본 그대로). `filings.files` 오버플로 항목도 보존.
- **포함 행(11)** — 추적 8 + 미추적 3:

  | form (원본)      | → formType | lane | primaryDocument                     | 검증 포인트 |
  |------------------|-----------|------|-------------------------------------|-------------|
  | `4`              | `4`       | fast | `xslF345X06/ownership.xml`          | 구조화 XML, xsl 프리픽스 제거 → `ownership.xml`, reportDate 보존 |
  | `4/A`            | `4`       | fast | `xslF345X05/ownership.xml`          | **수정분 흡수**(enum 에 `4/A` 없음) + `isAmendment=true` |
  | `SCHEDULE 13G`   | `SC 13G`  | fast | `xslSCHEDULE_13G_X02/primary_doc.xml` | **구 표기 흡수**(SCHEDULE→SC), reportDate 빈값→null |
  | `SCHEDULE 13G/A` | `13G/A`   | fast | `xslSCHEDULE_13G_X02/primary_doc.xml` | 구 표기 + 수정분 |
  | `SCHEDULE 13D/A` | `13D/A`   | fast | `xslSCHEDULE_13D_X01/primary_doc.xml` | 구 표기 + 수정분 |
  | `SC 13G`         | `SC 13G`  | fast | `d49764dsc13g.htm`                   | **구형 HTML**(2024 의무화 이전) → `isStructured=false`(파서 불가) |
  | `SC 13D`         | `SC 13D`  | fast | `a18-17436_1sc13d.htm`              | 구형 HTML |
  | `13F-HR`         | `13F-HR`  | slow | `xslForm13F_X02/primary_doc.xml`    | **느린 레인** 태깅 |
  | `11-K`,`3`,`8-K` | (제외)    | —    | —                                   | **미추적 양식 필터** 검증(Form 3=초기보유·5=연차는 제외, Form 4 거래만) |

## 정규화 규약(파서가 보장)

- **양식 표기 흡수**: SEC 는 같은 공시를 `SC 13G`(신)·`SCHEDULE 13G`(구) 두 표기로 낸다 →
  canonical `form_type` enum 으로 통일. `/A` 수정분은 base 양식 + `isAmendment` 로 보존.
- **raw 문서 URL**: 구조화 의무화 후 `primaryDocument` 는 **xsl 렌더 경로**라 기계판독 XML 은
  프리픽스를 벗긴 경로에 있다(검증: 폴더 index.json 의 `ownership.xml`·`primary_doc.xml`).
  `primaryDocUrl` 은 raw 문서를 가리키고, `.htm`(구형)은 `isStructured=false`.
- **lane**: 사건기반(4·13D·13G)=fast, 분기 포트폴리오(13F-HR)=slow.
- **cik**: 0패딩 제거(`0001067983`→`1067983`, investors.external_id 형식). `files` 오버플로는
  파일명만 노출(백필 전용 — `recent` 는 최근 ~1000건만 담는다).

`berkshire-submissions-trimmed.expected.json` 은 `parseSubmissions()` 의 정규화 출력
(`ParsedSubmissions`)과 deep-equal 해야 한다.
