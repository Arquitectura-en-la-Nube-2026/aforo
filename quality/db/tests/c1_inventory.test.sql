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
