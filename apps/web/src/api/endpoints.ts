// Thin typed clients, one per contract operation. Response shapes come from the generated types.
// Everything goes through the Gateway (never a service URL) and through `apiRequest`.
import { apiRequest, buildHeaders, parseProblem, apiBase } from '@/api/client';
import { ApiError } from '@/lib/errors';
import type {
  Availability,
  EventDetail,
  EventPage,
  LoginResponse,
  Order,
  OrderCreated,
  OrderPage,
  PaymentIntent,
  QueueStatus,
} from '@/lib/types';

type Signal = { signal?: AbortSignal };

// ---- Gateway ---------------------------------------------------------------------------------
export const login = (body: { email: string; displayName: string }) =>
  apiRequest<LoginResponse>('/api/v1/auth/login', { method: 'POST', body });

// ---- Catalog and availability (public) -------------------------------------------------------
export const listPublishedEvents = (page = 0, size = 20, opts: Signal = {}) =>
  apiRequest<EventPage>(`/api/v1/events?status=PUBLISHED&page=${page}&size=${size}`, opts);

export const getEvent = (eventId: string, opts: Signal = {}) =>
  apiRequest<EventDetail>(`/api/v1/events/${eventId}`, opts);

export const getAvailability = (eventId: string, opts: Signal = {}) =>
  apiRequest<Availability>(`/api/v1/events/${eventId}/availability`, opts);

// ---- Queue -----------------------------------------------------------------------------------
export const joinQueue = (eventId: string, opts: Signal = {}) =>
  apiRequest<QueueStatus>(`/api/v1/queue/${eventId}/join`, { method: 'POST', auth: true, ...opts });

export const getQueueStatus = (eventId: string, opts: Signal = {}) =>
  apiRequest<QueueStatus>(`/api/v1/queue/${eventId}/status`, { auth: true, ...opts });

/**
 * Opens the SSE stream with fetch (EventSource cannot send Authorization). Resolves the open
 * response; the caller reads it with `readSse`. Rejects with ApiError on a non-2xx answer.
 */
export async function openQueueStream(eventId: string, signal: AbortSignal): Promise<Response> {
  const headers = buildHeaders({ auth: true });
  headers.set('Accept', 'text/event-stream');
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/api/v1/queue/${eventId}/stream`, {
      headers,
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw ApiError.network();
  }
  if (!response.ok) throw await parseProblem(response);
  return response;
}

// ---- Orders ----------------------------------------------------------------------------------
export const createOrder = (
  body: { eventId: string; sectorId: string; quantity: number },
  idempotencyKey: string,
  queuePass: string | null,
) =>
  apiRequest<OrderCreated>('/api/v1/orders', {
    method: 'POST',
    auth: true,
    body,
    idempotencyKey,
    queuePass,
  });

export const listMyOrders = (page = 0, size = 10, opts: Signal = {}) =>
  apiRequest<OrderPage>(`/api/v1/orders?page=${page}&size=${size}`, { auth: true, ...opts });

export const getOrder = (orderId: string, opts: Signal = {}) =>
  apiRequest<Order>(`/api/v1/orders/${orderId}`, { auth: true, ...opts });

export const createPaymentIntent = (
  orderId: string,
  idempotencyKey: string,
  queuePass: string | null,
) =>
  apiRequest<PaymentIntent>(`/api/v1/orders/${orderId}/payment-intents`, {
    method: 'POST',
    auth: true,
    idempotencyKey,
    queuePass,
  });
