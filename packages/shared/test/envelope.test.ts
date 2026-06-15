import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { makeEnvelope, apiResponse, ApiMeta, DISCLAIMER } from '../src/index';

describe('response envelope (ADR-0013)', () => {
  it('makeEnvelope wraps data with disclaimer + ISO dataAsOf', () => {
    const env = makeEnvelope({ status: 'ok' });
    expect(env.data).toEqual({ status: 'ok' });
    expect(env.meta.disclaimer).toBe(DISCLAIMER);
    expect(Number.isNaN(Date.parse(env.meta.dataAsOf))).toBe(false);
  });

  it('makeEnvelope honors an explicit dataAsOf', () => {
    const ts = '2026-06-15T00:00:00.000Z';
    expect(makeEnvelope({ a: 1 }, ts).meta.dataAsOf).toBe(ts);
  });

  it('apiResponse(schema) validates a well-formed envelope', () => {
    const schema = apiResponse(z.object({ status: z.string() }));
    const parsed = schema.parse(makeEnvelope({ status: 'ok' }));
    expect(parsed.meta.disclaimer).toBe(DISCLAIMER);
  });

  it('rejects an envelope missing the disclaimer', () => {
    const schema = apiResponse(z.object({ status: z.string() }));
    const bad = { data: { status: 'ok' }, meta: { dataAsOf: new Date().toISOString() } };
    expect(schema.safeParse(bad).success).toBe(false);
  });

  it('ApiMeta requires an ISO datetime for dataAsOf', () => {
    expect(ApiMeta.safeParse({ dataAsOf: 'not-a-date', disclaimer: DISCLAIMER }).success).toBe(
      false,
    );
  });
});
