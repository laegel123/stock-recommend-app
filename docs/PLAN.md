# stock-recommend-app — 기획 & 구현 계획

## Context (왜 만드는가)

거대 투자자(워런 버핏/버크셔, 국민연금, 유명 헤지펀드·가치투자자)가 **어디에 투자하는지**를
공개 규제 공시로 지속 추적해서, 그들이 분기마다 **무엇을 새로 사고/늘리고/팔았는지**를 피드로 보여주고,
**여러 거물이 공통으로 담는 종목을 랭킹**으로 추천하는 앱. 추가로 각 투자자의 **과거 성공률/성과**와
**시각화**를 제공한다.

이 데이터는 합법·공개적으로 확보 가능함이 검증됨:
- **미국**: SEC EDGAR **13F 공시** (무료, API 키 불필요, User-Agent 필수, 10 req/s 제한). $100M↑ 운용사 의무 공시.
  버크셔(CIK `1067983`), **국민연금 미국분(CIK `1608046`)** 모두 동일 파이프라인.
- **한국**: 금감원 **DART OpenAPI** (무료 키). `majorstock.json`(5%룰 대량보유), `corpCode.xml`(회사코드).
- **핵심 한계(제품에 명시 필요)**: 13F는 **분기 단위 + 최대 45일 지연**, **롱·미국상장 종목만**(공매도·현금·채권·해외 제외).
  따라서 "실시간"이 아니라 *"최신 공시 기준"* 앱. 13F는 **CUSIP만** 주고 티커가 없음 → 내부 매핑 필요.

### 확정 결정 (재논의 불필요)
| 항목 | 결정 |
|---|---|
| 시장 | **미국 먼저 → 한국 fast-follow** (둘 다 최종 목표) |
| 추천 방식 | **(a) 큰손 따라하기 피드 + (b) 합의 종목 랭킹** 둘 다 |
| MVP 우선순위 | **추천/변동 피드 + 합의 랭킹** (시각화·성과분석은 Phase 2, 단 스키마는 처음부터 대비) |
| 첫 프론트엔드 | **웹 (Next.js)**. API는 플랫폼 무관이라 추후 Expo 모바일 추가 시 백엔드 변경 0 |
| 구축 규모 | **풀 아키텍처부터** (모노레포 + Postgres + Redis/BullMQ + 스케줄러 + Python 사이드카) |

---

## Tech Stack

| 영역 | 선택 | 이유 |
|---|---|---|
| Backend | **Node.js + TypeScript + Fastify** | 사용자가 TS 익숙(옆 Expo 앱). API+프론트 타입 공유. 스키마-퍼스트 → OpenAPI 자동 |
| DB | **PostgreSQL** (+ 추후 TimescaleDB) | 분기 시계열·관계형. 합의/diff는 window 함수(`LAG()`) 기반 SQL |
| ORM | **Drizzle ORM** | TS-퍼스트, SQL 투명, window 함수 친화 |
| 큐/스케줄 | **BullMQ (Redis)** + **node-cron** | 13F는 분기 집중·10 req/s 제약 → 레이트리미터 큐가 적합(재시도·백오프) |
| HTTP/파싱 | `undici` + `fast-xml-parser` + `bottleneck`(≤8 req/s 전역 throttle) | 13F/DART XML 파싱, SEC 한도 안전 |
| KR 가격(Phase 2) | **Python 사이드카 (FastAPI) + pykrx** | 한국 EOD 가격 최선의 무료 소스. 내부 HTTP 경계로 격리 |
| Frontend | **Next.js(App Router) + React + Tailwind + Recharts/ECharts** | 데이터 밀집 화면·차트에 유리, 공유 링크/SEO |
| 공유 타입 | `packages/shared` (Zod 스키마 + 추론 타입) | API·웹·모바일 단일 진실원 |
| 모노레포 | **pnpm workspaces** | 추후 Expo 앱이 shared/API 클라이언트 재사용 |

### 모노레포 구조
```
stock-recommend-app/
├─ apps/
│  ├─ api/            # Fastify: 라우트, 인제스트, 파생 계산
│  └─ web/            # Next.js MVP 프론트
├─ packages/
│  └─ shared/         # Zod 스키마 + 타입 + API 클라이언트
├─ services/
│  └─ kr-prices/      # Python(pykrx) 사이드카 (Phase 2, MVP에 스캐폴드만)
├─ docker-compose.yml # Postgres + Redis (로컬)
└─ pnpm-workspace.yaml
```

