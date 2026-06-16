# CLAUDE.md

이 파일은 Claude Code(및 협업 AI 에이전트)가 이 저장소에서 작업할 때 따르는 **운영 지침**이다.
사람이 읽어도 좋지만 1차 독자는 **에이전트**다. 본 프로젝트는 **에이전틱 엔지니어링 + 하네스 엔지니어링**
방식으로 만든다 — 작업을 작은 수직 슬라이스로 쪼개고, 모든 변경을 **결정적(deterministic) 검증 하네스**로
통과시킨 뒤에만 "완료"로 본다.

## 프로젝트 한 줄 요약
거대 투자자(버핏/버크셔, 국민연금, 유명 펀드)의 공개 규제 공시를 추적해, 그들의 매매를
**빠른 레인(Form 4·13D/G·DART, T+2~5) + 느린 레인(13F, 분기)** 멀티-케이던스 피드로 보여주고
**합의 종목을 랭킹·추천**하는 앱. 투자자별 성공률·성과와 시각화도 제공.

- 상세 설계 → `docs/ARCHITECTURE.md`
- 결정 기록 → `docs/ADR.md`
- 제품 기획/로드맵 → `docs/PLAN.md`

## 기술 스택 / 모노레포 레이아웃
pnpm workspaces 모노레포:
- `apps/api` — Fastify + TypeScript (라우트, 인제스트, 파생 계산)
- `apps/web` — Next.js(App Router) + Tailwind + Recharts (MVP 프론트)
- `packages/shared` — Zod 스키마 + 추론 타입 + API 클라이언트 (**단일 진실원**)
- `services/kr-prices` — Python(FastAPI + pykrx) 사이드카 (Phase 2)

DB: **PostgreSQL + Drizzle ORM** · 큐/스케줄: **BullMQ(Redis) + node-cron** · HTTP/파싱: `undici` + `fast-xml-parser` + `bottleneck`.

## 명령어 (정식 워크플로)
> 아직 스캐폴딩 전이면 이 규약대로 셋업한다.
- 설치: `pnpm install`
- 타입체크: `pnpm typecheck`  ·  린트: `pnpm lint`  ·  포맷: `pnpm format`
- 테스트: `pnpm test` (단위/픽스처)  ·  `pnpm test:watch`  ·  `pnpm test:e2e` (Playwright 화면 E2E, ADR-0016)
- DB: `pnpm db:up` (docker-compose: Postgres+Redis)  ·  `pnpm db:migrate`  ·  `pnpm db:seed`
- 개발: `pnpm --filter api dev`  ·  `pnpm --filter web dev`
- 훅 활성화(최초 1회, 클론 후): `bash scripts/setup-hooks.sh` (또는 PowerShell `scripts/setup-hooks.ps1`)

## 에이전트 작업 규약 (Working agreement)
1. 시작 전 `docs/ARCHITECTURE.md`·`docs/ADR.md`의 관련 부분을 읽는다. 결정과 충돌하면 **새 ADR을 추가/갱신**한다.
2. **작은 수직 슬라이스**로 작업한다. 예: "Form 4 파서 1개 + 픽스처 테스트 + `activity_events` 적재". 빅뱅 변경 금지.
3. **검증 하네스를 먼저 통과**시킨다(아래). 못 통과하면 완료 아님. 테스트 없이 머지 금지.
4. 기존 함수·유틸·패턴 재사용 우선(특히 `packages/shared` 타입). 새 코드보다 재사용.
5. 비밀키는 코드/커밋에 절대 넣지 않는다. `.env`(gitignore됨) + `.env.example`로 관리.
6. `main`에 직접 커밋 금지 — 브랜치 → 검증 → PR. **커밋/푸시는 사용자가 요청할 때만**.

## 검증 하네스 (Harness — "완료"의 정의)
모든 변경은 다음을 통과해야 한다:
- `pnpm typecheck && pnpm lint && pnpm test` 그린.
- **파서**(Form 4·13D/G·13F·DART)는 실제 공시 **fixture 골든 테스트** 필수: 입력 fixture → 정규화 출력이 기대값과 일치.
- **파생 로직**(`compute:changes`·`compute:consensus`)은 분기 fixture로 결정적 검증.
- **인제스트 멱등성**: 같은 `accession_number` 재실행이 중복 행을 만들지 않음(unique key).
- **레이트리미트 안전**: SEC ≤8 req/s + `User-Agent` 헤더 필수, 429 0건.
- **테스트 레이어**(ADR-0016): 단위/픽스처(vitest)가 기본. **화면 전용 불변식**(면책 상시 노출·중립 카피·차트 렌더·핵심 페이지)만 **E2E(Playwright, `pnpm test:e2e`)**. 데이터·파싱·파생은 vitest, 렌더 동작·가드레일은 E2E. E2E 스펙은 루트 `e2e/`(vitest와 글롭 분리). 개발 중 시각 검증은 Playwright **MCP**(`.mcp.json`).

