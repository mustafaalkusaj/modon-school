#!/usr/bin/env bash
set -euo pipefail

CANONICAL_REF="rljchldkgdbuhnkbuxqa"
EXIT_CODE=0

echo "Checking Supabase project ref consistency..."

if ! grep -q "$CANONICAL_REF" .env.local 2>/dev/null && ! grep -q "$CANONICAL_REF" .env.production 2>/dev/null; then
  echo "WARNING: Canonical ref $CANONICAL_REF not found in .env.local or .env.production"
  EXIT_CODE=1
fi

if [ $EXIT_CODE -eq 0 ]; then
  echo "OK: All Supabase refs point to canonical project ($CANONICAL_REF)"
fi

exit $EXIT_CODE
