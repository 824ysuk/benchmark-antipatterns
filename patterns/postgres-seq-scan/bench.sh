#!/usr/bin/env bash
# bench.sh — PostgreSQL seq scan vs B-tree index 比較ベンチマーク
#
# 前提:
#   - Docker container `bap-pg-bench` が稼働中 (port 55432)
#   - setup.sql で DB `bench_seqscan` を seed 済 (1,000,000 rows)
#       docker exec -i bap-pg-bench psql -U postgres < setup.sql
#
# 実行:
#   bash bench.sh
#
# ─────────────────────────────────────────────────────────────────────────────
# 設計
# ─────────────────────────────────────────────────────────────────────────────
# Mode 1 (no index) で Query A / B を 5 反復、初回 (cold cache) を捨てて
# 2-5 の median を取る。次に CREATE INDEX して Mode 2 を同じ手順で計測。
# 最後に DROP INDEX で初期状態に戻す (再実行可能性を担保)。
#
# 計測は `EXPLAIN (ANALYZE, BUFFERS)` の "Execution Time" を抽出する。
# これは server-side のみの cost で、client-server TCP / parse / fetch
# overhead を含まない pure な engine 内部 cost。
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

CONTAINER="bap-pg-bench"
DB="bench_seqscan"
RUNS="${RUNS:-5}"

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "ERROR: container '${CONTAINER}' is not running." >&2
  echo "Start it with:" >&2
  echo "  docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=bench -p 55432:5432 postgres:16-alpine" >&2
  exit 1
fi