---

## 데이터 모델 (핵심 테이블)

```
investors ─1:N─ filings ─1:N─ holdings ─N:1─ securities ─1:N─ prices
    │                            │
    └─ investor_performance      └─ (diff)→ position_changes,  consensus_scores ─N:1─ securities
cusip_map(CUSIP→security), corp_code_map(DART corp_code→security), benchmarks
```

- **investors**: `slug, display_name, type(us_13f_manager|kr_disclosure_filer), source(edgar|dart), external_id(CIK/DART id), is_curated, parent_investor_id(자기참조)`.
  국민연금은 미국분(EDGAR)·국내분(DART)을 `parent_investor_id`로 묶어 **합의 랭킹 이중집계 방지**.
- **securities**: `cusip?, ticker?, name, market(US|KR), sector, industry` (sector는 시각화 그룹핑용).
- **cusip_map**: `cusip pk, security_id, ticker, confidence(exact|fuzzy|manual)` — 13F의 CUSIP→티커 해결.
- **corp_code_map**: `corp_code pk, stock_code, security_id` — DART `corpCode.xml`.
- **filings**: `investor_id, source, quarter(2026Q1), report_date, filing_date, accession_number, form_type, raw_url`.
  `(investor_id, accession_number)` **unique** → 인제스트 멱등.
- **holdings(척추)**: `filing_id, investor_id, security_id, quarter, shares, value_usd, pct_of_portfolio, pct_of_company`.
  값 스케일 quirk(과거 ×1000 vs 2023↑ 정수달러) **인제스트 시 정규화**.
- **position_changes(파생→피드)**: `investor_id, security_id, quarter, change_type(NEW|ADD|REDUCE|EXIT|HOLD), shares_delta, value_delta_usd`.
- **consensus_scores(파생→랭킹)**: `security_id, quarter, holders_count, net_buyers_count, new_buyers_count, net_sellers_count, total_value_usd, score, rank`.
- **prices / benchmarks / investor_performance**: Phase 2용. 스키마는 지금 만들어 둠.

---

## 인제스트 파이프라인

**EDGAR/13F** (`ingest:edgar`, BullMQ):
1. 전역 throttle ≤8 req/s + `User-Agent: stock-recommend-app laegel1@gmail.com`.
2. 큐레이션 투자자별 `data.sec.gov/submissions/CIK{10자리}.json` → `form ∈ {13F-HR, 13F-HR/A}` → 미수집 accession만 `parse-13f` enqueue.
3. `parse-13f`: `Archives/edgar/data/{cik}/{accession}/` 인덱스에서 **information table XML** 찾아 `<infoTable>`(issuer, cusip, value, shares) 파싱.
4. 정규화(값 스케일, 동일 CUSIP 합산) → `pct_of_portfolio` 계산.
5. **CUSIP 해결**: `cusip_map` 조회. miss → `securities` upsert + `nameOfIssuer`를 `company_tickers.json`에 퍼지매칭해 후보 티커, 저신뢰는 수동검토 플래그.
6. `filings` upsert + `holdings` bulk insert (accession 멱등).
7. **백필**: 최근 ~8분기는 SEC **분기 Bulk 13F Data Sets**(INFOTABLE/SUBMISSION TSV)로 일괄 적재(개별 fetch 수천 회 회피).

**DART** (`ingest:dart`, Phase: 한국 fast-follow):
1. `corpCode.xml` 주기 갱신 → `corp_code_map`.
2. 추적 종목별 `majorstock.json?corp_code=…` → `report_tp`→change_type, `stkqy`→shares, `stkrt`→pct_of_company, `rcept_no`→accession.
3. 회사중심 공시라 **보유자명 정규화**로 투자자중심 재구성(큐레이션 shortlist부터).

**파생 잡(순수 SQL, 인제스트 후)**:
- `compute:changes`: `LAG(shares) OVER (PARTITION BY investor_id, security_id ORDER BY quarter)` → NEW/ADD/REDUCE/EXIT/HOLD.
- `compute:consensus`: `(security_id, quarter)` 집계 → score/rank.

