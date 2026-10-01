export interface CreatePaymentRequest {
  orderId: string;
  amountCents: number;
  currency: 'COP';
  returnUrl: string;
}

export interface GatewayPayment {
  paymentId: string;
  orderId: string;
  status: 'CREATED' | 'APPROVED' | 'DECLINED' | 'REFUNDED';
  amountCents: number;
  currency: 'COP';
  checkoutUrl: string;
  expiresAt: string;
}

export interface CallContext {
  idempotencyKey: string;
  correlationId: string;
}

/** Port. Today the mock-payment-gateway function, tomorrow Wompi: only the adapter changes. */
export interface PaymentGateway {
  createPayment(request: CreatePaymentRequest, ctx: CallContext): Promise<GatewayPayment>;
  refundPayment(paymentId: string, ctx: CallContext): Promise<GatewayPayment>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
