import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { healthRoutes } from './routes/health';

/**
 * Fastify 앱 팩토리. `.listen` 을 호출하지 않으므로 테스트에서 `app.inject()` 로
 * 포트 바인딩 없이 라우트를 검증할 수 있다(엔트리/부팅 분리).
 */
export function buildApp(opts: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(opts);
  app.register(healthRoutes, { prefix: '/api/v1' });
  return app;
}
