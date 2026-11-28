-- C1 — reservation integrity rules in the inventory database
-- (services/inventory/migrations/001_init.sql): the CHECKs of sector_availability and reservation,
-- the partial unique index reservation_one_active and the trigger reservation_transition_guard.
--
-- run.sh wraps this file in BEGIN ... ROLLBACK. Each case:
--   SAVEPOINT tc;  <fixture>  <assertions>  ROLLBACK TO SAVEPOINT tc;
-- Fixtures use literal UUIDs and literal timestamps (never now() in an assertion).
-- Template: copy a case, give it the next TC-C1-nn ID, test one rule per case.

-- Shared literals (psql variables).
\set event      '''11111111-1111-4111-8111-111111111111'''
\set sector     '''22222222-2222-4222-8222-222222222222'''
\set buyer      '''33333333-3333-4333-8333-333333333333'''
\set resv       '''44444444-4444-4444-8444-444444444444'''
\set buyer2     '''33333333-3333-4333-8333-333333333332'''
\set buyer3     '''33333333-3333-4333-8333-333333333334'''
\set resv2      '''44444444-4444-4444-8444-444444444442'''
\set resv3      '''44444444-4444-4444-8444-444444444443'''
\set nosector   '''22222222-2222-4222-8222-222222222299'''

-- TC-C1-01 -----------------------------------------------------------------------------------
SAVEPOINT tc;
SELECT qa.assert_lives('TC-C1-01', 'sector_availability accepts available = capacity (upper bound)',
  format($sql$INSERT INTO sector_availability (event_id, sector_id, name, capacity, available, price_cents)
              VALUES (%L, %L, 'Palco', 100, 100, 150000)$sql$, :event, :sector));
ROLLBACK TO SAVEPOINT tc;

-- TC-C1-02 -----------------------------------------------------------------------------------
SAVEPOINT tc;
SELECT qa.assert_raises('TC-C1-02', 'sector_availability rejects available = capacity + 1 (check_violation)',
  format($sql$INSERT INTO sector_availability (event_id, sector_id, name, capacity, available, price_cents)
              VALUES (%L, %L, 'Palco', 100, 101, 150000)$sql$, :event, :sector),
  '23514');
SELECT qa.assert_equals('TC-C1-02', 'no sector_availability row was left for the rejected sector',
  0::bigint, (SELECT count(*) FROM sector_availability WHERE event_id = :event AND sector_id = :sector));
ROLLBACK TO SAVEPOINT tc;

-- TC-C1-03 -----------------------------------------------------------------------------------
SAVEPOINT tc;
INSERT INTO sector_availability (event_id, sector_id, name, capacity, available, price_cents)
VALUES (:event, :sector, 'Palco', 100, 98, 150000);
INSERT INTO reservation (id, event_id, sector_id, buyer_id, quantity, unit_price_cents, total_cents,
                         status, expires_at, created_at, updated_at)
VALUES (:resv, :event, :sector, :buyer, 2, 150000, 300000,
        'CONFIRMED', '2026-10-01T15:10:00Z', '2026-10-01T15:00:00Z', '2026-10-01T15:05:00Z');

SELECT qa.assert_raises('TC-C1-03', 'the transition guard rejects CONFIRMED -> ACTIVE (raise_exception)',
  format($sql$UPDATE reservation SET status = 'ACTIVE' WHERE id = %L$sql$, :resv),
  'P0001');
SELECT qa.assert_equals('TC-C1-03', 'the rejected reservation keeps status CONFIRMED',
  'CONFIRMED'::text, (SELECT status FROM reservation WHERE id = :resv));
ROLLBACK TO SAVEPOINT tc;

-- TC-C1-04 -----------------------------------------------------------------------------------
SAVEPOINT tc;
SELECT qa.assert_lives('TC-C1-04', 'sector_availability accepts available = 0 (lower bound, sold out)',
  format($sql$INSERT INTO sector_availability (event_id, sector_id, name, capacity, available, price_cents)
              VALUES (%L, %L, 'Palco', 100, 0, 150000)$sql$, :event, :sector));
