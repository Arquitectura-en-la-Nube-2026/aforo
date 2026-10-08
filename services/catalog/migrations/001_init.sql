-- Catalog schema (services/catalog/README.md "Data", ADR-0006).
-- Business tables carry event_id and their keys/indexes start with it. idempotency_key is keyed by
-- request key. No inbox: catalog consumes nothing.

-- docs/architecture/state-machines.md "Event (catalog)": DRAFT -> PUBLISHED. saleState is not
-- stored; it is derived from the clock on every read.
CREATE TABLE event (
  id              uuid        PRIMARY KEY,
  name            text        NOT NULL CHECK (name <> ''),
  venue           text        NOT NULL CHECK (venue <> ''),
  starts_at       timestamptz NOT NULL,
  sales_opens_at  timestamptz NOT NULL,
  sales_closes_at timestamptz NOT NULL,
  status          text        NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),
  created_by      text        NOT NULL, -- X-User-Id of the organizer (the seed uses its own)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (sales_opens_at < sales_closes_at)
);
CREATE INDEX event_listing ON event (status, starts_at, id);

-- Published events never go back to DRAFT.
CREATE FUNCTION event_transition_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' AND NEW.status <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'event % cannot go from PUBLISHED to %', OLD.id, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_transition_guard BEFORE UPDATE OF status ON event
  FOR EACH ROW EXECUTE FUNCTION event_transition_guard();

CREATE TABLE sector (
  event_id    uuid    NOT NULL REFERENCES event (id),
  id          uuid    NOT NULL UNIQUE,
  position    integer NOT NULL CHECK (position >= 0), -- order given at creation
  name        text    NOT NULL CHECK (name <> ''),
  capacity    integer NOT NULL CHECK (capacity >= 1),
  price_cents bigint  NOT NULL CHECK (price_cents >= 0),
  currency    text    NOT NULL DEFAULT 'COP' CHECK (currency = 'COP'),
  PRIMARY KEY (event_id, id),
  UNIQUE (event_id, position)
);

CREATE TABLE sales_rules (
  event_id                uuid        PRIMARY KEY REFERENCES event (id),
  max_tickets_per_person  integer     NOT NULL CHECK (max_tickets_per_person >= 1),
  reservation_ttl_seconds integer     NOT NULL CHECK (reservation_ttl_seconds >= 30),
  opening_window_seconds  integer     NOT NULL CHECK (opening_window_seconds >= 0),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- json, not jsonb: a replay returns the stored body byte for byte (key order kept).
CREATE TABLE idempotency_key (
  key           text        PRIMARY KEY,
  request_hash  text        NOT NULL,
  status_code   integer     NOT NULL,
  response_body json,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox (
  id             uuid        PRIMARY KEY,
  seq            bigserial   NOT NULL, -- publish order: rows of one transaction share created_at
  event_id       uuid        NOT NULL,
  topic          text        NOT NULL,
  type           text        NOT NULL,
  correlation_id uuid        NOT NULL,
  payload        jsonb       NOT NULL, -- full envelope
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);
CREATE INDEX outbox_pending ON outbox (seq) WHERE published_at IS NULL;
