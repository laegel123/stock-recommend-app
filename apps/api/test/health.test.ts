import { describe, it, expect, afterAll } from 'vitest';
import { DISCLAIMER } from '@app/shared';
import { buildApp } from '../src/app';

const app = buildApp();
afterAll(() => app.close());

describe('GET /api/v1/health', () => {
  it('returns 200 with data.status="ok"', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('ok');
  });

  it('includes the disclaimer + ISO dataAsOf in meta (ADR-0013)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    const body = res.json();
    expect(body.meta.disclaimer).toBe(DISCLAIMER);
    expect(Number.isNaN(Date.parse(body.meta.dataAsOf))).toBe(false);
  });
});