ROLLBACK TO SAVEPOINT tc;

-- TC-C1-05 -----------------------------------------------------------------------------------
SAVEPOINT tc;
SELECT qa.assert_raises('TC-C1-05', 'sector_availability rejects available = -1 (lower bound, check_violation)',
  format($sql$INSERT INTO sector_availability (event_id, sector_id, name, capacity, available, price_cents)
              VALUES (%L, %L, 'Palco', 100, -1, 150000)$sql$, :event, :sector),
  '23514');
ROLLBACK TO SAVEPOINT tc;

-- TC-C1-06 -----------------------------------------------------------------------------------
-- Three ACTIVE reservations (different buyers, so reservation_one_active does not interfere).
SAVEPOINT tc;
INSERT INTO sector_availability (event_id, sector_id, name, capacity, available, price_cents)
VALUES (:event, :sector, 'Palco', 100, 94, 150000);
INSERT INTO reservation (id, event_id, sector_id, buyer_id, quantity, unit_price_cents, total_cents,
                         status, expires_at, created_at, updated_at)
VALUES (:resv,  :event, :sector, :buyer,  2, 150000, 300000,
        'ACTIVE', '2026-10-01T15:10:00Z', '2026-10-01T15:00:00Z', '2026-10-01T15:00:00Z'),
       (:resv2, :event, :sector, :buyer2, 2, 150000, 300000,
        'ACTIVE', '2026-10-01T15:10:00Z', '2026-10-01T15:00:00Z', '2026-10-01T15:00:00Z'),
       (:resv3, :event, :sector, :buyer3, 2, 150000, 300000,
        'ACTIVE', '2026-10-01T15:10:00Z', '2026-10-01T15:00:00Z', '2026-10-01T15:00:00Z');

SELECT qa.assert_lives('TC-C1-06', 'the transition guard allows ACTIVE -> CONFIRMED',
  format($sql$UPDATE reservation SET status = 'CONFIRMED', updated_at = '2026-10-01T15:05:00Z'
              WHERE id = %L$sql$, :resv));
SELECT qa.assert_lives('TC-C1-06', 'the transition guard allows ACTIVE -> EXPIRED',
  format($sql$UPDATE reservation SET status = 'EXPIRED', updated_at = '2026-10-01T15:10:00Z'
              WHERE id = %L$sql$, :resv2));
SELECT qa.assert_lives('TC-C1-06', 'the transition guard allows ACTIVE -> RELEASED',
  format($sql$UPDATE reservation SET status = 'RELEASED', updated_at = '2026-10-01T15:06:00Z'
              WHERE id = %L$sql$, :resv3));
SELECT qa.assert_equals('TC-C1-06', 'the three reservations reached CONFIRMED, EXPIRED, RELEASED',
  'CONFIRMED,EXPIRED,RELEASED'::text,
  (SELECT string_agg(status, ',' ORDER BY status) FROM reservation
    WHERE id IN (:resv, :resv2, :resv3)));
ROLLBACK TO SAVEPOINT tc;

-- TC-C1-08 -----------------------------------------------------------------------------------
SAVEPOINT tc;
INSERT INTO sector_availability (event_id, sector_id, name, capacity, available, price_cents)
VALUES (:event, :sector, 'Palco', 100, 98, 150000);
INSERT INTO reservation (id, event_id, sector_id, buyer_id, quantity, unit_price_cents, total_cents,
                         status, expires_at, created_at, updated_at)
VALUES (:resv, :event, :sector, :buyer, 2, 150000, 300000,
        'ACTIVE', '2026-10-01T15:10:00Z', '2026-10-01T15:00:00Z', '2026-10-01T15:00:00Z');

SELECT qa.assert_raises('TC-C1-08', 'reservation_one_active rejects a second ACTIVE reservation for the same buyer and event (unique_violation)',
  format($sql$INSERT INTO reservation (id, event_id, sector_id, buyer_id, quantity, unit_price_cents,
                                       total_cents, status, expires_at, created_at, updated_at)
              VALUES (%L, %L, %L, %L, 1, 150000, 150000,
                      'ACTIVE', '2026-10-01T15:12:00Z', '2026-10-01T15:02:00Z', '2026-10-01T15:02:00Z')$sql$,
         :resv2, :event, :sector, :buyer),
  '23505');