if ! docker exec "${CONTAINER}" psql -U postgres -d "${DB}" -tAc "SELECT 1 FROM users LIMIT 1;" >/dev/null 2>&1; then
  echo "ERROR: database '${DB}' or table 'users' not found in container '${CONTAINER}'." >&2
  echo "Run setup.sql first:" >&2
  echo "  docker exec -i ${CONTAINER} psql -U postgres < $(dirname "$0")/setup.sql" >&2
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# Helper: $1=label  $2=SQL — 5 反復、initial cold cache を捨てて 2-5 の median を返す
# ─────────────────────────────────────────────────────────────────────────────
measure() {
  local label="$1"
  local sql="$2"
  echo "===== ${label} ====="
  local times=()
  local i out t
  for i in $(seq 1 "${RUNS}"); do
    out=$(docker exec "${CONTAINER}" psql -U postgres -d "${DB}" \
      -c "DISCARD ALL;" \
      -c "EXPLAIN (ANALYZE, BUFFERS) ${sql}")
    t=$(echo "${out}" | grep -E "Execution Time" | head -1 \
      | sed -E 's/.*Execution Time: ([0-9.]+) ms.*/\1/')
    echo "  run ${i}: ${t} ms"
    if [[ "${i}" -ne 1 ]]; then
      times+=("${t}")
    fi
  done
  # median of 2..N (sort ascending, pick middle / mean of middle two)
  local median
  median=$(printf '%s\n' "${times[@]}" | sort -g | awk '
    { a[NR]=$1 }
    END {
      n=NR
      if (n%2==1) print a[(n+1)/2]
      else        printf "%.4f\n", (a[n/2]+a[n/2+1])/2
    }')
  echo "  median (run 2-${RUNS}): ${median} ms"
  echo ""
  # 出力ファイル用 (process substitution の代替)
  echo "${label}|${median}" >> "${RESULT_FILE}"
}

RESULT_FILE=$(mktemp)
trap 'rm -f "${RESULT_FILE}"' EXIT

# ─────────────────────────────────────────────────────────────────────────────
# 環境情報
# ─────────────────────────────────────────────────────────────────────────────
echo "========================================================================"
echo "PostgreSQL seq scan benchmark (Issue #17)"
echo "========================================================================"
docker exec "${CONTAINER}" psql -U postgres -d "${DB}" -tAc "SELECT version();"
echo "Date (UTC):     $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Host:           $(uname -sr) / $(uname -m)"
echo "Rows in users:  $(docker exec "${CONTAINER}" psql -U postgres -d "${DB}" -tAc 'SELECT count(*) FROM users;')"
echo "Tokyo hit:      $(docker exec "${CONTAINER}" psql -U postgres -d "${DB}" -tAc "SELECT count(*) FROM users WHERE city = 'tokyo';") (≈ 2% selectivity)"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Mode 1: no index (PK のみ)
# ─────────────────────────────────────────────────────────────────────────────
echo "######## Mode 1: NO secondary index ########"
docker exec "${CONTAINER}" psql -U postgres -d "${DB}" -c "DROP INDEX IF EXISTS users_email_idx;" >/dev/null
docker exec "${CONTAINER}" psql -U postgres -d "${DB}" -c "DROP INDEX IF EXISTS users_city_idx;"  >/dev/null

measure "Mode1-A: email lookup (no idx)" \
  "SELECT * FROM users WHERE email = 'user-500000@example.com'"
measure "Mode1-B: city='tokyo' (no idx)" \
  "SELECT * FROM users WHERE city = 'tokyo'"

# ─────────────────────────────────────────────────────────────────────────────
# Mode 2: B-tree index 追加
# ─────────────────────────────────────────────────────────────────────────────
echo "######## Mode 2: WITH B-tree index on email/city ########"
docker exec "${CONTAINER}" psql -U postgres -d "${DB}" \
  -c "CREATE INDEX users_email_idx ON users (email);" \
  -c "CREATE INDEX users_city_idx  ON users (city);" \
  -c "VACUUM ANALYZE users;" >/dev/null

measure "Mode2-A: email lookup (idx)" \
  "SELECT * FROM users WHERE email = 'user-500000@example.com'"
measure "Mode2-B: city='tokyo' (idx)" \
  "SELECT * FROM users WHERE city = 'tokyo'"

# ─────────────────────────────────────────────────────────────────────────────
# サマリ + cleanup (再実行可能性)
# ─────────────────────────────────────────────────────────────────────────────
echo "========================================================================"
echo "Summary (median of run 2-${RUNS})"
echo "========================================================================"

m1a=$(awk -F'|' '/Mode1-A/ {print $2}' "${RESULT_FILE}")
m2a=$(awk -F'|' '/Mode2-A/ {print $2}' "${RESULT_FILE}")
m1b=$(awk -F'|' '/Mode1-B/ {print $2}' "${RESULT_FILE}")
m2b=$(awk -F'|' '/Mode2-B/ {print $2}' "${RESULT_FILE}")

ratio_a=$(awk -v a="${m1a}" -v b="${m2a}" 'BEGIN{ printf "%.1f", a/b }')
ratio_b=$(awk -v a="${m1b}" -v b="${m2b}" 'BEGIN{ printf "%.1f", a/b }')

printf "| Query                                   | no idx (ms) | with idx (ms) | ratio  |\n"
printf "|-----------------------------------------|-------------|---------------|--------|\n"
printf "| A: WHERE email = '...' (point lookup)   | %11s | %13s | %5s× |\n" "${m1a}" "${m2a}" "${ratio_a}"
printf "| B: WHERE city = 'tokyo' (2%% hit)        | %11s | %13s | %5s× |\n" "${m1b}" "${m2b}" "${ratio_b}"
echo ""
echo "Note: Query A は point lookup (高 selectivity) で B-tree O(log n) が seq scan O(n)"
echo "       に対して桁違いに速い。Query B は low selectivity (2% hit) で heap fetch コストが"
echo "       支配的になり、9× 未達。詳細は README.md の「注意・例外」節参照。"

# Cleanup — 次回実行のため index を drop して Mode 1 と等価な初期状態に戻す
docker exec "${CONTAINER}" psql -U postgres -d "${DB}" \
  -c "DROP INDEX IF EXISTS users_email_idx;" \
  -c "DROP INDEX IF EXISTS users_city_idx;"  >/dev/null
echo ""
echo "Cleanup: dropped indexes (DB / table は残置、再実行可)"
