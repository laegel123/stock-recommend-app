import { z } from 'zod';

/** 피드 레인: 사건기반 신선 공시(fast) vs 분기 포트폴리오 스냅샷(slow). */
export const Lane = z.enum(['fast', 'slow']);
export type Lane = z.infer<typeof Lane>;

/** 시장. */
export const Market = z.enum(['US', 'KR']);
export type Market = z.infer<typeof Market>;

/** 공시 출처. */
export const Source = z.enum(['edgar', 'dart']);
export type Source = z.infer<typeof Source>;

/** activity_events 의 사건 유형(빠른 레인 척추). */
export const EventType = z.enum([
  'BUY',
  'SELL',
  'STAKE_NEW',
  'STAKE_INCREASE',
  'STAKE_DECREASE',
  'STAKE_EXIT',
]);
export type EventType = z.infer<typeof EventType>;

/** 추적 투자자 유형. */
export const InvestorType = z.enum(['us_13f_manager', 'kr_disclosure_filer']);
export type InvestorType = z.infer<typeof InvestorType>;
