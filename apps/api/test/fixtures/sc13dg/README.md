# Schedule 13D / 13G fixtures

골든 테스트용 **실제 SEC EDGAR Schedule 13D/13G 구조화 XML** 공시(2024-12 의무화, ARCHITECTURE §6).
파서(`parseSchedule13DG`) 회귀 방지(ADR-0012 §골든 테스트). 13D=active(경영참여)·13G=passive(패시브) → `activity_events(STAKE_*)`.

> ⚠️ 13D 와 13G 는 **다른 스키마**다.
> - 13D(`xmlns=.../schedule13D`): `coverPageHeader/dateOfEvent`·`issuerInfo/issuerCIK`, `reportingPersons/reportingPersonInfo[]`(보고인별 `reportingPersonCIK`·`aggregateAmountOwned`·`percentOfClass`).
> - 13G(`xmlns=.../schedule13g`): `coverPageHeader/eventDateRequiresFilingThisStatement`·`issuerInfo/issuerCik`(소문자), `coverPageHeaderReportingPersonDetails[]`(보고인 **CIK 없음**·`reportingPersonBeneficiallyOwnedAggregateNumberOfShares`·`classPercent`).
> - CUSIP 도 스키마 버전마다 다름: X01 `issuerCUSIP`(직속) vs X02 `issuerCusips/issuerCusipNumber`.
>
> 파서는 세 형태를 모두 공통 `ParsedSchedule13DG` 로 정규화한다.

## `icahn-centuri-2025-11-13.xml` — 원본 SC 13D(active, STAKE_NEW, X01)

- **출처**: <https://www.sec.gov/Archives/edgar/data/921669/000153949725002948/primary_doc.xml>
- **발행사**: Centuri Holdings, Inc. (CIK 1981599, CUSIP 155923105) · **filer/보고인**: Carl C. Icahn(921669)·Icahn Enterprises L.P.(813762)
- **accession**: 0001539497-25-002948 · **filing date**: 2025-11-13 · **schema**: X01(`issuerCUSIP` 직속)
- **내용**: 13G → 13D 전환(액티비스트, 이사 지명) 14,336,044주(14.4%) 신규.
- **검증 포인트**: `formType=SC 13D`·`intent=active`·`eventType=STAKE_NEW`, 보고인별 `reportingPersonCIK` 0패딩 제거, `dateOfEvent` MM/DD/YYYY→ISO.

## `pershing-howard-hughes-2026-06-08.xml` — SC 13D/A(active, 수정, X02, 다중 계열 보고인)

- **출처**: <https://www.sec.gov/Archives/edgar/data/1336528/000114036126024479/primary_doc.xml>
- **발행사**: Howard Hughes Holdings Inc. (CIK 1981792, CUSIP 44267T102) · **filer**: Pershing Square Capital Management, L.P.(1336528)
- **accession**: 0001140361-26-024479 · **filing date**: 2026-06-08 · **schema**: X0202 · **amendmentNo**: 33 · **previousAccessionNumber**: 0001193125-19-306193
- **내용**: 6개 계열 보고인(PSCM·HHH Holdings·PS Inc.·Partner Group·Management·Ackman)이 **동일 합산지분**(27,852,064주·46.7%)을 중복 보고.
- **검증 포인트**: `formType=13D/A`·`isAmendment=true`·`amendmentNo=33`, **수정분이라 단일 문서로 증감 방향 불명 → `eventType=null`**(인제스트가 직전 `shares_after` 와 비교해 STAKE_INCREASE/DECREASE 결정). `reportingPersonNoCIK=Y` 보고인은 `cik=null`. **이중집계는 인제스트가 filer CIK 로 큐레이션 투자자(Pershing)에 귀속**(ADR-0010/0015). 큰 `items1To7` 자유서술은 무시.

## `tiger-cerebras-2026-05-22.xml` — 원본 SC 13G(passive, STAKE_NEW, X02, 보고인 CIK 없음)

- **출처**: <https://www.sec.gov/Archives/edgar/data/1167483/000091957426003680/primary_doc.xml>
- **발행사**: Cerebras Systems Inc. (CIK 2021728, CUSIP 15675D103) · **filer**: Tiger Global Management LLC(1167483)
- **accession**: 0000919574-26-003680 · **filing date**: 2026-05-22 · **schema**: X0202 · **rule**: 13d-1(c)
- **내용**: 4 보고인(Tiger 3개 엔티티 + Charles P. Coleman III), 8.69%/9.99% 신규 패시브 지분.
- **검증 포인트**: `formType=SC 13G`·`intent=passive`·`eventType=STAKE_NEW`, **표지 보고인 CIK 부재 → `cik=null`**(귀속은 `filerCik`). `classPercent`·`reportingPersonBeneficiallyOwnedAggregateNumberOfShares` 매핑, **복수 `typeOfReportingPerson` → ','로 결합**(IA,OO / HC,IN), `eventDateRequiresFilingThisStatement` ISO 변환.

각 `<fixture>.expected.json` 은 `parseSchedule13DG()` 의 정규화 출력(`ParsedSchedule13DG`)과 deep-equal 해야 한다.
원본은 SEC 공공 도메인. User-Agent `stock-recommend-app laegel1@gmail.com` 로 취득.
