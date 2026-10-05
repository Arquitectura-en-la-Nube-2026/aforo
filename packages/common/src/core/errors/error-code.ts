export const ERROR_DEFINITIONS = {
  UNAUTHENTICATED: { status: 401, title: "Authentication required" },
  SALE_NOT_OPEN: { status: 409, title: "Sale is not open" },
  SOLD_OUT: { status: 409, title: "Not enough availability" },
  LIMIT_EXCEEDED: { status: 409, title: "Ticket limit exceeded" },
  ACTIVE_RESERVATION_EXISTS: { status: 409, title: "An active reservation already exists" },
  RESERVATION_EXPIRED: { status: 409, title: "Reservation has expired" },
  IDEMPOTENCY_CONFLICT: { status: 409, title: "Idempotency key conflict" },
  VALIDATION_ERROR: { status: 422, title: "Request validation failed" },
  MALFORMED_REQUEST: { status: 400, title: "Malformed request" },
  NOT_FOUND: { status: 404, title: "Resource not found" },
  INVALID_SIGNATURE: { status: 401, title: "Invalid signature" },
  PAYMENT_UNAVAILABLE: { status: 503, title: "Payment service unavailable" },
  RATE_LIMITED: { status: 429, title: "Request limit exceeded" },
  INTERNAL: { status: 500, title: "Internal server error" },
} as const;

export type ErrorCode = keyof typeof ERROR_DEFINITIONS;
