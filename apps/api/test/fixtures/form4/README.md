# Form 4 fixtures

골든 테스트용 **실제 SEC EDGAR Form 4** 공시. 파서 회귀 방지(ADR-0012 §골든 테스트).

## `berkshire-oxy-2022-03-16.xml`

- **출처**: <https://www.sec.gov/Archives/edgar/data/797468/000089924322011287/doc4.xml>
- **발행사(issuer)**: OCCIDENTAL PETROLEUM CORP /DE/ (OXY, CIK 797468)
- **보고인(reporting owners)**: BERKSHIRE HATHAWAY INC (CIK 1067983) · BUFFETT WARREN E (CIK 315090) — 둘 다 10%↑ 보유자
- **accession**: 0000899243-22-011287 · **filing date**: 2022-03-16
- **내용**: 버크셔의 OXY 보통주 **매수(transactionCode `P`)** 7건(2022-03-14~16) + 우선주 보유 1건(거래 아님) + Table II 워런트 보유 1건(거래 아님).
- **검증 포인트(PLAN §검증)**: `event_type=BUY`, shares·price·sharesOwnedAfter 가 EDGAR 표시값과 일치. **보유(holding)는 이벤트로 산출하지 않음**(거래만 `activity_events`). 다중 보고인 → 인제스트 단계에서 큐레이션 투자자(버크셔)로 귀속해 이중집계 방지(ADR-0015).

## `berkshire-bac-2024-07-19.xml`

- **출처**: <https://www.sec.gov/Archives/edgar/data/70858/000095017024085022/ownership.xml>
- **발행사**: BANK OF AMERICA CORP /DE/ (BAC, CIK 70858) · **보고인**: 버크셔(1067983)·버핏(315090), 10%↑
- **accession**: 0000950170-24-085022 · **schema**: X0508(true/false 불리언)
- **내용**: 버크셔의 BAC 보통주 **매도(transactionCode `S`)** 4건(2024-07-17~19).
- **검증 포인트**: 매도 → `event_type=SELL`, **`shares_delta`·`value` 음수**(부호 컨벤션, 리뷰 #1). `SUM(shares_delta)` 가 순증감이 되도록 처분을 음수로 적재.

## `oracle-rsu-2026-05-31.xml`

- **출처**: <https://www.sec.gov/Archives/edgar/data/1341439/000134143926000054/form4.xml>
- **발행사**: ORACLE CORP (ORCL, CIK 1341439) · **보고인**: RUSCKOWSKI STEPHEN H(이사)
- **accession**: 0001341439-26-000054 · **schema**: X0609(1/0 불리언)
- **내용**: **Table II 파생 거래(`derivativeTransaction`)** 1건 — RSU 부여(코드 `A`).
- **검증 포인트**: 파생 테이블 워킹(`table=derivative`), `A→BUY`, **가격 0 → value 0**(미보고 `null` 과 구분), **누락 관계 플래그(isOfficer 등) → false 기본값**, 단일 보고인/단일 거래 정규화.

각 `<fixture>.expected.json` 은 `parseForm4()` 의 정규화 출력(`ParsedForm4`)과 deep-equal 해야 한다.
원본은 SEC 공공 도메인. User-Agent `stock-recommend-app laegel1@gmail.com` 로 취득.
