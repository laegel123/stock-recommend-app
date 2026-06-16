# 13F information table fixtures

골든 테스트용 **실제 SEC EDGAR 13F-HR information table XML** 공시(느린 레인, ARCHITECTURE §5/§6).
파서(`parse13FInfoTable`) 회귀 방지(ADR-0012 §골든 테스트). 13F = 분기 전체 포트폴리오 스냅샷 → `holdings`.

> ⚠️ **값 스케일 quirk(ADR-0015)**: SEC 는 **2023-01-03 이후 제출분**부터 `value` 를 **천 달러가 아닌 달러**로 보고하도록 Form 13F 를 개정했다. 그 이전 제출분은 `value × 1000` 가 실제 USD.
> information table XML 자체엔 제출일이 없으므로(표지 `primary_doc.xml` 에 있음) 파서는 호출자가 넘긴 `filedAt`(또는 명시적 `valueScale`)으로 시대를 정한다. 출력 `valueUsd` 는 항상 **달러 정수**로 정규화한다.
>
> 두 fixture 는 **같은 발행사(버크셔) 동일 분기(Q1)** 를 스케일 경계 양쪽에서 골라 정규화를 대조한다.

CUSIP→티커 해소·**중복 CUSIP 합산**(같은 종목이 `otherManager` 별로 여러 `<infoTable>` 행)·`pct_of_portfolio` 계산·`(filing, security)` 멱등은 **인제스트 레이어** 책임. 파서는 각 `<infoTable>` 를 원문 순서·중복 그대로 충실히 산출한다.

## `berkshire-2025q1-dollars.xml` — 달러 시대(2023+)

- **출처**: <https://www.sec.gov/Archives/edgar/data/1067983/000095012325005701/form13fInfoTable.xml>
- **제출인**: Berkshire Hathaway Inc (CIK 1067983) · **accession**: 0000950123-25-005701 · **filing date**: 2025-05-15 · **period**: 2025-03-31
- **트리밍**: 원본 ~110종목 중 **ALLY FINL(2행)·AMERICAN EXPRESS·APPLE** 4행만 발췌(verbatim).
- **검증 포인트**: `valueScale=dollars` → `valueUsd === valueReported`(×1000 미적용). **ALLY FINL CUSIP `02005N100` 가 2행**(매니저 분할) → 합산 않고 충실 보고(합산은 인제스트). 예: ALLY $463,886,547 / 12,719,675주 ≈ $36.47(달러 단위 확인).

## `berkshire-2022q1-thousands.xml` — 천 달러 시대(2023 이전)

- **출처**: <https://www.sec.gov/Archives/edgar/data/1067983/000095012322006442/13095.xml>
- **제출인**: Berkshire Hathaway Inc (CIK 1067983) · **accession**: 0000950123-22-006442 · **filing date**: 2022-05-16 · **period**: 2022-03-31
- **트리밍**: 원본 중 **ACTIVISION BLIZZARD·ALLY FINL(2행)·APPLE·COCA COLA** 5행만 발췌(verbatim).
- **검증 포인트**: `valueScale=thousands` → `valueUsd === valueReported × 1000`. 예: ACTIVISION `value=5152292`(천) / 64,315,222주 → ×1000 시 ≈ $80.11(천 단위 확인; 달러로 오해하면 $0.08 로 비현실적). **ALLY FINL CUSIP 중복 2행** 동일.

## 합성(synthetic) 엣지 — 파서 테스트에 인라인

버크셔는 옵션·FIGI·채권을 보고하지 않으므로 다음 엣지는 **합성 info table** 로 검증한다
(`sc13dg` 의 합성 STAKE_EXIT 패턴과 동일, `f13f-infotable.test.ts`):

- **putCall**(`Put`/`Call`) — 풋/콜 옵션 포지션(보통주·채권은 `null`).
- **figi**(2023+ 스키마 신규 optional) — 기재 시 매핑, 미기재 시 `null`.
- **sshPrnamtType=PRN** — 채권 등 원금액 보고(주식은 `SH`).
- **네임스페이스 접두사**(`<n1:infoTable>`) — `removeNSPrefix` 로 기본 네임스페이스와 동일 처리.

각 `<fixture>.expected.json` 은 `parse13FInfoTable()` 의 정규화 출력(`Parsed13FInfoTable`)과 deep-equal 해야 한다.
원본은 SEC 공공 도메인. User-Agent `stock-recommend-app laegel1@gmail.com` 로 취득.
