# Approved repository-local braces audit exception

Work item: CodySwannGT/lisa#4326.

The operator approved the proposed exception in the current conversation on 2026-10-03 with the exact message “approve the exception”. This is conversation authorization, not a fabricated GitHub human comment. The approved proposal has SHA256 a7bd5588e0d1edec667ef9331267ba9c4c74c142097111c2e3c5a911578b8d12.

The single root audit.ignore.local.json entry covers GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 in braces. The exception is specific to this repository. Shared audit templates, package versions, lockfiles, audit thresholds and hook behavior are unchanged. The current hook matches advisory IDs; it does not enforce package/path restrictions or evaluate expiry fields.

## Impact and accepted risk

The installed braces 3.0.3 recursive expander can exhaust the stack. Actual Knip entry configuration reaches fast-glob → micromatch.braces → braces.expand in the required validation lane. A contributor can supply a malicious JSON glob pattern, so the advisory is not classified as an unaffected dependency, a false positive or a dev-only finding. The accepted risk is validation-process availability for reviewed checkouts. No service exposure or privilege escalation was established.

Under official Node 22.23.3, the installed root Knip CLI passed a disposable fixture using {index,extra}.js and failed a 7014-character entry pattern containing3500 nested braces with RangeError at braces/lib/expand.js:98/103. The initial package-main experiment failed earlier with ENAMETOOLONG and is retained separately, not counted as braces proof.

The [primary advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) lists all versions through 3.0.3 as affected and no patched version. A fresh official registry/advisory read on 2026-10-03 still returned latest 3.0.3 and first_patched_version:null. Therefore a compatible fixed-leaf upgrade or override is unavailable. Changing a parent major would not remove all vulnerable production routes.

The configured owner is CodySwannGT and the manual review date is 2026-10-16T23:59:59Z. Recheck the advisory and registry and remove the exception when a compatible fix becomes available. The review date is not automatic expiry. Re-evaluate earlier if glob data is accepted from an untrusted service or the dependency/caller graph changes.

## Historical evidence and current limits

The attached security-audit-observation.json records actual477b0767479e6fe1756ac617d0a052b53ff7f74e observations. That head passed all 14 declared normal push checks:1360 unit files/25666 passed/2 existing skipped,172 push integration files/3178 passed/2 existing skipped, and coverage 82.88% statements/75.85% branches/88.52% functions/83.86% lines. The push then exited 1 on the unexcluded braces advisory. The push integration scope retains its existing exclusions and is not the full unfiltered integration suite.

The attached security-audit-production.json preserves the raw production report, including inherited advisories already handled by managed exclusions. Raw findings remain visible; a filtered pass must never be described as zero raw vulnerabilities or patched braces.

All earlier evidence/4326 files and their inventory remain bound to their original recorded source heads. This approval supplement has its own security-audit-inventory.json. A subsequent exception commit needs fresh applicable validation and exact-commit runtime proof. Historical477/b339 observations do not establish CI, merge, publication or runtime for that subsequent head. Shipping and terminal issue closure remain pending.
