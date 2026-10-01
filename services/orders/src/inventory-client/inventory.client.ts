import { Inject, Injectable } from '@nestjs/common';
import { DomainError, ErrorCode, HttpTransportError, ServiceAuthClient } from '../common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { JSON_HTTP, JsonHttp } from '../http/http.module';

export interface Reservation {
  reservationId: string;
  status: string;
  expiresAt: string;
  unitPriceCents: number;
  totalCents: number;
  currency: 'COP';
}

export interface CallContext {
  idempotencyKey: string;
  correlationId: string;
  buyerId?: string;
}

/** Client for Inventory's internal API. Inventory rejections propagate with the same code. */
@Injectable()
export class InventoryClient {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(JSON_HTTP) private readonly http: JsonHttp,
    private readonly auth: ServiceAuthClient,
  ) {}

  createReservation(
    body: { eventId: string; sectorId: string; quantity: number; buyerId: string },
    ctx: CallContext,
  ): Promise<Reservation> {
    return this.post('/internal/v1/reservations', body, ctx);
  }

  /** Idempotent. Final status is CONFIRMED, or EXPIRED when expiry won the race. */
  confirmReservation(reservationId: string, ctx: CallContext): Promise<{ reservationId: string; status: string }> {
    return this.post(`/internal/v1/reservations/${reservationId}/confirm`, undefined, ctx);
  }

  private async post<T>(path: string, body: unknown, ctx: CallContext): Promise<T> {
    const url = `${this.config.inventoryUrl}${path}`;
    let res;
    try {
      res = await this.http.request<any>({
        method: 'POST',
        url,
        body,
        headers: {
          ...(await this.auth.header(this.config.inventoryUrl, ctx.buyerId)),
          'idempotency-key': ctx.idempotencyKey,
          'x-correlation-id': ctx.correlationId,
        },
      });
    } catch (err) {
      if (err instanceof HttpTransportError) throw new DomainError('INTERNAL', `Inventory unreachable: ${err.kind}`);
      throw err;
    }
    if (res.status >= 500) throw new DomainError('INTERNAL', `Inventory answered ${res.status}`);
    if (res.status >= 400) {
      const problem = res.body as { code?: ErrorCode; detail?: string } | undefined;
      throw new DomainError(problem?.code ?? 'INTERNAL', problem?.detail ?? `Inventory answered ${res.status}`);
    }
    return res.body as T;
  }
}
