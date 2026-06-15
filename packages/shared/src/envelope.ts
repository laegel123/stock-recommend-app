import { z } from 'zod';
import { DISCLAIMER } from './disclaimer';

/** 모든 API 응답 공통 메타(ADR-0013): 신선도 + 면책. */
export const ApiMeta = z.object({
  dataAsOf: z.string().datetime(),
  disclaimer: z.string(),
});
export type ApiMeta = z.infer<typeof ApiMeta>;

/** data + meta 봉투 스키마 팩토리(런타임 검증용). */
export const apiResponse = <T extends z.ZodTypeAny>(data: T) => z.object({ data, meta: ApiMeta });

/** data + meta 봉투의 정적 타입. */
export interface ApiResponse<T> {
  data: T;
  meta: ApiMeta;
}

/** 임의 페이로드를 면책·dataAsOf 가 포함된 표준 봉투로 감싼다(모든 라우트의 단일 출구). */
export function makeEnvelope<T>(
  data: T,
  dataAsOf: string = new Date().toISOString(),
): ApiResponse<T> {
  return { data, meta: { dataAsOf, disclaimer: DISCLAIMER } };
}
