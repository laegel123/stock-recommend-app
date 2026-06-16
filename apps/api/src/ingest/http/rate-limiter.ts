/**
 * 전역 요청 throttle 프리미티브 — SEC EDGAR fetch 레이어의 ≤8 req/s 강제(ADR-0005·0017).
 *
 * `bottleneck`(실시간 타이머 기반, 결정적 테스트 곤란) 대신 **주입 가능한 Clock** 위에서 도는
 * 최소-간격 직렬화기다. 작업은 단일 프로미스 체인으로 줄세워지고, 각 작업의 **디스패치(슬롯 확보)**
 * 시점이 직전 슬롯보다 `minIntervalMs` 이상 뒤가 되도록 보장한다(전역 레이트 = 1000/interval req/s).
 *
 * 간격은 작업 함수의 **지속시간과 분리**된다(체인은 fn 완료가 아니라 슬롯 확보 시 전진) → fetch 가
 * 길어져도 throttle 이 과하게 느려지지 않고, fetch 가 짧아도 레이트를 넘기지 않는다.
 * BullMQ(ADR-0005)는 잡 단위 재시도·동시성을 담당하고, 이 프리미티브는 그 안에서 per-request 레이트를 맡는다.
 */

/** 시간 의존성 추상화 — 운영은 `systemClock`, 테스트는 가짜 시계를 주입해 결정적으로 검증. */
export interface Clock {
  /** 현재 시각(ms, 단조 증가 가정). */
  now(): number;
  /** ms 만큼 대기. */
  sleep(ms: number): Promise<void>;
}

/** 실시간 시계(운영 기본값). */
export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
};

/**
 * 최소 간격 직렬 레이트리미터. 같은 인스턴스를 거치는 모든 작업이 전역 간격을 공유한다.
 */
export class RateLimiter {
  /** 슬롯 확보 체인(작업 fn 완료가 아니라 '디스패치 가능' 시점에 전진). */
  private chain: Promise<void> = Promise.resolve();
  /** 다음 작업이 디스패치될 수 있는 가장 이른 시각(ms). */
  private nextAllowed = 0;

  constructor(
    private readonly minIntervalMs: number,
    private readonly clock: Clock = systemClock,
  ) {}

  /**
   * 작업을 레이트 한도에 맞춰 스케줄한다. 반환 프로미스는 작업 결과로 resolve(작업이 throw 하면
   * 그대로 reject)되며, **작업 실패는 후속 작업 스케줄에 영향을 주지 않는다**(체인 단절 방지).
   */
  schedule<T>(task: () => Promise<T>): Promise<T> {
    const slot = this.chain.then(async () => {
      const now = this.clock.now();
      const startAt = Math.max(now, this.nextAllowed);
      if (startAt > now) await this.clock.sleep(startAt - now);
      this.nextAllowed = startAt + this.minIntervalMs;
    });
    // 다음 작업은 fn 완료가 아니라 '슬롯 확보' 시점에 이어붙인다 → 간격은 디스패치 기준, fn 지속시간과 분리.
    this.chain = slot.then(
      () => undefined,
      () => undefined,
    );
    return slot.then(task);
  }
}