SELECT qa.assert_equals('TC-C1-08', 'only the first ACTIVE reservation exists',
  1::bigint, (SELECT count(*) FROM reservation WHERE event_id = :event AND buyer_id = :buyer));
ROLLBACK TO SAVEPOINT tc;

-- TC-C1-11 -----------------------------------------------------------------------------------
SAVEPOINT tc;
INSERT INTO sector_availability (event_id, sector_id, name, capacity, available, price_cents)
VALUES (:event, :sector, 'Palco', 100, 98, 1000);

SELECT qa.assert_raises('TC-C1-11', 'reservation rejects total_cents <> unit_price_cents * quantity (1000 x 2, total 1999; check_violation)',
  format($sql$INSERT INTO reservation (id, event_id, sector_id, buyer_id, quantity, unit_price_cents,
                                       total_cents, status, expires_at, created_at, updated_at)
              VALUES (%L, %L, %L, %L, 2, 1000, 1999,
                      'ACTIVE', '2026-10-01T15:10:00Z', '2026-10-01T15:00:00Z', '2026-10-01T15:00:00Z')$sql$,
         :resv, :event, :sector, :buyer),
  '23514');
ROLLBACK TO SAVEPOINT tc;

-- TC-C1-12 -----------------------------------------------------------------------------------
SAVEPOINT tc;
INSERT INTO sector_availability (event_id, sector_id, name, capacity, available, price_cents)
VALUES (:event, :sector, 'Palco', 100, 100, 150000);

SELECT qa.assert_raises('TC-C1-12', 'reservation rejects a sector with no sector_availability row (foreign_key_violation)',
  format($sql$INSERT INTO reservation (id, event_id, sector_id, buyer_id, quantity, unit_price_cents,
                                       total_cents, status, expires_at, created_at, updated_at)
              VALUES (%L, %L, %L, %L, 2, 150000, 300000,
                      'ACTIVE', '2026-10-01T15:10:00Z', '2026-10-01T15:00:00Z', '2026-10-01T15:00:00Z')$sql$,
         :resv, :event, :nosector, :buyer),
  '23503');
ROLLBACK TO SAVEPOINT tc;

-- TC-C1-13 -----------------------------------------------------------------------------------
SAVEPOINT tc;
INSERT INTO sector_availability (event_id, sector_id, name, capacity, available, price_cents)
VALUES (:event, :sector, 'Palco', 100, 98, 150000);
INSERT INTO reservation (id, event_id, sector_id, buyer_id, quantity, unit_price_cents, total_cents,
                         status, expires_at, created_at, updated_at)
VALUES (:resv, :event, :sector, :buyer, 2, 150000, 300000,
        'CONFIRMED', '2026-10-01T15:10:00Z', '2026-10-01T15:00:00Z', '2026-10-01T15:05:00Z');

SELECT qa.assert_lives('TC-C1-13', 'the transition guard allows CONFIRMED -> CONFIRMED (same status)',
  format($sql$UPDATE reservation SET status = 'CONFIRMED', updated_at = '2026-10-01T15:06:00Z'
              WHERE id = %L$sql$, :resv));
SELECT qa.assert_equals('TC-C1-13', 'the reservation is still CONFIRMED',
  'CONFIRMED'::text, (SELECT status FROM reservation WHERE id = :resv));
ROLLBACK TO SAVEPOINT tc;

-- TC-C1-14 -----------------------------------------------------------------------------------
-- REDUNDANT RULE: capacity >= 0 is implied by 0 <= available <= capacity (the unnamed table-level
-- CHECK, which PostgreSQL names sector_availability_check). With capacity = -1 no value of available
-- satisfies it, so no row violates capacity_check alone: the rule cannot be exercised in isolation.
-- This row violates both; PostgreSQL evaluates CHECKs in name order and
-- sector_availability_capacity_check sorts first, so that is the constraint that fires.
SAVEPOINT tc;
SELECT qa.assert_violates('TC-C1-14', 'sector_availability rejects capacity = -1 (capacity_check; the row also violates sector_availability_check)',
  format($sql$INSERT INTO sector_availability (event_id, sector_id, name, capacity, available, price_cents)
              VALUES (%L, %L, 'Palco', -1, 0, 150000)$sql$, :event, :sector),
  'sector_availability_capacity_check');
