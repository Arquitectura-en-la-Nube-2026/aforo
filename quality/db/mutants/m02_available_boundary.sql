-- MUTANT m02 (boundary shift): sector_availability allows available = capacity + 1.
-- Original: CHECK (available >= 0 AND available <= capacity)
-- Mutant:   CHECK (available >= 0 AND available <= capacity + 1)
-- Expected to be killed by TC-C1-02.

-- Inventory schema (services/inventory/README.md "Data", ADR-0006).
-- Business tables carry event_id and their keys/indexes start with it: the partition key if
-- Inventory is ever sharded. inbox and idempotency_key are keyed by message / request key.

-- Local projection of Catalog facts (EventPublished + SalesRulesConfigured, either order).
CREATE TABLE event_projection (
  event_id                uuid PRIMARY KEY,
  name                    text,
  sales_opens_at          timestamptz,
  sales_closes_at         timestamptz,
  published_at            timestamptz, -- occurredAt of the last EventPublished applied
  max_tickets_per_person  integer CHECK (max_tickets_per_person >= 1),
  reservation_ttl_seconds integer CHECK (reservation_ttl_seconds >= 30),
  rules_at                timestamptz  -- occurredAt of the last SalesRulesConfigured applied
);

-- The counter that serializes every reservation of a sector (E-02).
CREATE TABLE sector_availability (
  event_id    uuid    NOT NULL,
  sector_id   uuid    NOT NULL,
  name        text    NOT NULL,
  capacity    integer NOT NULL CHECK (capacity >= 0),
  available   integer NOT NULL CHECK (available >= 0 AND available <= capacity + 1),
  price_cents bigint  NOT NULL CHECK (price_cents >= 0),
  currency    text    NOT NULL DEFAULT 'COP' CHECK (currency = 'COP'),
  version     bigint  NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, sector_id)
);

CREATE TABLE reservation (
  id               uuid        PRIMARY KEY,
  event_id         uuid        NOT NULL,
  sector_id        uuid        NOT NULL,
  buyer_id         uuid        NOT NULL,
  quantity         integer     NOT NULL CHECK (quantity >= 1),
  unit_price_cents bigint      NOT NULL CHECK (unit_price_cents >= 0),
  total_cents      bigint      NOT NULL CHECK (total_cents = unit_price_cents * quantity),
  currency         text        NOT NULL DEFAULT 'COP' CHECK (currency = 'COP'),
  status           text        NOT NULL CHECK (status IN ('ACTIVE', 'CONFIRMED', 'EXPIRED', 'RELEASED')),
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, sector_id) REFERENCES sector_availability (event_id, sector_id)
);

-- One ACTIVE reservation per buyer and event (409 ACTIVE_RESERVATION_EXISTS).
CREATE UNIQUE INDEX reservation_one_active ON reservation (event_id, buyer_id) WHERE status = 'ACTIVE';
-- The housekeeping sweep (ADR-0003).
CREATE INDEX reservation_overdue ON reservation (expires_at) WHERE status = 'ACTIVE';

-- docs/architecture/state-machines.md: only ACTIVE moves; terminal states never change.
CREATE FUNCTION reservation_transition_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.status <> OLD.status AND OLD.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'reservation % cannot go from % to %', OLD.id, OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reservation_transition_guard BEFORE UPDATE OF status ON reservation
  FOR EACH ROW EXECUTE FUNCTION reservation_transition_guard();

-- Confirmed tickets per buyer and event (RF-12).
CREATE TABLE buyer_event_total (
  event_id  uuid    NOT NULL,
  buyer_id  uuid    NOT NULL,
  confirmed integer NOT NULL DEFAULT 0 CHECK (confirmed >= 0),
  PRIMARY KEY (event_id, buyer_id)
);

-- json, not jsonb: a replay returns the stored body byte for byte (key order kept).
CREATE TABLE idempotency_key (
  key           text        PRIMARY KEY,
  request_hash  text        NOT NULL,
  status_code   integer     NOT NULL,
  response_body json,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inbox (
  message_id   uuid        PRIMARY KEY,
  subscription text        NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox (
  id             uuid        PRIMARY KEY,
  event_id       uuid        NOT NULL,
  topic          text        NOT NULL,
  type           text        NOT NULL,
  correlation_id uuid        NOT NULL,
  payload        jsonb       NOT NULL, -- full envelope
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);
CREATE INDEX outbox_pending ON outbox (created_at) WHERE published_at IS NULL;
