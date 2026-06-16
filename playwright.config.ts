import { defineConfig, devices } from '@playwright/test';

// E2E 하네스 — apps/web(Next.js, :3000)을 실제 브라우저로 검증한다.
// vitest(단위)와 분리: E2E 스펙은 루트 `e2e/`에만 두고,
// vitest include 는 `{apps,packages}/*/{test,src}/**` 만 보므로 글롭이 겹치지 않는다.
const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // 웹 dev 서버를 자동 기동. 이미 떠 있으면 재사용(로컬 반복을 빠르게).
  // CI 에서는 항상 새로 띄운다.
  webServer: {
    command: 'pnpm --filter @app/web run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
