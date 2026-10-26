#!/bin/sh
# runs every test; needs node and playwright (see tests/README.md). PORT picks the smoke test port (default 8130)
cd "$(dirname "$0")" || exit 1
rc=0
for t in static-check.js unit.js smoke.js; do
  echo "=== $t"
  node "$t" || rc=1
done
[ $rc = 0 ] && echo "ALL TESTS PASSED" || echo "SOME TESTS FAILED"
exit $rc
