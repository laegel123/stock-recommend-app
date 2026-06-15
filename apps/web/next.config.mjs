/** @type {import('next').NextConfig} */
const nextConfig = {
  // 워크스페이스 TS 패키지(@app/shared)를 Next 가 직접 트랜스파일(빌드 단계 없이 소스 소비).
  transpilePackages: ['@app/shared'],
  // 린트는 모노레포 루트 `pnpm lint`(+ pre-push 게이트)에서 단일 관리한다 → 빌드 중 중복 린트 비활성화.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
