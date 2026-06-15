import { defineConfig } from 'vitest/config';

// 모노레포 전 패키지의 테스트를 루트 `pnpm test` 한 번으로 실행한다.
// shared·api 모두 node 환경(기본). web 컴포넌트 테스트는 Phase 1에서 jsdom 프로젝트로 추가.
export default defineConfig({
  test: {
    include: [
      '{apps,packages}/*/test/**/*.{test,spec}.ts',
      '{apps,packages}/*/src/**/*.{test,spec}.ts',
    ],
  },
});
