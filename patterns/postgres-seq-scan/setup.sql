-- setup.sql — PostgreSQL seq scan vs B-tree index ベンチマーク用 schema + seed
--
-- 実行:
--   docker exec -i bap-pg-bench psql -U postgres < setup.sql
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 設計メモ
-- ─────────────────────────────────────────────────────────────────────────────
-- 既存 DB と隔離するため新規 `bench_seqscan` DB を作成する。
-- 1,000,000 行を generate_series でサーバサイド生成 (~1 秒)。
-- city は 50 都市から %50 で振り分け、'tokyo' が hit する行は約 2% (= 20,000 行)
-- になり、Query B (low selectivity) で index が seq scan に勝てないケースを示せる。
-- VACUUM ANALYZE で planner 統計を確定させる (これがないと planner が
-- 過剰に index を避ける / 選ぶことがある)。
-- ─────────────────────────────────────────────────────────────────────────────

\c postgres

DROP DATABASE IF EXISTS bench_seqscan;
CREATE DATABASE bench_seqscan;

\c bench_seqscan

CREATE TABLE users (
  id          BIGINT PRIMARY KEY,
  email       TEXT NOT NULL,
  city        TEXT NOT NULL,
  created_at  TIMESTAMP NOT NULL
);

INSERT INTO users (id, email, city, created_at)
SELECT
  g,
  'user-' || g || '@example.com',
  (ARRAY[
    'tokyo','osaka','kyoto','yokohama','nagoya','sapporo','kobe','fukuoka','sendai','hiroshima',
    'kitakyushu','chiba','sakai','niigata','hamamatsu','kumamoto','sagamihara','shizuoka','okayama','kagoshima',
    'funabashi','hachioji','kawaguchi','himeji','suginami','itabashi','matsudo','higashiosaka','nishinomiya','kurashiki',
    'oita','kanazawa','utsunomiya','matsuyama','asahikawa','nara','toyota','toyonaka','gifu','hirakata',
    'fujisawa','kashiwa','toyohashi','nagasaki','okazaki','machida','wakayama','nagano','toyama','iwaki'
  ])[1 + (g % 50)],
  TIMESTAMP '2024-01-01' + (random() * INTERVAL '730 days')
FROM generate_series(1, 1000000) AS g;

VACUUM ANALYZE users;

-- 確認 (出力に 1000000 と 50 が出れば成功)
SELECT count(*) AS row_count FROM users;
SELECT count(DISTINCT city) AS city_count FROM users;
SELECT count(*) AS tokyo_hit FROM users WHERE city = 'tokyo';
