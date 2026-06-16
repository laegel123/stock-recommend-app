import { describe, it, expect, vi } from 'vitest';
import {
  EdgarClient,
  EdgarHttpError,
  createEdgarClient,
  sharedLimiter,
} from '../../../src/ingest/http/edgar-client';
import { RateLimiter } from '../../../src/ingest/http/rate-limiter';
import { makeFakeClock } from './_fake-clock';
import { makeMockFetch, jsonResponse } from './_mock-fetch';

/** 결정적 백오프: 지터 난수를 1 로 고정 → 풀(캡된) 백오프 그대로 관측. */
const NO_JITTER = () => 1;

/**
 * EdgarClient 단위테스트(RED → GREEN, ADR-0017 / 가드레일 "UA 필수·429 0건").
 *
 * 주입한 가짜 fetch·시계로 SEC fetch 레이어 불변식을 결정적으로 검증한다:
 * (1) User-Agent 강제(가드레일), (2) ≤8 req/s throttle, (3) 429/5xx·네트워크 오류 백오프 재시도
 * (Retry-After 우선), (4) 비재시도 상태는 즉시 fail-loud, (5) 재시도 소진 시 EdgarHttpError.
 */

const UA = 'stock-recommend-app laegel1@gmail.com';

describe('EdgarClient — User-Agent 가드레일', () => {
  it('UA 미설정/공백이면 생성 시 throw(SEC: UA 필수)', () => {
    expect(() => new EdgarClient({ userAgent: '' })).toThrow(/User-Agent/i);
    expect(() => new EdgarClient({ userAgent: '   ' })).toThrow(/User-Agent/i);
  });

  it('모든 요청에 User-Agent 헤더를 실어 보낸다', async () => {
    const fc = makeFakeClock();
    const { fetch, calls } = makeMockFetch(fc, [() => jsonResponse({ cik: '1067983' })]);
    const client = new EdgarClient({ userAgent: UA, fetch, clock: fc.clock });

    await client.getJson('https://data.sec.gov/submissions/CIK0001067983.json');

    expect(calls[0]?.headers.get('user-agent')).toBe(UA);
  });
});

describe('EdgarClient — 본문 파싱', () => {
  it('getJson: JSON 파싱 결과 반환', async () => {
    const fc = makeFakeClock();
    const { fetch } = makeMockFetch(fc, [() => jsonResponse({ name: 'BERKSHIRE', n: 3 })]);
    const client = new EdgarClient({ userAgent: UA, fetch, clock: fc.clock });

    await expect(client.getJson('https://data.sec.gov/x.json')).resolves.toEqual({
      name: 'BERKSHIRE',
      n: 3,
    });
  });

  it('getText: 원문 텍스트 반환(XML/HTML 문서용)', async () => {
    const fc = makeFakeClock();
    const xml = '<ownershipDocument><documentType>4</documentType></ownershipDocument>';
    const { fetch } = makeMockFetch(fc, [() => new Response(xml, { status: 200 })]);
    const client = new EdgarClient({ userAgent: UA, fetch, clock: fc.clock });

    await expect(client.getText('https://www.sec.gov/Archives/.../form4.xml')).resolves.toBe(xml);
  });
});

describe('EdgarClient — ≤8 req/s throttle', () => {
  it('여러 요청을 최소 간격(125ms)으로 직렬 디스패치', async () => {
    const fc = makeFakeClock();
    const { fetch, calls } = makeMockFetch(fc, [
      () => jsonResponse({}),
      () => jsonResponse({}),
      () => jsonResponse({}),
    ]);
    const client = new EdgarClient({ userAgent: UA, fetch, clock: fc.clock });

    await Promise.all([
      client.getJson('https://data.sec.gov/u1'),
      client.getJson('https://data.sec.gov/u2'),
      client.getJson('https://data.sec.gov/u3'),
    ]);

    expect(calls.map((c) => c.at)).toEqual([0, 125, 250]);
  });
});

