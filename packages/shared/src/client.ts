import { z } from 'zod';
import { apiResponse, type ApiResponse } from './envelope';

/** /health 의 data 페이로드 스키마. */
export const HealthData = z.object({ status: z.literal('ok') });
export type HealthData = z.infer<typeof HealthData>;

export interface ApiClient {
  health(): Promise<ApiResponse<HealthData>>;
}

/**
 * 플랫폼 무관 API 클라이언트(스텁) — web·모바일이 공유한다.
 * Phase 1 에서 /feed·/consensus 등으로 확장. 현재는 /health 만 호출하고 봉투 스키마로 검증한다.
 */
export function createClient(baseUrl: string): ApiClient {
  const root = baseUrl.replace(/\/+$/, '');
  const healthSchema = apiResponse(HealthData);
  return {
    async health(): Promise<ApiResponse<HealthData>> {
      const res = await fetch(`${root}/health`);
      return healthSchema.parse(await res.json());
    },
  };
}
