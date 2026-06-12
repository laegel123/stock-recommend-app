# stock-recommend-app — 기획 & 구현 계획

> ⚠️ **감사 정정 반영(ADR-0015)**: NPS 국내·13G는 *느린 레인*(분기/월, 실시간 아님), Form 4 파생(워런트) 포함, FX·OpenFIGI 추가, 성과는 무료·지연 데이터로 제한, **'추천'→'공시 정보 집계' + 비개인화**(유사투자자문업 경계). 상세는 [`ADR.md`](./ADR.md)·[`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Context (왜 만드는가)

거대 투자자(워런 버핏/버크셔, 국민연금, 유명 헤지펀드·가치투자자)가 **어디에 투자하는지**를
공개 규제 공시로 지속 추적해서, 그들이 **무엇을 새로 사고/늘리고/팔았는지**를 피드로 보여주고,
**여러 거물이 공통으로 담는 종목을 랭킹**으로 추천하는 앱. 투자자별 **성공률·성과**와 **시각화**도 제공.

### 신선도가 핵심 — "빠른 레인 + 느린 레인" 멀티-케이던스
13F(분기 포트폴리오)만 보면 **최대 45일 지연**이라 너무 느리다. 그래서 **사건 기반(event-driven) 공시**를
같이 써서 "가장 중요한 움직임"의 지연을 **45일 → 2~5일**로 줄인다.

| 레인 | 공시 | 지연 | 무엇을 잡나 |
|---|---|---|---|
| **빠른 레인** | **Form 4** (내부자/10%↑, US) | **T+2영업일** | 임원·이사·**10%↑ 보유자** 매매(버크셔 OXY 등). **Table II 파생(워런트) 포함** |
| 빠른 레인 | **13D** (액티비스트 5%, US) | **T+5영업일**(수정 2일) | 경영참여·신규 대량지분 |
| 빠른 레인 | **DART 일반 5%·임원/주요주주** (KR) | **T+5영업일** | 한국 액티비스트·슈퍼개미·내부자(사건 기반) |
| **느린 레인** | **13G** (기관 패시브/QII, US) | 분기말+45일 | 대형기관 패시브 5% — 분기 단위(빠르지 않음) |
| **느린 레인** | **13F** (전체 포트폴리오, US) | 분기+45일 | **전체 보유 구성·비중** → 합의·시각화 맥락 |
| **느린 레인** | **DART 국민연금**(약식·특례) | **분기/월(최대 100일+)** | ⚠️ **NPS 국내 지분은 실시간 아님** — 약식보고 특례 |

두 레인은 **상호보완**: 빠른 레인은 부분적(내부자·5%↑ 크로싱만), 느린 레인은 전체지만 느림.
글로벌 피드 = 두 레인의 합집합을 `filing_date` 최신순으로, `lane`/`source` 태그와 함께 표시.

### 데이터 출처 (검증 완료)
- **미국**: SEC EDGAR (무료, API 키 불필요, User-Agent 필수, 10 req/s). 한 CIK가 13F·Form 4·13D/G를 모두 EDGAR에 제출.
  버크셔 CIK `1067983`, **국민연금 미국분 CIK `1608046`**. 13D/G·Form 4는 2024 SEC 현대화로 **구조화 XML** 제출.
- **한국**: 금감원 **DART OpenAPI** (무료 키). `majorstock.json`(5%룰), `elestock.json`(임원·주요주주), `corpCode.xml`.
- **폴링**: 추적 투자자 CIK의 submissions 피드를 **분 단위**로 폴링(≈20 CIK, 8 req/s 한도 내 여유). 푸시 알림은 Phase 2.

### 정직한 한계 (UI에 명시)
- **진짜 실시간(장중) 기관 매매는 공개 안 됨.** 공개 데이터 최속 = **T+2(Form 4)**.
- **5% 미만이면서 내부자도 아닌** 포지션은 여전히 **13F 분기**뿐(예: 버핏이 3%만 사면 분기까지 안 보임).
- ⚠️ **국민연금 국내 지분은 약식·특례로 분기/월 지연**(실시간 아님), **13G(기관 패시브)도 분기**. 빠른 레인은 US 내부자·액티비스트·한국 일반 5%에 한함.
- 13F는 **미국상장 롱+상장옵션**(공매도·현금·채권·해외 제외). CUSIP만 주므로 티커 매핑(**OpenFIGI** 등) 필요.

### 확정 결정 (재논의 불필요)
| 항목 | 결정 |
|---|---|
| 시장 | **미국 먼저 → 한국 fast-follow** (둘 다 최종 목표) |
| 신선도 | **멀티-케이던스**: 빠른 레인(Form 4 T+2 + 13D T+5 + KR 일반 5% T+5) + 느린 레인(13F·13G·**NPS 국내 분기/월**). **분 단위 폴링, 푸시는 Phase 2** |
| 추천 방식 | **(a) 큰손 따라하기 피드(빠른 레인 헤드라인) + (b) 합의 종목 랭킹(13F 기반 + 최근 매수 가중)** |
| MVP 우선순위 | **추천/변동 피드(빠른+느린 레인) + 합의 랭킹**. 시각화·성과분석은 Phase 2(스키마는 처음부터 대비) |
| 첫 프론트엔드 | **웹 (Next.js)**. API는 플랫폼 무관 → 추후 Expo 모바일 추가 시 백엔드 변경 0 |
| 구축 규모 | **풀 아키텍처부터** (모노레포 + Postgres + Redis/BullMQ + 스케줄러 + Python 사이드카) |

---

## Tech Stack

| 영역 | 선택 | 이유 |
|---|---|---|
| Backend | **Node.js + TypeScript + Fastify** | TS 일관(옆 Expo 앱). 스키마-퍼스트 → OpenAPI 자동 |
| DB | **PostgreSQL** (+ 추후 TimescaleDB) | 시계열·관계형. 합의/diff는 window 함수 SQL |
| ORM | **Drizzle ORM** | TS-퍼스트, SQL 투명 |
| 큐/스케줄 | **BullMQ (Redis)** + **node-cron** | 분 단위 폴링(빠른 레인) + 분기 집중(13F) + 10 req/s 제약 → 레이트리미터 큐 |
| HTTP/파싱 | `undici` + `fast-xml-parser` + `bottleneck`(전역 ≤8 req/s) | 13F/Form4/13D/DART XML 파싱, SEC 한도 안전 |
| KR 가격(Phase 2) | **Python 사이드카(FastAPI) + pykrx** | 한국 EOD 가격. 내부 HTTP 경계로 격리 |
| Frontend | **Next.js(App Router) + React + Tailwind + Recharts/ECharts** | 데이터 화면·차트, 공유 링크/SEO |
| 공유 타입 | `packages/shared` (Zod + 추론 타입) | API·웹·모바일 단일 진실원 |
| 모노레포 | **pnpm workspaces** | 추후 Expo 앱이 shared/API 재사용 |

### 모노레포 구조
```
stock-recommend-app/
├─ apps/{api(Fastify: 라우트·인제스트·파생), web(Next.js MVP)}
├─ packages/shared/   # Zod 스키마 + 타입 + API 클라이언트
├─ services/kr-prices # Python(pykrx) 사이드카 (Phase 2, MVP엔 스캐폴드만)
├─ docker-compose.yml # Postgres + Redis
└─ pnpm-workspace.yaml
```

---

## 데이터 모델 (핵심 테이블)

```
investors ─1:N─ filings ─1:N─┬─ holdings(13F 스냅샷, 느린 레인) ─→ position_changes ┐
                             └─ activity_events(Form4/13D·G/DART, 빠른 레인)        ├→ FEED
securities ─1:N─ prices                                          consensus_scores ─┘
cusip_map, corp_code_map, benchmarks, investor_performance
```

- **investors**: `slug, display_name, type(us_13f_manager|kr_disclosure_filer), source(edgar|dart), external_id(CIK/DART id), is_curated, parent_investor_id(자기참조)`.
  국민연금은 미국분(EDGAR)·국내분(DART)을 `parent_investor_id`로 묶어 **합의 이중집계 방지**.
- **securities**: `cusip?, ticker?, name, market(US|KR), sector, industry`.
- **cusip_map**: `cusip pk, security_id, ticker, confidence(exact|fuzzy|manual)` — 13F의 CUSIP→티커.
- **corp_code_map**: `corp_code pk, stock_code, security_id` — DART `corpCode.xml`.
- **filings**: `investor_id, source, form_type, quarter?, report_date?, filing_date, accession_number, raw_url`.
  `form_type ∈ {13F-HR, 13F-HR/A, 4, SC 13D, SC 13G, 13D/A, 13G/A, majorstock, elestock}`. `(investor_id, accession_number)` **unique** → 멱등.
- **holdings (느린 레인 척추)**: `filing_id, investor_id, security_id, quarter, shares, value_usd, pct_of_portfolio`. 13F 전체 포트폴리오 스냅샷. 값 스케일 quirk(과거 ×1000 vs 2023↑ 정수) **정규화**.
- **activity_events (빠른 레인 척추 → 피드)**: 사건 기반 공시를 공통 형태로 정규화
  `investor_id, security_id, source, form_type, event_type(BUY|SELL|STAKE_NEW|STAKE_INCREASE|STAKE_DECREASE|STAKE_EXIT), event_date, filing_date, shares_delta?, shares_after?, pct_of_company_after?, price_per_share?, value?, intent(active 13D|passive 13G|null), accession_number, raw_url`.
  매핑: Form4→BUY/SELL(+shares/price), 13D/G→STAKE_*(+pct·intent), DART→STAKE_*(+pct). `(investor_id, accession_number, security_id)` unique.
- **position_changes (13F 파생)**: `investor_id, security_id, quarter, prev_quarter, change_type(NEW|ADD|REDUCE|EXIT|HOLD), shares_delta, value_delta_usd`.
- **consensus_scores (파생→랭킹)**: `security_id, quarter, holders_count, net_buyers_count, new_buyers_count, net_sellers_count, recent_activity_count, total_value_usd, score, rank`.
- **prices / benchmarks / investor_performance**: Phase 2용. 스키마는 지금 만들어 둠.

---

## 인제스트 파이프라인

전역 throttle ≤8 req/s + `User-Agent: stock-recommend-app laegel1@gmail.com`. 모든 잡 BullMQ(재시도·백오프), accession 멱등.

**빠른 레인 — EDGAR (`ingest:edgar-fast`, 분 단위)**
1. 추적 투자자 CIK별 `data.sec.gov/submissions/CIK{10자리}.json`을 **분 단위 폴링** → `form ∈ {4, SC 13D, SC 13G, 13D/A, 13G/A}` 중 미수집 accession만 파싱 enqueue.
2. **Form 4** ownershipDocument XML 파싱: reportingOwner, issuer, nonDerivativeTransaction(`transactionDate`, `transactionCode` P=매수/S=매도/A=수령/M=행사, `transactionShares`, `transactionPricePerShare`, `sharesOwnedFollowingTransaction`) → `activity_events`(기본 피드는 **P/A=BUY** 강조).
3. **13D/13G**(구조화 XML) 파싱: subject company, `pct_of_company`, shares, 13D=active/13G=passive → `activity_events(STAKE_*)`.
4. security 해결(§CUSIP) 후 upsert.

**빠른 레인 — DART (`ingest:dart`, 일/이벤트, 한국 fast-follow)**
- `corpCode.xml` 주기 갱신 → `corp_code_map`. `majorstock.json`·`elestock.json` 폴링 → `report_tp`→event_type, `stkqy`→shares, `stkrt`→pct_of_company → `activity_events`. 회사중심이라 **보유자명 정규화**로 투자자중심 재구성(shortlist부터).

**느린 레인 — EDGAR 13F (`ingest:edgar-13f`, 분기 윈도우 매일/그외 주간)**
1. 같은 submissions 피드에서 `13F-HR`/`/A` → 아카이브 폴더의 **information table XML** 파싱(issuer/cusip/value/shares) → 정규화 → `holdings`.
2. **백필**: 최근 ~8분기는 SEC **분기 Bulk 13F Data Sets**(TSV)로 일괄 적재.

**CUSIP→티커 해결**: `cusip_map` 조회. miss → `securities` upsert + `nameOfIssuer`를 `company_tickers.json`에 퍼지매칭, 저신뢰는 수동검토 플래그. 큐레이션 한정의 **유한 문제**.

**파생 잡(순수 SQL)**
- `compute:changes`: `LAG(shares) OVER (PARTITION BY investor_id, security_id ORDER BY quarter)` → NEW/ADD/REDUCE/EXIT.
- `compute:consensus`: `(security_id, quarter)` 집계 + 최근 `activity_events` 매수 가산 → score/rank.

---

## 추천 로직

**(a) 빠른 레인 피드 — "큰손이 방금 샀다" (MVP 헤드라인)**: `activity_events`를 `filing_date` 최신순, 기본 필터 `event_type ∈ {BUY, STAKE_NEW, STAKE_INCREASE}`. securities(티커/섹터) 조인 → *"버핏 OXY 추가매수 · 어제 공시 · 주당 $X"*.

**(b) 느린 레인 포트폴리오 변동**: 13F `position_changes`의 NEW/ADD → 분기 단위 전체 포트폴리오 변화.

**(c) 합의 랭킹** (가중합, 상수는 config):
```
score = w1·holders_count + w2·net_buyers_count + w3·new_buyers_count
      - w4·net_sellers_count + w5·log10(total_value_usd)
      + w6·recent_activity_count   // 최근 빠른-레인 매수 가산(신선도 반영)
시작값: w1=1.0, w2=1.5, w3=2.0, w4=1.0, w5=0.5, w6=1.5
```
시장(US/KR)별 분기 내 내림차순 rank. **추후**: `investor_performance` 생기면 투자자별 기여도에 `investor_weight=f(win_rate, excess_return)` 곱 → **스키마 변경 없이** 성공률 가중.

---

## 성과/성공률 정의 (Phase 2, 스키마 지금 대비)

- 포지션별 **filing_date 기준 forward return**(공개 후 행동 가능한 최초 시점), horizon 1Q/4Q.
- **초과수익** = position_return − benchmark_return (US: S&P500, KR: KOSPI). **승률** = 초과수익>0 비율(규모 가중 옵션).
- UI 주의: "13F는 롱·45일 지연 → '공개 롱북을 따라갔다면 지수를 이겼는가'를 측정. 실제 실현손익 아님."
- `filing_date·prices·benchmarks`가 이미 스키마에 있어 **마이그레이션 불필요**.

---

## API 표면 (`/api/v1`, JSON, cursor 페이지네이션)

- `GET /feed?lane=fast,slow&event_type=BUY,STAKE_NEW&market=&source=&investorId=&limit=&cursor=` — **통합 피드(헤드라인)**. 빠른+느린 레인 합집합, `filing_date` 최신순, 각 항목에 `lane`/`source`/`dataAsOf`.
- `GET /consensus?quarter=&market=&limit=20` — 합의 랭킹 Top N
- `GET /securities/:id/consensus` — 종목별 합의(누가 보유/매수/매도, 추세)
- `GET /investors` / `:slug` / `:slug/activity?type=fast` (빠른 레인 이벤트) / `:slug/holdings?quarter=` (13F 스냅샷) / `:slug/changes?quarter=`
- `GET /securities/:id` / `:id/holders?quarter=`
- **Phase 2**: `/securities/:id/prices`, `/investors/:slug/performance`, `/meta/quarters`, `POST /alerts`(푸시).
- 모든 응답에 `dataAsOf` + 상시 **`disclaimer` 필드**. ETag/Cache-Control.

---

## 구현 단계 (실행 순서)

### Phase 0 — 스캐폴딩 (풀 아키텍처)
1. pnpm 모노레포, `docker-compose`(Postgres+Redis), `packages/shared`(Zod), Fastify·Next.js 부트.
2. **Drizzle 스키마 전체**(activity_events·holdings·파생·성과 포함) + 마이그레이션.
3. `apps/api/src/config/investors.seed.ts` — 큐레이션 CIK 시드(버크셔 `1067983`, NPS `1608046`, Pershing Square, Scion, Appaloosa, Baupost, Greenlight 등 10~20명).

### Phase 1 — MVP (미국, 빠른+느린 레인 피드 + 합의 + 웹)
4. **빠른 레인**: `ingest/edgar-fast.ts` — 분 단위 submissions 폴링 + **Form 4 / 13D / 13G 파서** → `activity_events`.
5. **느린 레인**: `ingest/edgar-13f.ts` + Bulk 백필 + 13F XML 파서 → `holdings`.
6. CUSIP→티커 해결(`cusip_map`: 시드+퍼지+수동).
7. 파생: `derive/changes.ts`, `derive/consensus.ts`(최근 매수 가산 포함).
8. REST: `/feed`(통합), `/consensus`, `/investors*`(+`/activity`), `/securities/:id/holders`.
9. **Next.js 웹**: ① **통합 피드(빠른 레인 헤드라인 + 느린 레인)** ② 합의 Top-N ③ 투자자 프로필(활동+보유) ④ 종목 보유자.
   - **시각화 씨앗**(핵심 니즈): 합의 Top-N **수평 막대차트** + 투자자 포트폴리오 **섹터 미니 트리맵**.
10. 모든 화면·API에 **투자 자문 면책 문구** 상시 노출.

### Phase 2 — 한국 fast-follow + 시각화·성과 + 푸시
11. DART 인제스터(빠른 레인 `activity_events` + `corp_code_map` + 보유자명 정규화) → 같은 피드/랭킹에 KR 편입.
12. 가격 인제스트(US: FMP/Finnhub, KR: pykrx 사이드카) + `benchmarks` → `investor_performance` → 프로필 승률/초과수익 + **합의 가중 환류**.
13. 풀 시각화 대시보드(섹터 트리맵, 합의 히트맵, 분기 플로우 Sankey, 보유자수 추세).
14. **푸시 알림**: "팔로우 투자자 신규 Form 4/13D" 즉시 알림(웹 푸시 → 모바일).

### Phase 3 — 모바일 + 개인화
15. **React Native(Expo) 앱**: `packages/shared` + API 클라이언트 재사용(백엔드 변경 0).
16. 계정/워치리스트/커스텀 합의 가중.

---

## 리스크 / 법적 / 면책

| 리스크 | 대응 |
|---|---|
| 신선도 한계 | 공개 최속 T+2(Form 4). 빠른 레인으로 45일→2~5일. **5% 미만·비내부자 포지션은 13F 분기뿐** → UI에 명시, `dataAsOf` 상시 |
| Form 4 적용 범위 | 투자자가 **내부자/10%↑ 보유자일 때만** 발생(전 포지션 아님). 거래코드 P/S/A/M 정규화, 매수 피드는 P/A 중심 |
| 13D/G·Form4 파싱 | 2024 구조화 XML 기준 파서. fixture 단위테스트 |
| 13F 롱·미국상장만 | "롱 미국상장만; 공매도·현금·채권·해외 미표시" 카피 |
| CUSIP→티커 무료 완전본 없음 | 내부 `cusip_map`(오픈데이터+퍼지+수동), 큐레이션 한정 유한 문제, `confidence` 추적 |
| SEC 10 req/s·UA 필수 | 전역 throttle ≤8/s, UA 헤더, 429 백오프. 분 단위 폴링도 ≈20 CIK라 여유. 백필은 Bulk Dataset |
| DART 키·회사중심 모델 | 캐시, 보유자명 정규화, 큐레이션 shortlist, 키는 secrets |
| pykrx 취약(스크래핑) | Python 사이드카 격리, FMP/KRX 폴백, Phase 2 한정 |
| NPS 이중집계(13F vs DART) | `parent_investor_id`로 한 투자자 두 피드 통합 |
| 데이터 라이선스 | SEC=공공 도메인(UA·레이트 준수). DART=약관·출처표기, **원본 재배포 금지**. 가격 API=표시용·재판매 금지. **CUSIP 목록 자체 게시 금지**(CGS) |
| 투자 자문 법적 노출 | **상시 면책**: "공개 규제 공시를 정보 목적으로 집계할 뿐, 투자 자문/매매 권유 아님. 면허 자문사 아님. 공시는 지연·불완전 가능. 직접 조사/전문가 상담." API `disclaimer` 필드 + 전 화면. 중립 카피("공개된 매수","합의 보유"), "사세요" 금지 |

---

## 검증 (How to test)

- **스키마**: `drizzle-kit` 마이그레이션 → `docker-compose up` 후 Postgres에 activity_events·holdings 등 전체 테이블 생성 확인.
- **빠른 레인 파서**: 알려진 버크셔 **Form 4(OXY 매수)** fixture → `event_type=BUY`, shares/price/sharesOwnedAfter가 EDGAR 표시값과 일치. 13D fixture → `pct_of_company`·intent 정확.
- **느린 레인 파서**: 버크셔 13F 1건 fixture → 보유 종목 수·총액(값 스케일 정규화 포함) 일치.
- **파생**: 연속 2분기 fixture로 `compute:changes` 분류 정확, `compute:consensus` score/rank가 가중식(+최근매수 가산)과 일치.
- **CUSIP 매핑**: 큐레이션 보유 종목 해결률 리포트, unmapped 0 목표.
- **E2E(피드)**: `GET /api/v1/feed?lane=fast,slow`가 빠른+느린 레인 항목을 `filing_date` 최신순으로 반환, 각 행에 `lane`/`source`/티커/섹터.
- **웹 스모크**: `pnpm --filter web dev` → 통합 피드/합의/프로필이 실제 API로 렌더, 막대차트·트리맵·면책 표시.
- **폴링/레이트 안전**: 분 단위 폴링 로그로 SEC 요청 ≤8 req/s·429 0건 확인.
