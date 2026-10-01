import { BrokenCircuitError } from 'cockatiel';
import { DomainError, HttpTransportError } from '../common';
import { JsonHttp } from '../http/http.module';
import { CallContext, CreatePaymentRequest, GatewayPayment, PaymentGateway } from './payment-gateway';
import { GatewayRejectedError, GatewayUnavailableError, Resilience } from './resilience';

export type AuthHeaders = (audience: string) => Promise<Record<string, string>>;

/** ACL adapter to the mock payment gateway, wrapped in the E-06 resilience policy. */
export class HttpPaymentGateway implements PaymentGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly http: JsonHttp,
    private readonly authHeaders: AuthHeaders,
    private readonly resilience: Resilience,
  ) {}

  createPayment(request: CreatePaymentRequest, ctx: CallContext): Promise<GatewayPayment> {
    return this.call('/payments', request, ctx);
  }

  refundPayment(paymentId: string, ctx: CallContext): Promise<GatewayPayment> {
    return this.call(`/payments/${paymentId}/refunds`, undefined, ctx);
  }

  private async call(path: string, body: unknown, ctx: CallContext): Promise<GatewayPayment> {
    try {
      return await this.resilience.policy.execute(() => this.attempt(path, body, ctx));
    } catch (err) {
      if (err instanceof GatewayRejectedError) {
        const detail = (err.body as { detail?: string } | undefined)?.detail ?? err.message;
        const code = err.status === 404 ? 'NOT_FOUND' : err.status === 409 ? 'IDEMPOTENCY_CONFLICT' : 'VALIDATION_ERROR';
        throw new DomainError(code, detail);
      }
      if (err instanceof BrokenCircuitError || err instanceof GatewayUnavailableError) {
        throw new DomainError('PAYMENT_UNAVAILABLE', 'The payment gateway is unavailable, please retry');
      }
      throw err;
    }
  }

  private async attempt(path: string, body: unknown, ctx: CallContext): Promise<GatewayPayment> {
    let res;
    try {
      res = await this.http.request<GatewayPayment>({
        method: 'POST',
        url: `${this.baseUrl}${path}`,
        body,
        headers: {
          ...(await this.authHeaders(this.baseUrl)),
          'idempotency-key': ctx.idempotencyKey,
          'x-correlation-id': ctx.correlationId,
        },
      });
    } catch (err) {
      if (err instanceof HttpTransportError) throw new GatewayUnavailableError(`${err.kind}: ${err.message}`);
      throw err;
    }
    if (res.status >= 500) throw new GatewayUnavailableError(`gateway answered ${res.status}`);
    if (res.status >= 400) throw new GatewayRejectedError(res.status, res.body);
    if (!res.body) throw new GatewayUnavailableError('gateway answered without a body');
    return res.body;
  }
}
