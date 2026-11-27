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
