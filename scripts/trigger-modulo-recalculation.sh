#!/usr/bin/env bash
# trigger-modulo-recalculation.sh
#
# Manually triggers the Modulo pricing recalculation for one or more data months.
# Use this whenever stale calculationDetails need to be overwritten — e.g. after
# the algorithm drops a signal type (such as roomAttributes) or after a bulk
# import adds a new upload_month.
#
# Usage:
#   ./scripts/trigger-modulo-recalculation.sh                  # all months in DB
#   ./scripts/trigger-modulo-recalculation.sh 2026-03          # specific month
#   ./scripts/trigger-modulo-recalculation.sh 2025-11 2026-03  # multiple months
#
# Requires the app to be running on localhost:5000.

set -euo pipefail

HOST="${MODULO_HOST:-http://localhost:5000}"
ENDPOINT="/api/pricing/generate-modulo-optimized"

run_for_month() {
  local month="$1"
  echo ""
  echo "=== Triggering Modulo recalculation for month: ${month} ==="
  echo "    Endpoint: POST ${HOST}${ENDPOINT}"

  response=$(curl -sf -X POST "${HOST}${ENDPOINT}" \
    -H "Content-Type: application/json" \
    -d "{\"month\": \"${month}\"}" \
    -w "\n%{http_code}" 2>&1) || {
      echo "    ERROR: curl failed. Is the server running at ${HOST}?" >&2
      return 1
    }

  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | head -n -1)

  if [ "$http_code" -eq 200 ]; then
    echo "    Started (HTTP ${http_code}): ${body}"
    echo "    Calculation running in background — check server logs for progress."
  else
    echo "    ERROR: HTTP ${http_code}" >&2
    echo "    Response: ${body}" >&2
    return 1
  fi
}

# If specific months passed as arguments, use them; otherwise query the DB
if [ "$#" -gt 0 ]; then
  for month in "$@"; do
    run_for_month "$month"
  done
else
  echo "No months specified. Querying database for all upload_months..."
  months=$(psql "$DATABASE_URL" -t -A -c \
    "SELECT DISTINCT upload_month FROM rent_roll_data ORDER BY upload_month;" \
    2>/dev/null) || {
      echo "ERROR: Could not query database. Set DATABASE_URL or pass month args." >&2
      exit 1
    }

  if [ -z "$months" ]; then
    echo "No upload_months found in rent_roll_data." >&2
    exit 1
  fi

  for month in $months; do
    run_for_month "$month"
  done
fi

echo ""
echo "=== All recalculation requests submitted ==="
echo "Monitor server logs for progress and completion."