ROLLBACK TO SAVEPOINT tc;

-- TC-C1-15 -----------------------------------------------------------------------------------
SAVEPOINT tc;
SELECT qa.assert_violates('TC-C1-15', 'sector_availability rejects price_cents = -1 (price_cents_check)',
  format($sql$INSERT INTO sector_availability (event_id, sector_id, name, capacity, available, price_cents)
              VALUES (%L, %L, 'Palco', 100, 100, -1)$sql$, :event, :sector),
  'sector_availability_price_cents_check');
ROLLBACK TO SAVEPOINT tc;

-- TC-C1-16 -----------------------------------------------------------------------------------
SAVEPOINT tc;
SELECT qa.assert_violates('TC-C1-16', 'sector_availability rejects currency = ''USD'' (currency_check)',
  format($sql$INSERT INTO sector_availability (event_id, sector_id, name, capacity, available, price_cents, currency)
              VALUES (%L, %L, 'Palco', 100, 100, 150000, 'USD')$sql$, :event, :sector),
  'sector_availability_currency_check');
ROLLBACK TO SAVEPOINT tc;

-- TC-C1-17 -----------------------------------------------------------------------------------
SAVEPOINT tc;
INSERT INTO sector_availability (event_id, sector_id, name, capacity, available, price_cents)
VALUES (:event, :sector, 'Palco', 100, 100, 150000);

SELECT qa.assert_violates('TC-C1-17', 'reservation rejects quantity = 0 (total 0; quantity_check)',
  format($sql$INSERT INTO reservation (id, event_id, sector_id, buyer_id, quantity, unit_price_cents,
                                       total_cents, status, expires_at, created_at, updated_at)
              VALUES (%L, %L, %L, %L, 0, 150000, 0,
                      'ACTIVE', '2026-10-01T15:10:00Z', '2026-10-01T15:00:00Z', '2026-10-01T15:00:00Z')$sql$,
         :resv, :event, :sector, :buyer),
  'reservation_quantity_check');
ROLLBACK TO SAVEPOINT tc;

-- TC-C1-18 -----------------------------------------------------------------------------------
SAVEPOINT tc;
INSERT INTO sector_availability (event_id, sector_id, name, capacity, available, price_cents)
VALUES (:event, :sector, 'Palco', 100, 100, 150000);

SELECT qa.assert_violates('TC-C1-18', 'reservation rejects unit_price_cents = -1 (quantity 1, total -1; unit_price_cents_check)',
  format($sql$INSERT INTO reservation (id, event_id, sector_id, buyer_id, quantity, unit_price_cents,
                                       total_cents, status, expires_at, created_at, updated_at)
              VALUES (%L, %L, %L, %L, 1, -1, -1,
                      'ACTIVE', '2026-10-01T15:10:00Z', '2026-10-01T15:00:00Z', '2026-10-01T15:00:00Z')$sql$,
         :resv, :event, :sector, :buyer),
  'reservation_unit_price_cents_check');
ROLLBACK TO SAVEPOINT tc;

-- TC-C1-19 -----------------------------------------------------------------------------------
SAVEPOINT tc;
INSERT INTO sector_availability (event_id, sector_id, name, capacity, available, price_cents)
VALUES (:event, :sector, 'Palco', 100, 100, 150000);

SELECT qa.assert_violates('TC-C1-19', 'reservation rejects currency = ''USD'' (currency_check)',
  format($sql$INSERT INTO reservation (id, event_id, sector_id, buyer_id, quantity, unit_price_cents,
                                       total_cents, currency, status, expires_at, created_at, updated_at)
              VALUES (%L, %L, %L, %L, 2, 150000, 300000, 'USD',
                      'ACTIVE', '2026-10-01T15:10:00Z', '2026-10-01T15:00:00Z', '2026-10-01T15:00:00Z')$sql$,
         :resv, :event, :sector, :buyer),
  'reservation_currency_check');
