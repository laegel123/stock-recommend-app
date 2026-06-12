---
name: new-parser
description: Scaffold a new filing parser using TDD (fixture + failing test + stub), then drive RED→GREEN→REFACTOR. Use when adding/changing a parser for a filing type (Form 4, 13D/13G, 13F info table, DART majorstock/elestock).
---

# /new-parser — 공시 파서 TDD 스캐폴드

목적: 새 공시 파서를 **테스트 우선(TDD)** 으로 추가한다. 구현보다 **실패하는 테스트를 먼저** 만든다(ADR-0014, CLAUDE.md).

## 입력 받기
사용자에게(또는 인자에서) 다음을 확인한다:
- `type` 슬러그: 예) `form4`, `sc13dg`, `f13f-infotable`, `dart-majorstock`
- 레인/산출물: 빠른 레인 → `activity_events`, 느린 레인(13F) → `holdings` (ARCHITECTURE §5, §6)
- 입력 형식: EDGAR 구조화 XML / DART JSON

## 절차 (RED → GREEN → REFACTOR)
1. **fixture 준비 (RED 재료)**
   - `apps/api/test/fixtures/<type>/` 에 **실제 공시 샘플** 1건을 저장(작게 트리밍 가능, 출처 URL 주석).
   - 같은 폴더에 기대 출력 `expected.json`(정규화된 `activity_events`/`holdings` 행) 작성.
2. **실패 테스트 작성 (RED)**
   - `apps/api/src/ingest/parsers/<type>.test.ts`:
     - fixture 로드 → `parse<Type>(raw)` 호출 → `expected.json` 과 deep-equal.
     - 값 스케일·CUSIP/티커·event_type 매핑 등 핵심 불변식을 assert.
   - `pnpm test`(또는 `pnpm test:watch`) 실행 → **실패(RED) 확인**. 실패 로그를 사용자에게 먼저 보여준다.
3. **스텁 → 최소 구현 (GREEN)**
   - `apps/api/src/ingest/parsers/<type>.ts` 에 `export function parse<Type>(raw): NormalizedRow[]` 스텁(처음엔 `throw new Error('not implemented')`).
   - 테스트가 통과하는 **최소 구현**만 작성. `packages/shared` 의 Zod 스키마/타입 재사용.
   - `pnpm test` → **통과(GREEN) 확인**.
4. **REFACTOR**
   - 그린 유지하며 정리. 엣지 케이스(중복 CUSIP 합산, 값 ×1000 정규화, transactionCode P/S/A/M)마다 **테스트를 먼저 추가**한 뒤 구현.

## 가드레일
- 구현 코드를 테스트보다 먼저 쓰지 않는다.
- 외부 호출 없이 **순수 함수**로(입력 raw → 출력 행). 네트워크는 인제스터 레이어에서.
- 새 소스 파일은 반드시 대응 테스트와 함께 (pre-push TDD 가드가 강제).
- 보고 시 RED→GREEN 실행 결과를 먼저 제시.
