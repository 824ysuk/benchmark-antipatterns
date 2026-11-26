-- Run against the users table seeded by postgres-seq-scan/setup.sql.
DO $$
BEGIN
  IF (SELECT count(*) FROM users) <> 1000000 THEN
    RAISE EXCEPTION 'Expected the 1,000,000-row benchmark fixture';
  END IF;

  IF ARRAY(SELECT id FROM users ORDER BY id LIMIT 20 OFFSET 900000)
       IS DISTINCT FROM ARRAY(SELECT id FROM users WHERE id > 900000 ORDER BY id LIMIT 20)
     OR ARRAY(SELECT id FROM users ORDER BY id LIMIT 20)
       IS DISTINCT FROM ARRAY(SELECT id FROM users WHERE id > 0 ORDER BY id LIMIT 20)
  THEN
    RAISE EXCEPTION 'OFFSET and cursor produced different pages';
  END IF;
END $$;

\echo deep_offset
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM users ORDER BY id LIMIT 20 OFFSET 900000;

\echo deep_cursor
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM users WHERE id > 900000 ORDER BY id LIMIT 20;

\echo first_offset
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM users ORDER BY id LIMIT 20;

\echo first_cursor
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM users WHERE id > 0 ORDER BY id LIMIT 20;