**스케줄**: 13F 마감(분기말+~45일)에 맞춰 6주 윈도우는 **매일**, 그 외 주간. DART는 이벤트성이라 매일. 가격은 야간(Phase 2). node-cron 트리거 → BullMQ 실행.

---

## 추천 로직

**(a) 투자자별 변동 피드**: `position_changes`에서 큐레이션 투자자의 최신 `filing_date` 순, 기본 `NEW`+`ADD` 필터("뭘 샀나"). securities(티커/섹터)·holdings(새 비중/$) 조인. **MVP 헤드라인 화면**.

**(b) 합의 랭킹** (가중합, 상수는 config로 튜닝):
```
score = w1·holders_count        // 보유 폭
      + w2·net_buyers_count      // 매수 모멘텀
      + w3·new_buyers_count      // 신규 진입(강한 컨빅션)
      - w4·net_sellers_count     // 이탈 감점
      + w5·log10(total_value_usd)// 자본 규모(로그로 메가캡 완화)
시작값: w1=1.0, w2=1.5, w3=2.0, w4=1.0, w5=0.5
```
시장(US/KR)별 분기 내 내림차순 rank → "이번 분기 거물들이 공통으로 담은 Top N".
**추후**: `investor_performance`가 생기면 투자자별 기여도에 `investor_weight=f(win_rate, excess_return)` 곱 → **스키마 변경 없이** 성공률 가중 추천으로 확장.

---

## 성과/성공률 정의 (Phase 2, 스키마 지금 대비)

- 포지션별 **filing_date 기준 forward return**(공개 후 실제 행동 가능한 최초 시점), horizon 1Q/4Q.
- **초과수익** = position_return − benchmark_return (US: S&P500, KR: KOSPI).
- **투자자 승률** = 초과수익>0 포지션 비율(규모 가중 옵션). **평균 초과수익** 병기.
- UI 주의문구: "13F는 롱·45일 지연 → '공개된 롱북을 따라갔다면 지수를 이겼는가'를 측정. 실제 실현손익 아님."
- `filing_date·prices·benchmarks`가 이미 스키마에 있어 **마이그레이션 불필요**.

---

## API 표면 (`/api/v1`, JSON, cursor 페이지네이션)

**피드/추천(MVP 코어)**
- `GET /feed?quarter=&change_type=NEW,ADD&market=&investorId=&limit=&cursor=` — 글로벌 변동 피드(헤드라인)
- `GET /consensus?quarter=&market=&limit=20` — 합의 랭킹 Top N
- `GET /securities/:id/consensus` — 종목별 합의 상세(누가 보유/매수/매도, 분기 추세)

**투자자**
- `GET /investors` / `GET /investors/:slug` / `GET /investors/:slug/holdings?quarter=` / `GET /investors/:slug/changes?quarter=`

**종목**
- `GET /securities/:id` / `GET /securities/:id/holders?quarter=`

**Phase 2**: `/securities/:id/prices`, `/investors/:slug/performance`, `/meta/quarters`, `POST /alerts`.
모든 응답에 `quarter`, `dataAsOf`, **`disclaimer` 필드** 상시 포함. ETag/Cache-Control(공시 시점에만 변경).

---

## 구현 단계 (실행 순서)

### Phase 0 — 스캐폴딩 (풀 아키텍처)
1. pnpm 모노레포, `docker-compose`(Postgres+Redis), `packages/shared`(Zod), Fastify·Next.js 부트.
2. **Drizzle 스키마 전체**(파생·성과 테이블 포함) + 마이그레이션.
3. `apps/api/src/config/investors.seed.ts` — 큐레이션 CIK 시드(버크셔 `1067983`, NPS `1608046`, Pershing Square, Scion, Appaloosa, Baupost, Greenlight 등 10~20명).

### Phase 1 — MVP (미국, 피드+합의+웹)
4. EDGAR 인제스터(`ingest/edgar.ts`) + Bulk 백필 + 13F XML 파서.
5. CUSIP→티커 해결(`cusip_map`: 시드+퍼지+수동) — 큐레이션 보유 종목 한정의 유한 문제.
6. 파생: `derive/changes.ts`, `derive/consensus.ts`.
7. REST: `/feed`, `/consensus`, `/investors*`, `/securities/:id/holders`.
8. **Next.js 웹**: ① 변동 피드(NEW/ADD) ② 합의 Top-N ③ 투자자 프로필+보유 ④ 종목 보유자.
   - **시각화 씨앗**(사용자 핵심 니즈): 합의 Top-N **수평 막대차트** + 투자자 포트폴리오 **섹터 미니 트리맵**을 MVP에 포함.
