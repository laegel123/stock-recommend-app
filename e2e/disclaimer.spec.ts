import { test, expect } from '@playwright/test';

// ADR-0013: 모든 화면에 투자 자문 면책 문구가 상시 노출돼야 한다.
// DISCLAIMER 전문은 packages/shared/src/disclaimer.ts(단일 진실원)에 있고,
// 여기선 변하지 않을 안정적 부분 문자열로 단언한다(문구 미세 수정에 덜 깨지게).
const DISCLAIMER_FRAGMENT = '투자 자문이나 매매 권유가 아닙니다';

test.describe('홈 (Phase 0)', () => {
  test('타이틀이 렌더된다', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'stock-recommend-app' }),
    ).toBeVisible();
  });

  test('면책 문구가 푸터에 상시 노출된다 (ADR-0013)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('footer')).toContainText(DISCLAIMER_FRAGMENT);
  });
});
