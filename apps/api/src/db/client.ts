import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Drizzle 클라이언트(postgres-js). `postgres(url)` 은 첫 쿼리 전까지 실제 소켓을 열지 않으므로
 * 모듈 로드/테스트 import 시 DB 연결이 발생하지 않는다(스키마 introspection 안전).
 */
const DEFAULT_URL = 'postgres://app:app@localhost:5432/stockapp';

export function createDb(url: string = process.env.DATABASE_URL ?? DEFAULT_URL) {
  const client = postgres(url);
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

/** 앱 공용 기본 인스턴스(런타임 DATABASE_URL 사용). */
export const db: Db = createDb();

export { schema };
