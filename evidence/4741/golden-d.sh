#!/bin/bash
# (d) Run the original 55e249b17e root-identity golden file against HEAD code, then a 1-hex mutation of it.
WT="$1"; cd "$WT" || exit 1
T=tests/unit/scripts/zz-v4741-orig-golden.test.ts
trap 'rm -f "$WT/$T"' EXIT
cp /tmp/v4741-verify/orig-golden.test.ts "$T"
run() { PATH="$WT/node_modules/.bin:$PATH" LISA_FLEET_ADMISSION=off node dist/cli/lisa-test-run.js --profile lisa --adapter vitest -- vitest run "$T" 2>&1; }
echo "HEAD under test: $(git rev-parse HEAD)"
echo "== diff of tests/unit/scripts/npm-update-root-identity.test.ts since 55e249b17e"
git diff --stat 55e249b17e HEAD -- tests/unit/scripts/npm-update-root-identity.test.ts
echo "removed (-) lines: $(git diff 55e249b17e HEAD -- tests/unit/scripts/npm-update-root-identity.test.ts | grep -cE '^-[^-]')"
echo "== original 55e249b17e golden file run against HEAD code"
run | grep -E "Test Files|Tests |FAIL"
echo "== bite control: mutate one hex char of the first pinned digest (d586a08e -> e586a08e)"
sed -i '' 's/"d586a08edccca8e1/"e586a08edccca8e1/' "$T"
echo "mutated occurrences: $(grep -c e586a08edccca8e1 "$T")"
run | grep -E "Test Files|Tests |FAIL|e586a08e" | head -8