ROLLBACK TO SAVEPOINT tc;

-- TC-C1-20 -----------------------------------------------------------------------------------
SAVEPOINT tc;
INSERT INTO sector_availability (event_id, sector_id, name, capacity, available, price_cents)
VALUES (:event, :sector, 'Palco', 100, 100, 150000);

SELECT qa.assert_violates('TC-C1-20', 'reservation rejects status = ''PENDING'' (status_check)',
  format($sql$INSERT INTO reservation (id, event_id, sector_id, buyer_id, quantity, unit_price_cents,
                                       total_cents, status, expires_at, created_at, updated_at)
              VALUES (%L, %L, %L, %L, 2, 150000, 300000,
                      'PENDING', '2026-10-01T15:10:00Z', '2026-10-01T15:00:00Z', '2026-10-01T15:00:00Z')$sql$,
         :resv, :event, :sector, :buyer),
  'reservation_status_check');
ROLLBACK TO SAVEPOINT tc;

-- TC-C1-21 -----------------------------------------------------------------------------------
-- Rest of the terminal-exit matrix (CONFIRMED -> ACTIVE is TC-C1-03): one reservation per terminal
-- state, different buyers; each UPDATE runs in its own subtransaction inside assert_raises.
SAVEPOINT tc;
INSERT INTO sector_availability (event_id, sector_id, name, capacity, available, price_cents)
VALUES (:event, :sector, 'Palco', 100, 94, 150000);
INSERT INTO reservation (id, event_id, sector_id, buyer_id, quantity, unit_price_cents, total_cents,
                         status, expires_at, created_at, updated_at)
VALUES (:resv,  :event, :sector, :buyer,  2, 150000, 300000,
        'CONFIRMED', '2026-10-01T15:10:00Z', '2026-10-01T15:00:00Z', '2026-10-01T15:05:00Z'),
       (:resv2, :event, :sector, :buyer2, 2, 150000, 300000,
        'EXPIRED',   '2026-10-01T15:10:00Z', '2026-10-01T15:00:00Z', '2026-10-01T15:10:00Z'),
       (:resv3, :event, :sector, :buyer3, 2, 150000, 300000,
        'RELEASED',  '2026-10-01T15:10:00Z', '2026-10-01T15:00:00Z', '2026-10-01T15:06:00Z');

SELECT qa.assert_raises('TC-C1-21', 'the transition guard rejects CONFIRMED -> EXPIRED (raise_exception)',
  format($sql$UPDATE reservation SET status = 'EXPIRED' WHERE id = %L$sql$, :resv), 'P0001');
SELECT qa.assert_raises('TC-C1-21', 'the transition guard rejects CONFIRMED -> RELEASED (raise_exception)',
  format($sql$UPDATE reservation SET status = 'RELEASED' WHERE id = %L$sql$, :resv), 'P0001');
SELECT qa.assert_raises('TC-C1-21', 'the transition guard rejects EXPIRED -> ACTIVE (raise_exception)',
  format($sql$UPDATE reservation SET status = 'ACTIVE' WHERE id = %L$sql$, :resv2), 'P0001');
SELECT qa.assert_raises('TC-C1-21', 'the transition guard rejects EXPIRED -> CONFIRMED (raise_exception)',
  format($sql$UPDATE reservation SET status = 'CONFIRMED' WHERE id = %L$sql$, :resv2), 'P0001');
SELECT qa.assert_raises('TC-C1-21', 'the transition guard rejects EXPIRED -> RELEASED (raise_exception)',
  format($sql$UPDATE reservation SET status = 'RELEASED' WHERE id = %L$sql$, :resv2), 'P0001');
SELECT qa.assert_raises('TC-C1-21', 'the transition guard rejects RELEASED -> ACTIVE (raise_exception)',
  format($sql$UPDATE reservation SET status = 'ACTIVE' WHERE id = %L$sql$, :resv3), 'P0001');