9. 모든 화면·API에 **투자 자문 면책 문구** 상시 노출.

### Phase 2 — 한국 fast-follow + 시각화·성과
10. DART 인제스터(`ingest/dart.ts`) + `corp_code_map` + 보유자명 정규화(shortlist) → 같은 피드/랭킹에 KR 편입.
11. 가격 인제스트(US: FMP/Finnhub, KR: pykrx 사이드카) + `benchmarks` → `investor_performance` 계산 → 프로필에 승률/초과수익 + **합의 가중에 환류**.
12. 풀 시각화 대시보드(섹터 트리맵, 합의 히트맵, 분기 플로우 Sankey, 보유자수 추세).

### Phase 3 — 알림 + 모바일 + 개인화
13. 알림("팔로우 투자자 신규 13F", "합의 Top-10 신규 진입") 웹 푸시 → 모바일.
14. **React Native(Expo) 앱**: `packages/shared` + API 클라이언트 재사용(백엔드 변경 0).
15. 계정/워치리스트/커스텀 합의 가중.

---

## 리스크 / 법적 / 면책

| 리스크 | 대응 |
|---|---|
| 45일 지연·분기 단위 | UI에 `dataAsOf` 상시 표기, "최신 공시 기준" 명시, 실시간 암시 금지 |
| 13F 롱·미국상장만 | "롱 미국상장 포지션만; 공매도·현금·채권·해외 미표시" 카피 |
| CUSIP→티커 무료 완전본 없음 | 내부 `cusip_map`(오픈데이터 시드+퍼지+수동), 큐레이션 한정의 유한 문제, `confidence` 추적 |
| SEC 10 req/s·UA 필수 | 전역 throttle ≤8/s, UA 헤더, 429 백오프, 백필은 Bulk Dataset |
| pykrx 취약(스크래핑) | Python 사이드카로 격리, FMP/KRX 폴백, Phase 2 한정 |
| 데이터 라이선스 | SEC=공공 도메인(UA·레이트 준수). DART=약관·출처표기, **원본 재배포 금지**. 가격 API=표시용·재판매 금지. **CUSIP 목록 자체 게시 금지**(CGS 라이선스) |
| 투자 자문 법적 노출 | **상시 면책**: "본 앱은 공개 규제 공시를 정보 목적으로 집계할 뿐, 투자 자문/매매 권유가 아니며 면허 자문사가 제공하지 않음. 공시는 지연·불완전할 수 있음. 직접 조사/전문가 상담 요망." API `disclaimer` 필드 + 전 화면. UI 카피는 중립("공개된 매수","합의 보유")으로, "사세요" 금지 |

---

## 검증 (How to test)

- **DB/스키마**: `drizzle-kit` 마이그레이션 적용 → `docker-compose up` 후 Postgres에 전체 테이블 생성 확인.
- **인제스트 단위테스트**: 알려진 버크셔 13F 1건 fixture로 `parse-13f` → 보유 종목 수·총액(값 스케일 정규화 포함)이 EDGAR 표시값과 일치하는지 assert.
- **파생 검증**: 연속 2분기 fixture로 `compute:changes`가 NEW/ADD/REDUCE/EXIT를 정확 분류하는지, `compute:consensus` score/rank가 가중식과 일치하는지.
- **CUSIP 매핑**: 큐레이션 보유 종목의 해결률(exact/fuzzy/manual) 리포트, unmapped 0 목표.
- **E2E(피드)**: 백필 후 `GET /api/v1/feed?change_type=NEW`가 비어있지 않고 각 행에 티커·섹터·비중이 채워지는지(`curl`/통합테스트).
- **웹 스모크**: `pnpm --filter web dev` → 피드/합의/프로필 화면이 실제 API로 렌더, 막대차트·트리맵 표시, 면책 문구 노출 확인.
- **레이트리밋 안전**: 인제스트 로그로 SEC 요청이 ≤8 req/s 유지·429 0건 확인.