이 게이트는 `.githooks/pre-push`로 **푸시 시점에 자동 강제**된다(스크립트가 정의되면 typecheck→lint→test 실행, 실패 시 푸시 차단; build·E2E 는 CI). **E2E는 무거워 pre-push 기본 비활성** — 로컬 강제는 `RUN_E2E=1 git push`, 상시 강제는 **CI**(`.github/workflows/ci.yml`: verify[typecheck·lint·test·build] + e2e).
또한 `main`/`master`로의 **강제(force)·삭제 푸시는 차단**된다. `commit-msg`(Conventional Commits)·`pre-commit`(시크릿 스캔)도 함께 활성화된다. 최초 1회 `scripts/setup-hooks`로 활성화. 상세는 `.githooks/README.md`.

에이전트 차원 자동화(`.claude/`): **PreToolUse**가 `--no-verify`·강제푸시를 차단하고, **PostToolUse**가 편집 시 자동 포맷·타입체크를 돈다. 프로젝트 스킬: `/new-parser`(TDD 파서 스캐폴드), `/adr`, `/add-investor`.

## 테스트 우선 (TDD) — 무조건 테스트부터
새 동작·버그 수정은 **반드시 RED → GREEN → REFACTOR** 순서로 한다.
1. **RED** — 원하는 동작을 표현하는 **실패하는 테스트를 먼저** 작성하고, 실행해 **실패를 확인**한다.
2. **GREEN** — 그 테스트를 통과시키는 **최소 구현**만 한다.
3. **REFACTOR** — 테스트 그린을 유지하며 정리한다.

규칙:
- 구현 코드를 대응 테스트보다 **먼저 쓰지 않는다**.
- 작업 보고 시 **RED였던 테스트의 실행 결과(실패→통과)를 먼저 제시**한다.
- 파서·파생 로직은 실제 공시 **fixture 골든 테스트**로 RED를 만든다.
- **기계적 백스톱**: `.githooks/pre-push`가 *소스 변경 시 테스트 동반*을 강제(소스만 바뀌고 테스트가 없으면 푸시 차단).
  정당한 예외만 커밋 메시지 `[skip-tdd]` 또는 `SKIP_TDD=1 git push`. (근거: ADR-0014)

## 도메인 용어
- **13F** — $100M↑ 운용사 분기 보유 공시(미국상장 롱+상장옵션; 공매도·해외·장외 제외, T+45). → `holdings`
- **Form 4** — 내부자/**10%↑ 보유자만** 매매 공시(T+2). 빠른 레인. **Table I(비파생)+Table II(파생/워런트) 모두 파싱**. → `activity_events`
- **13D** — 액티비스트 5%↑(T+5, 수정 2일). **13G** — 패시브/기관(QII)은 **분기말+45일 → 느림**. → `activity_events`
- **대량보유보고/임원·주요주주(DART)** — 일반 5%·내부자는 T+5(사건 기반). **단 국민연금은 약식·특례 → 분기/월 배치(실시간 아님).** → `activity_events`
- **CUSIP** — 미국 증권 식별자(13F가 제공, 티커 아님 → `cusip_map`으로 변환)
- **빠른 레인 / 느린 레인** — 사건기반 신선 공시 / 분기 포트폴리오 스냅샷

## 가드레일 (하지 말 것)
- SEC 레이트리미트(10 req/s) 초과 또는 `User-Agent` 누락.
- **CUSIP 목록·DART 원본·유료 가격 피드의 재배포/재판매**(라이선스 위반).
- **투자 자문성 카피**("사세요" 등). 중립 표현("공개된 매수", "합의 보유")만 사용. 제품은 "추천"이 아니라 **공개 공시 정보 집계**로 프레이밍.
- **개인화 금지**: 사용자 포트폴리오 기반 개별 조언 X. 철저히 **불특정 다수·동일 콘텐츠**(한국 유사투자자문업·미국 자문업 회피, ADR-0013).
- 모든 화면/API 응답에 **면책 문구** 누락.

## 면책 (Disclaimer)
본 앱은 공개 규제 공시를 **정보 목적**으로 집계할 뿐이며, 투자 자문이나 매매 권유가 아니다.
공시는 지연·불완전할 수 있다.
