import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit 설정. `generate`(마이그레이션 SQL 생성)는 DB 연결이 필요 없고,
 * `migrate`/`push`/`studio` 만 DATABASE_URL 로 접속한다(.env 는 dotenv 가 로드).
 */
export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://app:app@localhost:5432/stockapp',
  },
  strict: true,
  verbose: true,
});
