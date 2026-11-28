-- Assertion helpers for the data tier (component C1), in the style of Lab 1.
-- Loaded once into the fresh test database by quality/db/run.sh, after the migration under test.
--
-- Every assertion prints one verdict line as a NOTICE: "ok <id> <description>" or
-- "not ok <id> <description> -- <detail>", and never aborts the file, so every case reports.
--
-- Isolation: run.sh runs each test file inside one transaction that is rolled back at the end,
-- and every case inside it sits between SAVEPOINT / ROLLBACK TO SAVEPOINT. A results table would
-- be rolled back together with the case, so the pass/fail counters are SEQUENCES: nextval() is
-- never rolled back, so qa.summary() still sees every verdict at the end of the file.

CREATE SCHEMA qa;

CREATE SEQUENCE qa.passed;
CREATE SEQUENCE qa.failed;

-- Called by run.sh before each file.
CREATE FUNCTION qa.reset() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM setval('qa.passed', 1, false);
  PERFORM setval('qa.failed', 1, false);
END;
$$;

CREATE FUNCTION qa.count(seq regclass) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  last bigint;
  called boolean;
BEGIN
  EXECUTE format('SELECT last_value, is_called FROM %s', seq) INTO last, called;
  RETURN CASE WHEN called THEN last ELSE 0 END;
END;
$$;

CREATE FUNCTION qa.ok(test_id text, description text, condition boolean, detail text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(condition, false) THEN
    PERFORM nextval('qa.passed');
    RAISE NOTICE 'ok % %', test_id, description;
    RETURN true;
  END IF;
  PERFORM nextval('qa.failed');
  RAISE NOTICE 'not ok % % -- %', test_id, description, coalesce(detail, 'condition is false or null');
  RETURN false;
END;
$$;

CREATE FUNCTION qa.assert_equals(test_id text, description text, expected anyelement, actual anyelement)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  RETURN qa.ok(test_id, description, expected IS NOT DISTINCT FROM actual,
               format('expected %s, got %s', coalesce(expected::text, 'NULL'), coalesce(actual::text, 'NULL')));
END;
$$;

-- Passes when `sql` raises; when expected_sqlstate is given, the SQLSTATE must match too
-- (e.g. '23514' check_violation, '23505' unique_violation, 'P0001' raise_exception).
-- The statement runs in its own subtransaction (the EXCEPTION block), so a failure leaves no trace.
CREATE FUNCTION qa.assert_raises(test_id text, description text, sql text, expected_sqlstate text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF expected_sqlstate IS NULL OR SQLSTATE = expected_sqlstate THEN
      RETURN qa.ok(test_id, description, true);
    END IF;
    RETURN qa.ok(test_id, description, false,
                 format('expected SQLSTATE %s, got %s: %s', expected_sqlstate, SQLSTATE, SQLERRM));
  END;
  RETURN qa.ok(test_id, description, false,
               format('expected an error%s, the statement succeeded',
                      coalesce(' with SQLSTATE ' || expected_sqlstate, '')));
END;
$$;

-- Passes only when `sql` raises a constraint error (e.g. 23514 check_violation) whose violated
-- constraint is `expected_constraint` (CONSTRAINT_NAME from GET STACKED DIAGNOSTICS).
-- assert_raises compares the SQLSTATE only, so it cannot tell which CHECK of a table fired.
CREATE FUNCTION qa.assert_violates(test_id text, description text, sql text, expected_constraint text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  got_constraint text;
  got_state text;
  got_message text;
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS got_constraint = CONSTRAINT_NAME,
                            got_state = RETURNED_SQLSTATE,
                            got_message = MESSAGE_TEXT;
    RETURN qa.ok(test_id, description, got_constraint = expected_constraint,
                 format('expected constraint %s, got %s (SQLSTATE %s): %s', expected_constraint,
                        coalesce(nullif(got_constraint, ''), 'none'), got_state, got_message));
  END;
  RETURN qa.ok(test_id, description, false,
               format('expected a violation of %s, the statement succeeded', expected_constraint));
END;
$$;

-- Passes when `sql` runs without error. Its effects stay (use a savepoint around the case).
CREATE FUNCTION qa.assert_lives(test_id text, description text, sql text)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    RETURN qa.ok(test_id, description, false, format('raised %s: %s', SQLSTATE, SQLERRM));
  END;
  RETURN qa.ok(test_id, description, true);
END;
$$;

-- Called by run.sh at the end of each file: prints the totals and raises if anything failed,
-- so psql -v ON_ERROR_STOP=1 exits non-zero.
CREATE FUNCTION qa.summary() RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  passed bigint := qa.count('qa.passed');
  failed bigint := qa.count('qa.failed');
BEGIN
  IF passed + failed = 0 THEN
    RAISE EXCEPTION 'summary: no assertions ran';
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'summary: % passed, % failed', passed, failed;
  END IF;
  RETURN format('summary: %s passed, %s failed', passed, failed);
END;
$$;