SELECT qa.assert_raises('TC-C1-21', 'the transition guard rejects RELEASED -> CONFIRMED (raise_exception)',
  format($sql$UPDATE reservation SET status = 'CONFIRMED' WHERE id = %L$sql$, :resv3), 'P0001');
SELECT qa.assert_raises('TC-C1-21', 'the transition guard rejects RELEASED -> EXPIRED (raise_exception)',
  format($sql$UPDATE reservation SET status = 'EXPIRED' WHERE id = %L$sql$, :resv3), 'P0001');
ROLLBACK TO SAVEPOINT tc;

-- TC-C1-22 -----------------------------------------------------------------------------------
-- Same-status updates (CONFIRMED -> CONFIRMED is TC-C1-13).
SAVEPOINT tc;
INSERT INTO sector_availability (event_id, sector_id, name, capacity, available, price_cents)
VALUES (:event, :sector, 'Palco', 100, 94, 150000);
INSERT INTO reservation (id, event_id, sector_id, buyer_id, quantity, unit_price_cents, total_cents,
                         status, expires_at, created_at, updated_at)
VALUES (:resv,  :event, :sector, :buyer,  2, 150000, 300000,
        'ACTIVE',   '2026-10-01T15:10:00Z', '2026-10-01T15:00:00Z', '2026-10-01T15:00:00Z'),
       (:resv2, :event, :sector, :buyer2, 2, 150000, 300000,
        'EXPIRED',  '2026-10-01T15:10:00Z', '2026-10-01T15:00:00Z', '2026-10-01T15:10:00Z'),
       (:resv3, :event, :sector, :buyer3, 2, 150000, 300000,
        'RELEASED', '2026-10-01T15:10:00Z', '2026-10-01T15:00:00Z', '2026-10-01T15:06:00Z');

SELECT qa.assert_lives('TC-C1-22', 'the transition guard allows ACTIVE -> ACTIVE (same status)',
  format($sql$UPDATE reservation SET status = 'ACTIVE', updated_at = '2026-10-01T15:01:00Z'
              WHERE id = %L$sql$, :resv));
SELECT qa.assert_lives('TC-C1-22', 'the transition guard allows EXPIRED -> EXPIRED (same status)',
  format($sql$UPDATE reservation SET status = 'EXPIRED', updated_at = '2026-10-01T15:11:00Z'
              WHERE id = %L$sql$, :resv2));
SELECT qa.assert_lives('TC-C1-22', 'the transition guard allows RELEASED -> RELEASED (same status)',
  format($sql$UPDATE reservation SET status = 'RELEASED', updated_at = '2026-10-01T15:07:00Z'
              WHERE id = %L$sql$, :resv3));
ROLLBACK TO SAVEPOINT tc;

-- TC-C1-23 -----------------------------------------------------------------------------------
SAVEPOINT tc;
INSERT INTO sector_availability (event_id, sector_id, name, capacity, available, price_cents)
VALUES (:event, :sector, 'Palco', 100, 97, 150000);
INSERT INTO reservation (id, event_id, sector_id, buyer_id, quantity, unit_price_cents, total_cents,
                         status, expires_at, created_at, updated_at)
VALUES (:resv, :event, :sector, :buyer, 2, 150000, 300000,
        'CONFIRMED', '2026-10-01T15:10:00Z', '2026-10-01T15:00:00Z', '2026-10-01T15:05:00Z');

SELECT qa.assert_lives('TC-C1-23', 'reservation_one_active accepts a new ACTIVE reservation when the buyer''s other one for the event is CONFIRMED',
  format($sql$INSERT INTO reservation (id, event_id, sector_id, buyer_id, quantity, unit_price_cents,
                                       total_cents, status, expires_at, created_at, updated_at)
              VALUES (%L, %L, %L, %L, 1, 150000, 150000,
                      'ACTIVE', '2026-10-01T15:20:00Z', '2026-10-01T15:10:00Z', '2026-10-01T15:10:00Z')$sql$,
         :resv2, :event, :sector, :buyer));
ROLLBACK TO SAVEPOINT tc;
