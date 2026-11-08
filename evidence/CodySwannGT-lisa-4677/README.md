# Evidence: CodySwannGT/lisa#4677

These files were captured at three different commits. Read each against the commit it was captured at.

| File | Captured at | Status |
| --- | --- | --- |
| `cli-fixtures-final.txt` | final route helper (claim and session-manager notes ignored) | **Current.** CLI output for all 12 fixtures |
| `f16e99-cli-fixtures-probes-live.txt`, `test-f16e99.log`, `check-plugins-f16e99.log` | `f16e99bd5d` | Independent re-verification: **PASS** |
| `cli-fixtures.txt`, `head-clean-cli-and-probes.txt`, `test-head-clean.log`, `test-ci-rework-route.log`, `check-plugins-head.log`, `parity-grep-head.txt`, `falsification.txt`, `cli-live-4677.txt`, `cli-live-sweep.txt`, `live-4598-crosscheck.txt` | `99ab5bafef` | **Historical.** The first verification run, which FAILED because a claim comment posted after the failure marker hid it. Its `not-newest` detail text comes from before that fix. |
