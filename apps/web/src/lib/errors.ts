import { es } from '@/lib/i18n/es';
import type { ErrorCode, Problem } from '@/lib/types';

/** An error answered by the API (application/problem+json) or a failure to reach it. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'NETWORK';
  readonly correlationId: string | null;
  /** Seconds the server asked us to wait (the Retry-After of a 429), or null. */
  readonly retryAfterSeconds: number | null;

  constructor(
    status: number,
    code: ErrorCode | 'NETWORK',
    correlationId: string | null,
    retryAfterSeconds: number | null = null,
  ) {
    super(`${code} (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  static fromProblem(problem: Problem, retryAfterSeconds: number | null = null): ApiError {
    return new ApiError(
      problem.status,
      problem.code,
      problem.correlationId ?? null,
      retryAfterSeconds,
    );
  }

  static network(): ApiError {
    return new ApiError(0, 'NETWORK', null);
  }
}

/**
 * The Retry-After header as whole seconds from now. It is either a number of seconds or an HTTP
 * date; null when it is absent or unreadable. Never negative.
 */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value || value.trim() === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds >= 0 ? Math.ceil(seconds) : null;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000));
}

/** An ApiError as plain data, so a server component can hand it to a client component. */
export interface SerializableError {
  status: number;
  code: ErrorCode | 'NETWORK';
  correlationId: string | null;
}

export function toSerializable(error: unknown): SerializableError {
  return error instanceof ApiError
    ? { status: error.status, code: error.code, correlationId: error.correlationId }
    : { status: 0, code: 'NETWORK', correlationId: null };
}

export interface ErrorView {
  title: string;
  body: string;
  /** Shown so a support person can follow the request in the logs (E-05). */
  correlationId: string | null;
}

const OWN_MESSAGE = ['SOLD_OUT', 'LIMIT_EXCEEDED', 'RESERVATION_EXPIRED'] as const;

/**
 * Errors are shown by `code`, never by `detail` (apps/web/README.md, rule 5). Three codes have
 * their own text; everything else gets the generic message. The correlationId is always kept.
 */
export function describeError(error: unknown): ErrorView {
  if (error instanceof ApiError) {
    if (error.code === 'NETWORK') {
      return { ...es.errors.network, correlationId: null };
    }
    const own = (OWN_MESSAGE as readonly string[]).includes(error.code)
      ? es.errors[error.code as (typeof OWN_MESSAGE)[number]]
      : es.errors.generic;
    return { ...own, correlationId: error.correlationId };
  }
  return { ...es.errors.generic, correlationId: null };
}

export const isApiError = (error: unknown, code: ErrorCode): error is ApiError =>
  error instanceof ApiError && error.code === code;
