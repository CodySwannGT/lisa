#!/usr/bin/env bash
# Fixture: the conformance check the confidence-rebuild kit's "Conformance
# fixtures" evidence type promises. It runs the in-house slug builder over the
# real corpus. It names no dependency version, because the dependency is gone —
# the rollback pin lives in the decision record, which is a ledger and not a
# governed policy surface.
set -euo pipefail

node ./scripts/slug-conformance.mjs --corpus ./fixtures/published-titles.json
