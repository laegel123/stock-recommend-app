import { RateLimiter, systemClock, type Clock } from './rate-limiter';

/**
 * SEC EDGAR HTTP 페처 — submissions 피드·공시 문서를 가져오는 fast/slow 레인 폴러의 공통 진입점.
 *
 * 가드레일 강제(CLAUDE.md·PLAN §인제스트):
 * - **User-Agent 필수** — 미설정이면 생성 시 fail-loud(SEC 는 UA 없는 요청을 차단).
 * - **≤8 req/s 전역** — `clock`/`limiter`/`minIntervalMs` 를 주입하지 않은 모든 클라이언트는
 *   **모듈 공유 `sharedLimiter`** 를 통과한다. 따라서 fast/slow 레인 폴러가 각자
 *   `createEdgarClient()` 를 불러도 합산 레이트가 SEC 10 req/s 한도를 넘지 않는다(safe-by-default).
 * - **요청 타임아웃** — 매 요청에 `AbortSignal.timeout` 부착(SEC hang → liveness 보호).
 * - **429/5xx·네트워크 오류 백오프 재시도** — `Retry-After` 우선(상한 클램프), 없으면 cap·지터를
 *   적용한 지수 백오프. 비재시도 상태(4xx)는 즉시 throw(조용한 누락 방지).
 *   **HTTP 상태 재시도 소진 시 `EdgarHttpError`; 네트워크 오류 소진 시엔 원오류를 그대로 전파**한다.
 *
 * 결정적 테스트를 위해 `fetch`·`clock`·`limiter`·`random` 을 주입 가능하게 두었다(운영은 전역 fetch·실시간 시계).
 * **무엇을** fetch/파싱/적재할지(미수집 accession 선별·폼별 파서 호출·멱등 upsert)는 폴러 레이어 책임.
 */

/** SEC ≤8 req/s → 요청 간 최소 간격(ms). 1000/8 = 125. */
export const SEC_MIN_INTERVAL_MS = 125;

/** 재시도 대상 HTTP 상태(과부하·일시 오류). 그 외 4xx 는 즉시 fail-loud. */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

/** 요청 타임아웃 기본값(ms) — SEC 가 응답을 매달면 AbortSignal 로 끊는다. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** 단일 재시도 대기의 상한(ms) — 지수 백오프·오설정 `Retry-After` 폭주를 클램프. */
export const DEFAULT_MAX_BACKOFF_MS = 60_000;

/** 비-2xx 응답(또는 재시도 소진)을 표현하는 오류 — status·url 보존. */
export class EdgarHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body?: string,
  ) {
    super(`EDGAR ${status} for ${url}${body ? `: ${body.slice(0, 200)}` : ''}`);
    this.name = 'EdgarHttpError';
  }
}

export interface EdgarClientOptions {
  /** SEC 가드레일: 식별 가능한 User-Agent(예: 'app-name email'). 공백이면 생성 실패. */
  userAgent: string;
  /** fetch 구현(기본: 전역 fetch). 테스트에서 주입. */
  fetch?: typeof fetch;
  /** 시간 의존성(기본: 실시간). 테스트에서 가짜 시계 주입. */
  clock?: Clock;
  /**
   * 레이트리미터. **미주입 + clock/minIntervalMs 도 미주입이면 모듈 공유 `sharedLimiter`**(전역
   * throttle)를 쓴다. clock/minIntervalMs 를 주입하면(테스트·특수 설정) 분리된 limiter 를 새로 만든다.
   */
  limiter?: RateLimiter;
  /** limiter 미주입 시 새 RateLimiter 의 최소 간격(ms). 기본 SEC_MIN_INTERVAL_MS. */
  minIntervalMs?: number;
  /** 재시도 횟수(최초 시도 제외). 기본 4. */
  maxRetries?: number;
  /** 지수 백오프 기준(ms): 대기 = baseBackoffMs × 2^attempt(상한·지터 적용). 기본 500. */
  baseBackoffMs?: number;
  /** 단일 재시도 대기 상한(ms). 기본 DEFAULT_MAX_BACKOFF_MS. */
  maxBackoffMs?: number;
  /** 요청 타임아웃(ms). 기본 DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
  /** 지터용 난수원([0,1)). 기본 Math.random. 테스트에서 `() => 1` 주입 시 풀 백오프(결정적). */
  random?: () => number;
}

/**
 * 모듈 레벨 공유 RateLimiter — **운영 기본 경로의 전역 throttle 강제**.
 *
 * clock/limiter/minIntervalMs 를 주입하지 않은 모든 `EdgarClient` 가 이 단일 인스턴스를 공유하므로,
 * fast/slow 레인 폴러가 각자 `createEdgarClient()` 를 호출해도 합산 디스패치 간격이 ≥125ms(≤8 req/s)로
 * 유지된다. 전역성을 호출자 기억력이 아니라 **기본값**이 보장한다(주입 시에만 분리 — 테스트 격리용).
 */
