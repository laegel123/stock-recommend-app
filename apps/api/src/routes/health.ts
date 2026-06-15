import type { FastifyInstance } from 'fastify';
import { makeEnvelope } from '@app/shared';

/**
 * GET /api/v1/health — 라이브니스 프로브.
 * 모든 응답은 @app/shared 의 표준 봉투(면책 + dataAsOf)를 통과한다(ADR-0013).
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => makeEnvelope({ status: 'ok' as const }));
}
