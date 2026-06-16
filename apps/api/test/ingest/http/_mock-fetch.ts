import type { FakeClock } from './_fake-clock';

/** 한 번의 fetch 응답을 만드는 스텝. 동기 throw 하면 네트워크 오류를 시뮬레이션한다. */
export type ResponseStep = () => Response | Promise<Response>;

/** 기록된 fetch 호출 1건. */
export interface FetchCall {
  url: string;
  headers: Headers;
  /** 요청에 부착된 AbortSignal(타임아웃 계약 단언용). */
  signal: AbortSignal | null;
  /** 호출 시점의 가상 시각(레이트리미트 간격 단언용). */
  at: number;
}

export interface MockFetch {
  fetch: typeof fetch;
  readonly calls: FetchCall[];
}

/**
 * 스크립트된 응답을 호출 순서대로 반환하는 가짜 fetch. 스크립트보다 호출이 많으면
 * **마지막 스텝을 반복**(예: 영구 503). 각 호출의 URL·헤더·가상 시각을 기록한다.
 */
export function makeMockFetch(fc: FakeClock, script: ResponseStep[]): MockFetch {
  const calls: FetchCall[] = [];
  let i = 0;
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      signal: init?.signal ?? null,
      at: fc.now(),
    });
    const idx = i < script.length ? i : script.length - 1;
    i += 1;
    const step = script[idx];
    if (!step) throw new Error('makeMockFetch: 빈 스크립트');
    return step();
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

/** JSON 응답 헬퍼(기본 200, content-type 자동). */
export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
