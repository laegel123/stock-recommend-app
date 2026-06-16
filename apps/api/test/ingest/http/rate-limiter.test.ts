import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../../../src/ingest/http/rate-limiter';
import { makeFakeClock } from './_fake-clock';

/**
 * RateLimiter 단위테스트(RED → GREEN, ADR-0017 / 하네스 "≤8 req/s").
 *
 * 가짜 시계를 주입해 **디스패치 간격을 결정적으로** 검증한다. 핵심 불변식:
 * 연속 작업은 `minIntervalMs` 이상 간격으로 직렬 디스패치되고(전역 레이트 = 1000/interval req/s),
 * 순서·반환값을 보존하며, 한 작업이 실패해도 이후 작업 스케줄이 멈추지 않는다.
 */

describe('RateLimiter — 최소 간격 직렬 디스패치', () => {
  it('연속 작업을 minIntervalMs(125ms=8req/s) 간격으로 디스패치하고 순서·결과를 보존', async () => {
    const fc = makeFakeClock();
    const rl = new RateLimiter(125, fc.clock);
    const dispatchedAt: number[] = [];

    const results = await Promise.all(
      Array.from({ length: 5 }, (_unused, i) =>
        rl.schedule(async () => {
          dispatchedAt.push(fc.now());
          return i;
        }),
      ),
    );

    expect(results).toEqual([0, 1, 2, 3, 4]);
    expect(dispatchedAt).toEqual([0, 125, 250, 375, 500]);
  });

  it('이미 간격이 지난 경우(외부 경과) 대기 없이 즉시 디스패치', async () => {
    const fc = makeFakeClock();
    const rl = new RateLimiter(125, fc.clock);

    await rl.schedule(async () => undefined); // t=0 디스패치, nextAllowed=125
    fc.advance(200); // 요청과 무관하게 시간 경과(>간격)
    const sleepsBefore = fc.sleeps.length;
    await rl.schedule(async () => undefined); // now=200 ≥ 125 → 대기 불필요

    expect(fc.sleeps.length).toBe(sleepsBefore); // 새 sleep 없음
    expect(fc.now()).toBe(200);
  });

  it('한 작업이 reject 해도 이후 작업 스케줄은 계속된다(체인이 끊기지 않음)', async () => {
    const fc = makeFakeClock();
    const rl = new RateLimiter(125, fc.clock);

    const failing = rl.schedule(async () => {
      throw new Error('boom');
    });
    const next = rl.schedule(async () => 'ok');

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });
});