export const sharedLimiter = new RateLimiter(SEC_MIN_INTERVAL_MS, systemClock);

export class EdgarClient {
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: Clock;
  /** 이 클라이언트의 요청을 throttle 하는 RateLimiter(기본은 모듈 공유 `sharedLimiter`). */
  readonly limiter: RateLimiter;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly timeoutMs: number;
  private readonly random: () => number;

  constructor(opts: EdgarClientOptions) {
    const ua = opts.userAgent?.trim();
    if (!ua) {
      throw new Error('EdgarClient: User-Agent 가 필요합니다 (SEC 가드레일: UA 헤더 필수)');
    }
    this.userAgent = ua;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.clock = opts.clock ?? systemClock;
    this.maxRetries = opts.maxRetries ?? 4;
    this.baseBackoffMs = opts.baseBackoffMs ?? 500;
    this.maxBackoffMs = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.random = opts.random ?? Math.random;
    // clock/minIntervalMs 미주입(=운영 기본) → 전역 throttle 위해 모듈 공유 limiter 사용.
    // 주입 시(테스트·특수 설정)에만 그 clock·간격으로 분리된 limiter 를 만든다.
    const usesDefaultLimiter = !opts.clock && opts.minIntervalMs === undefined;
    this.limiter =
      opts.limiter ??
      (usesDefaultLimiter
        ? sharedLimiter
        : new RateLimiter(opts.minIntervalMs ?? SEC_MIN_INTERVAL_MS, this.clock));
  }

  /**
   * JSON 공시(submissions 피드 등) → 파싱 결과.
   *
   * 반환 타입 `T` 는 **런타임 미검증 캐스트**다(레이어 경계: 스키마 검증은 폴러 책임). 호출자는
   * 반드시 `packages/shared` 의 Zod 스키마로 파싱·검증한 뒤 사용해야 한다.
   */
  async getJson<T = unknown>(url: string): Promise<T> {
    const res = await this.request(url);
    return (await res.json()) as T;
  }

  /** 텍스트 공시(Form 4·13F XML, HTML 문서) → 원문. */
  async getText(url: string): Promise<string> {
    const res = await this.request(url);
    return res.text();
  }

  /** 레이트리미트 + 재시도/백오프를 적용해 성공(2xx) 응답을 돌려준다. */
  private async request(url: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.limiter.schedule(() => this.dispatch(url));
      } catch (err) {
        // 네트워크 오류: 횟수 남았으면 백오프 후 재시도, 아니면 원오류 전파.
        if (attempt < this.maxRetries) {
          await this.clock.sleep(this.backoffMs(attempt));
          continue;
        }
        throw err;
      }

      if (res.ok) return res;

      if (RETRYABLE_STATUSES.has(res.status) && attempt < this.maxRetries) {
        const delay = this.retryDelayMs(res, attempt);
        discardBody(res); // 폐기 응답 body 취소 → 미배수 소켓 누수·undici 경고 방지.
        await this.clock.sleep(delay);
        continue;
      }

      // 비재시도 상태(4xx) 또는 재시도 소진 → fail-loud.
      throw new EdgarHttpError(res.status, url, await safeText(res));
    }
  }

  /** 단일 fetch — User-Agent 헤더 + 타임아웃 AbortSignal 부착(전 요청 공통). */
  private dispatch(url: string): Promise<Response> {
    return this.fetchImpl(url, {
      headers: { 'User-Agent': this.userAgent },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  /** 지수 백오프(ms): min(baseBackoffMs × 2^attempt, maxBackoffMs) 에 풀 지터 적용(thundering herd 완화). */
  private backoffMs(attempt: number): number {
    const capped = Math.min(this.baseBackoffMs * 2 ** attempt, this.maxBackoffMs);
    return Math.round(this.random() * capped);
  }

  /** Retry-After(정수 초) 우선(상한 클램프), 없거나 음수·비수치(HTTP-date 등)면 지수 백오프. */
  private retryDelayMs(res: Response, attempt: number): number {
    const header = res.headers.get('retry-after');
    if (header) {
      const seconds = Number(header);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(Math.round(seconds * 1000), this.maxBackoffMs);
      }
    }
    return this.backoffMs(attempt);
  }
}

/** 오류 응답 본문 — 진단용. 읽기 실패는 무시(undefined). */
async function safeText(res: Response): Promise<string | undefined> {
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}

/** 폐기할 응답 body 취소(fire-and-forget) — 소켓 누수·미배수 경고 방지. 취소 실패는 무시. */
function discardBody(res: Response): void {
  res.body?.cancel().catch(() => undefined);
}

/**
 * 환경변수(`SEC_USER_AGENT`)에서 UA 를 읽어 클라이언트 생성. 미설정이면 생성자에서 fail-loud.
 * overrides 로 테스트/특수 설정 주입 가능.
 */
export function createEdgarClient(overrides: Partial<EdgarClientOptions> = {}): EdgarClient {
  return new EdgarClient({ userAgent: process.env.SEC_USER_AGENT ?? '', ...overrides });
}
