#!/usr/bin/env bash
# Fails if database code builds dynamic SQL from anything a caller can send.
# Dynamic SQL (EXECUTE) is only allowed with values the server makes itself
# (dates, counters, system catalog names). Function parameters (p_*), the order
# payload and the cart arrays must never reach EXECUTE.
set -euo pipefail
cd "$(dirname "$0")/.."
if grep -nE "EXECUTE[^;]*\b(p_[a-z_]+|payload|deductions|addon_deductions)\b" supabase/migrations/*.sql; then
  echo "FAIL: dynamic SQL uses a caller-supplied value (see lines above). Use a normal query with parameters instead." >&2
  exit 1
fi
echo "OK: no dynamic SQL uses caller-supplied values."
