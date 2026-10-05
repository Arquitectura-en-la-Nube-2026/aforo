// The single place that calls `fetch`. It adds Authorization and X-Queue-Pass, turns
// application/problem+json into ApiError, and sends the buyer to /login on a 401.
import { ApiError } from '@/lib/errors';
import { getToken } from '@/lib/session';
import type { Problem } from '@/lib/types';

let clientBase: string | null = null;
let onUnauthenticated: (() => void) | null = null;

export function setClientApiBase(url: string) {
  clientBase = url.replace(/\/$/, '');
}

export function setUnauthenticatedHandler(handler: (() => void) | null) {
  onUnauthenticated = handler;
}

/** Browser: the URL handed over by the layout. Server (SSR of public routes): SSR_API_BASE_URL. */
export function apiBase(): string {
  if (typeof window === 'undefined') {
    return (
      process.env.SSR_API_BASE_URL ??
      process.env.API_BASE_URL ??
      'http://localhost:8080'
    ).replace(/\/$/, '');
  }
  if (!clientBase) throw new Error('API base URL is not configured');
  return clientBase;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  /** Attach the session token. Public routes leave this off. */
  auth?: boolean;
  idempotencyKey?: string;
  queuePass?: string | null;
  signal?: AbortSignal;
}

/** Headers shared by normal requests and the SSE stream. */
export function buildHeaders(options: RequestOptions): Headers {
  const headers = new Headers({ Accept: 'application/json' });
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.auth) {
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
  if (options.queuePass) headers.set('X-Queue-Pass', options.queuePass);
  return headers;
}

export async function parseProblem(response: Response): Promise<ApiError> {
  try {
    const problem = (await response.json()) as Problem;
    if (problem && typeof problem.code === 'string') return ApiError.fromProblem(problem);
  } catch {
    // Not JSON (a proxy error page, for example): fall through to the generic code below.
  }
  return new ApiError(response.status, 'INTERNAL', response.headers.get('X-Correlation-Id'));
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      method: options.method ?? 'GET',
      headers: buildHeaders(options),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw ApiError.network();
  }

  if (!response.ok) {
    const apiError = await parseProblem(response);
    if (response.status === 401 && options.auth) onUnauthenticated?.();
    throw apiError;
  }
  return (await response.json()) as T;
}
