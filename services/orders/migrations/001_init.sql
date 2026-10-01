-- Orders service schema. State machines: docs/architecture/state-machines.md (Order, Payment).
-- Columns are snake_case; money is integer cents (COP); ids are UUIDs.

CREATE TABLE "order" (
  id                     uuid PRIMARY KEY,
  buyer_id               uuid        NOT NULL,
  event_id               uuid        NOT NULL,
  sector_id              uuid        NOT NULL,
  quantity               integer     NOT NULL CHECK (quantity >= 1),
  reservation_id         uuid        NOT NULL UNIQUE,
  reservation_expires_at timestamptz NOT NULL,
  unit_price_cents       bigint      NOT NULL CHECK (unit_price_cents >= 0),
  total_cents            bigint      NOT NULL CHECK (total_cents >= 0),
  currency               text        NOT NULL DEFAULT 'COP' CHECK (currency = 'COP'),
  status                 text        NOT NULL DEFAULT 'PENDING_PAYMENT'
                         CHECK (status IN ('PENDING_PAYMENT', 'PAID', 'EXPIRED', 'REFUND_PENDING')),
  paid_at                timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_total_matches CHECK (total_cents = unit_price_cents * quantity),
  CONSTRAINT order_paid_at_iff_paid CHECK ((status = 'PAID') = (paid_at IS NOT NULL))
);

CREATE INDEX order_buyer_created_idx ON "order" (buyer_id, created_at DESC);
CREATE INDEX order_reservation_idx ON "order" (reservation_id);
CREATE INDEX order_refund_pending_idx ON "order" (id) WHERE status = 'REFUND_PENDING';

CREATE TABLE payment (
  id           uuid PRIMARY KEY, -- paymentId assigned by the payment gateway
  order_id     uuid        NOT NULL REFERENCES "order" (id),
  status       text        NOT NULL DEFAULT 'CREATED'
               CHECK (status IN ('CREATED', 'APPROVED', 'DECLINED', 'REFUNDED')),
  amount_cents bigint      NOT NULL CHECK (amount_cents >= 0),
  currency     text        NOT NULL DEFAULT 'COP' CHECK (currency = 'COP'),
  checkout_url text        NOT NULL,
  expires_at   timestamptz NOT NULL,
  refund_id    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_refund_id_iff_refunded CHECK ((status = 'REFUNDED') = (refund_id IS NOT NULL))
);

CREATE INDEX payment_order_idx ON payment (order_id);

CREATE TABLE idempotency_key (
  key           text PRIMARY KEY,
  request_hash  text        NOT NULL, -- SHA-256 of the request body
  status_code   integer     NOT NULL,
  response_body jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Consumer dedup: notificationId (payment webhook) and messageId (bus messages).
CREATE TABLE inbox (
  message_id   uuid PRIMARY KEY,
  source       text        NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- Transactional outbox; OutboxPublisher.flush() publishes rows with published_at IS NULL.
CREATE TABLE outbox (
  id             uuid PRIMARY KEY,
  topic          text        NOT NULL,
  type           text        NOT NULL,
  correlation_id uuid        NOT NULL,
  payload        jsonb       NOT NULL, -- full event envelope
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);

CREATE INDEX outbox_unpublished_idx ON outbox (created_at) WHERE published_at IS NULL;

-- Defense in depth: any transition not drawn in state-machines.md is rejected by the database.
-- Order: PENDING_PAYMENT -> PAID | REFUND_PENDING | EXPIRED; EXPIRED -> REFUND_PENDING (late approval).
CREATE FUNCTION order_check_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF (OLD.status, NEW.status) NOT IN (
    ('PENDING_PAYMENT', 'PAID'),
    ('PENDING_PAYMENT', 'REFUND_PENDING'),
    ('PENDING_PAYMENT', 'EXPIRED'),
    ('EXPIRED', 'REFUND_PENDING')
  ) THEN
    RAISE EXCEPTION 'invalid order transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER order_transition BEFORE UPDATE OF status ON "order"
  FOR EACH ROW EXECUTE FUNCTION order_check_transition();

-- Payment: CREATED -> APPROVED | DECLINED; APPROVED -> REFUNDED.
CREATE FUNCTION payment_check_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF (OLD.status, NEW.status) NOT IN (
    ('CREATED', 'APPROVED'),
    ('CREATED', 'DECLINED'),
    ('APPROVED', 'REFUNDED')
  ) THEN
    RAISE EXCEPTION 'invalid payment transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_transition BEFORE UPDATE OF status ON payment
  FOR EACH ROW EXECUTE FUNCTION payment_check_transition();