describe('EdgarClient — 재시도/백오프', () => {
  it('429 + Retry-After: 지정 초만큼 대기 후 재시도해 성공', async () => {
    const fc = makeFakeClock();
    const { fetch, calls } = makeMockFetch(fc, [
      () => new Response('', { status: 429, headers: { 'retry-after': '2' } }),
      () => jsonResponse({ ok: true }),
    ]);
    const client = new EdgarClient({ userAgent: UA, fetch, clock: fc.clock });

    await expect(client.getJson('https://data.sec.gov/u')).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(fc.sleeps).toContain(2000); // Retry-After: 2초 → 2000ms
  });

  it('503(Retry-After 없음): 지수 백오프로 재시도해 성공', async () => {
    const fc = makeFakeClock();
    const { fetch, calls } = makeMockFetch(fc, [
      () => new Response('', { status: 503 }),
      () => new Response('', { status: 503 }),
      () => jsonResponse({ ok: 1 }),
    ]);
    const client = new EdgarClient({
      userAgent: UA,
      fetch,
      clock: fc.clock,
      baseBackoffMs: 100,
      maxRetries: 3,
      random: NO_JITTER,
    });

    await client.getJson('https://data.sec.gov/u');
    expect(calls).toHaveLength(3);
    expect(fc.sleeps).toContain(100); // 백오프 attempt 0: 100
    expect(fc.sleeps).toContain(200); // 백오프 attempt 1: 200(지수)
  });

  it('네트워크 오류(fetch reject)는 백오프 후 재시도', async () => {
    const fc = makeFakeClock();
    const { fetch, calls } = makeMockFetch(fc, [
      () => {
        throw new Error('ECONNRESET');
      },
      () => jsonResponse({ ok: 1 }),
    ]);
    const client = new EdgarClient({ userAgent: UA, fetch, clock: fc.clock, baseBackoffMs: 10 });

    await expect(client.getJson('https://data.sec.gov/u')).resolves.toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
  });

  it('재시도 소진 시 EdgarHttpError(status) 로 fail-loud', async () => {
    const fc = makeFakeClock();
    const { fetch, calls } = makeMockFetch(fc, [() => new Response('overloaded', { status: 503 })]);
    const client = new EdgarClient({
      userAgent: UA,
      fetch,
      clock: fc.clock,
      baseBackoffMs: 10,
      maxRetries: 2,
    });

    const err = await client.getJson('https://data.sec.gov/u').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EdgarHttpError);
    expect((err as EdgarHttpError).status).toBe(503);
    expect(calls).toHaveLength(3); // 최초 1 + 재시도 2
  });

  it('비재시도 상태(404)는 재시도 없이 즉시 throw', async () => {
    const fc = makeFakeClock();
    const { fetch, calls } = makeMockFetch(fc, [() => new Response('not found', { status: 404 })]);
    const client = new EdgarClient({ userAgent: UA, fetch, clock: fc.clock });

    await expect(client.getJson('https://data.sec.gov/u')).rejects.toMatchObject({ status: 404 });
    expect(calls).toHaveLength(1);
  });
});

describe('EdgarClient — Retry-After 비정상값 → 지수 백오프 폴백', () => {
  it.each([
    ['음수', '-5'],
    ['비수치', 'soon'],
    ['HTTP-date', 'Wed, 21 Oct 2025 07:28:00 GMT'],
  ])('Retry-After=%s 이면 무시하고 지수 백오프로 재시도', async (_label, retryAfter) => {
    const fc = makeFakeClock();
    const { fetch, calls } = makeMockFetch(fc, [
      () => new Response('', { status: 503, headers: { 'retry-after': retryAfter } }),
      () => jsonResponse({ ok: 1 }),
    ]);
    const client = new EdgarClient({
      userAgent: UA,
      fetch,
      clock: fc.clock,
      baseBackoffMs: 100,
      random: NO_JITTER,
    });

    await expect(client.getJson('https://data.sec.gov/u')).resolves.toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
    expect(fc.sleeps).toContain(100); // Retry-After 무시 → 지수 백오프(attempt 0: 100)
  });

  it('과대 Retry-After 는 maxBackoffMs 로 클램프(무한 sleep 방지)', async () => {
    const fc = makeFakeClock();
    const { fetch } = makeMockFetch(fc, [
      () => new Response('', { status: 429, headers: { 'retry-after': '999999' } }),
      () => jsonResponse({ ok: 1 }),
    ]);
    const client = new EdgarClient({ userAgent: UA, fetch, clock: fc.clock, maxBackoffMs: 60_000 });

    await expect(client.getJson('https://data.sec.gov/u')).resolves.toEqual({ ok: 1 });
    expect(fc.sleeps).toContain(60_000); // 999999s 가 아니라 상한 60s
    expect(Math.max(...fc.sleeps)).toBeLessThanOrEqual(60_000);
  });

  it('지수 백오프도 maxBackoffMs 를 넘지 않는다', async () => {
    const fc = makeFakeClock();
    const { fetch } = makeMockFetch(fc, [
      () => new Response('', { status: 503 }),
      () => new Response('', { status: 503 }),
      () => jsonResponse({ ok: 1 }),
    ]);
    const client = new EdgarClient({
      userAgent: UA,
      fetch,
      clock: fc.clock,
      baseBackoffMs: 50_000, // 2^1 = 100_000 → 상한 초과
      maxBackoffMs: 60_000,
      maxRetries: 3,
      random: NO_JITTER,
    });

    await client.getJson('https://data.sec.gov/u');
    expect(Math.max(...fc.sleeps)).toBeLessThanOrEqual(60_000);
  });
});

