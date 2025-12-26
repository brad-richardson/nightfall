export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
};

export type FetchRetryOptions = RetryOptions & {
  retryStatusCodes?: number[];
};

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 2000;
const DEFAULT_JITTER = 0.2;
const DEFAULT_RETRY_STATUS = [408, 429, 500, 502, 503, 504];

class RetryableFetchError extends Error {
  status: number;

  constructor(status: number) {
    super(`retryable fetch error: ${status}`);
    this.status = status;
    this.name = "RetryableFetchError";
  }
}

function shouldRetryDefault(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") {
    return false;
  }
  return true;
}

function calculateDelay(attempt: number, options: RetryOptions): number {
  const baseDelay = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelay = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const jitter = options.jitter ?? DEFAULT_JITTER;
  const exponential = baseDelay * Math.pow(2, attempt - 1);
  const jitterOffset = exponential * jitter * (Math.random() * 2 - 1);
  const delay = exponential + jitterOffset;
  return Math.max(0, Math.min(maxDelay, delay));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const shouldRetry = options.shouldRetry ?? shouldRetryDefault;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error)) {
        throw error;
      }
      const delayMs = calculateDelay(attempt, options);
      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }

  throw lastError ?? new Error("retry failed");
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: FetchRetryOptions = {}
): Promise<Response> {
  const retryStatusCodes = new Set(options.retryStatusCodes ?? DEFAULT_RETRY_STATUS);
  const userShouldRetry = options.shouldRetry;

  return withRetry(async () => {
    const response = await fetch(input, init);
    if (!response.ok && retryStatusCodes.has(response.status)) {
      throw new RetryableFetchError(response.status);
    }
    return response;
  }, {
    ...options,
    shouldRetry: (error) => {
      if (error instanceof RetryableFetchError) {
        return true;
      }
      if (error instanceof Error && error.name === "AbortError") {
        return false;
      }
      return userShouldRetry ? userShouldRetry(error) : true;
    }
  });
}
