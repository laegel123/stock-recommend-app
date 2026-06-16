import type { Clock } from '../../../src/ingest/http/rate-limiter';

/**
 * 결정적 테스트용 가짜 시계. `sleep` 은 실제로 대기하지 않고 **가상 시각만 전진**시키며,
 * 요청된 대기(ms)를 기록한다 → 레이트리미터 간격·재시도 백오프를 실시간 의존 없이 검증.
 */
export interface FakeClock {
  /** RateLimiter/EdgarClient 에 주입할 Clock 구현. */
  clock: Clock;
  /** 현재 가상 시각(ms). */
  now(): number;
  /** 외부 경과 시간 주입(요청과 무관하게 시간이 흐른 상황 시뮬레이션). */
  advance(ms: number): void;
  /** `sleep(ms)` 으로 요청된 대기 목록(간격·백오프 단언용). */
  readonly sleeps: number[];
}

export function makeFakeClock(): FakeClock {
  let t = 0;
  const sleeps: number[] = [];
  const clock: Clock = {
    now: () => t,
    sleep: (ms: number) => {
      sleeps.push(ms);
      t += ms;
      return Promise.resolve();
    },
  };
  return {
    clock,
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    sleeps,
  };
}