describe('EdgarClient — 전역 throttle(공유 limiter)', () => {
  it('주입한 limiter 를 두 클라이언트가 공유하면 디스패치 간격이 전역으로 직렬화된다', async () => {
    const fc = makeFakeClock();
    const limiter = new RateLimiter(125, fc.clock);
    const { fetch, calls } = makeMockFetch(fc, [
      () => jsonResponse({}),
      () => jsonResponse({}),
      () => jsonResponse({}),
      () => jsonResponse({}),
    ]);
    const a = new EdgarClient({ userAgent: UA, fetch, clock: fc.clock, limiter });
    const b = new EdgarClient({ userAgent: UA, fetch, clock: fc.clock, limiter });

    await Promise.all([
      a.getJson('https://data.sec.gov/a1'),
      b.getJson('https://data.sec.gov/b1'),
      a.getJson('https://data.sec.gov/a2'),
      b.getJson('https://data.sec.gov/b2'),
    ]);

    // 클라이언트가 2개여도 공유 limiter 라 합산 간격은 125ms 직렬(16 req/s 로 튀지 않음).
    expect(calls.map((c) => c.at)).toEqual([0, 125, 250, 375]);
  });

  it('기본 경로(clock/limiter 미주입)는 모듈 공유 sharedLimiter 를 쓴다(safe-by-default)', () => {
    const a = new EdgarClient({ userAgent: UA });
    const b = createEdgarClient({ userAgent: UA });
    expect(a.limiter).toBe(sharedLimiter);
    expect(b.limiter).toBe(sharedLimiter);
  });

  it('clock 을 주입하면 분리된 limiter 를 만든다(테스트 격리)', () => {
    const fc = makeFakeClock();
    const client = new EdgarClient({ userAgent: UA, clock: fc.clock });
    expect(client.limiter).not.toBe(sharedLimiter);
  });
});

describe('EdgarClient — 요청 타임아웃(AbortSignal)', () => {
  it('모든 요청에 AbortSignal 을 부착한다', async () => {
    const fc = makeFakeClock();
    const { fetch, calls } = makeMockFetch(fc, [() => jsonResponse({})]);
    const client = new EdgarClient({ userAgent: UA, fetch, clock: fc.clock });

    await client.getJson('https://data.sec.gov/u');
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('타임아웃이 지나면 요청을 abort 하고 fail-loud 한다', async () => {
    const fc = makeFakeClock();
    // signal 이 abort 될 때까지 pending → 진짜 타임아웃 동작 검증(실타이머 ~5ms).
    const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted by timeout signal')),
        );
      })) as typeof fetch;
    const client = new EdgarClient({
      userAgent: UA,
      fetch: fetchImpl,
      clock: fc.clock,
      timeoutMs: 5,
      maxRetries: 0,
    });

    await expect(client.getJson('https://data.sec.gov/u')).rejects.toThrow(/abort/i);
  });
});

describe('EdgarClient — 폐기 응답 body 배수', () => {
  it('재시도로 버리는 응답의 body 를 cancel 한다(소켓 누수 방지)', async () => {
    const fc = makeFakeClock();
    const retryable = new Response('overloaded', { status: 503 });
    const cancelSpy = vi.spyOn(retryable.body as ReadableStream, 'cancel');
    const { fetch } = makeMockFetch(fc, [() => retryable, () => jsonResponse({ ok: 1 })]);
    const client = new EdgarClient({ userAgent: UA, fetch, clock: fc.clock, baseBackoffMs: 10 });

    await expect(client.getJson('https://data.sec.gov/u')).resolves.toEqual({ ok: 1 });
    expect(cancelSpy).toHaveBeenCalled();
  });
});

describe('createEdgarClient — 환경변수 UA fail-loud', () => {
  it('SEC_USER_AGENT 미설정이면 throw(가드레일: UA 필수)', () => {
    const saved = process.env.SEC_USER_AGENT;
    delete process.env.SEC_USER_AGENT;
    try {
      expect(() => createEdgarClient()).toThrow(/User-Agent/i);
    } finally {
      if (saved !== undefined) process.env.SEC_USER_AGENT = saved;
    }
  });

  it('SEC_USER_AGENT 설정이면 그 값으로 UA 를 쓴다', async () => {
    const saved = process.env.SEC_USER_AGENT;
    process.env.SEC_USER_AGENT = UA;
    try {
      const fc = makeFakeClock();
      const { fetch, calls } = makeMockFetch(fc, [() => jsonResponse({})]);
      const client = createEdgarClient({ fetch, clock: fc.clock });
      await client.getJson('https://data.sec.gov/u');
      expect(calls[0]?.headers.get('user-agent')).toBe(UA);
    } finally {
      if (saved === undefined) delete process.env.SEC_USER_AGENT;
      else process.env.SEC_USER_AGENT = saved;
    }
  });
});
