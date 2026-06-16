import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Postgres enum 타입.
 *
 * ⚠️ market·source·event_type·investor_type 값은 `packages/shared` 의 Zod enum 과
 * **1:1 이어야 한다(단일 진실원, ADR-0006)**. 드리프트는 `test/db/schema.test.ts` 의
 * "@app/shared 단일 진실원 미러" 골든 테스트가 RED 로 잡는다.
 * (schema 는 drizzle-kit 이 esbuild 로 번들하므로 워크스페이스 import 의존을 피하려 값은 인라인한다.)
 */
export const marketEnum = pgEnum('market', ['US', 'KR']);
export const sourceEnum = pgEnum('source', ['edgar', 'dart']);
export const eventTypeEnum = pgEnum('event_type', [
  'BUY',
  'SELL',
  'STAKE_NEW',
  'STAKE_INCREASE',
  'STAKE_DECREASE',
  'STAKE_EXIT',
]);
export const investorTypeEnum = pgEnum('investor_type', ['us_13f_manager', 'kr_disclosure_filer']);

// ── DB 전용(대응하는 shared enum 없음) ───────────────────────────────
/** filings.form_type — 공시 양식(ARCH §5). */
export const formTypeEnum = pgEnum('form_type', [
  '13F-HR',
  '13F-HR/A',
  '4',
  'SC 13D',
  'SC 13G',
  '13D/A',
  '13G/A',
  'majorstock',
  'elestock',
]);
/** position_changes.change_type — 13F 분기 diff 분류. */
export const changeTypeEnum = pgEnum('change_type', ['NEW', 'ADD', 'REDUCE', 'EXIT', 'HOLD']);
/** activity_events.intent — 13D=active / 13G=passive(nullable). */
export const intentEnum = pgEnum('intent', ['active', 'passive']);
/** cusip_map.confidence — CUSIP→티커 해결 신뢰도(ADR-0009). */
export const confidenceEnum = pgEnum('cusip_confidence', ['exact', 'fuzzy', 'manual']);
