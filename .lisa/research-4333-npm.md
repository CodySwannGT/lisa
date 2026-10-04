# npm advisory research

Work item: CodySwannGT/lisa#4333. Fresh official registry metadata, bulk advisory responses, lock resolution and physical installed inventories replaced the historical advisory count. The baseline union contained 31 distinct GHSAs; an additional deepmerge-ts finding was subsequently identified and repaired.

The responsible same-major refreshes and API compatibility dispositions are recorded in [the complete advisory guide](../docs/npm-advisory-dispositions.md). Existing Node, Bun, action and test pins remain intact. CDK matches its alpha package; API-major families retain compatible separate resolver branches. ESLint 9 is explicitly EOL, retained with patched children and observed config compatibility rather than described as vendor-maintained. Aging transform/release tools have migration guidance and ordinary API observations.

27 of the original 31 advisories were repaired. Four remain: GHSA-vfj7-8cjw-p6xm (braces, no published fix), and GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p, GHSA-q2hr-2g5m-vwhr in CDK's physically bundled brace-expansion. No vendor bytes were edited, no advisory ignored or suppressed, and Lisa was not downgraded. Production metadata cannot establish a clean physical tree.

The original adversarial npm security/resource-exhaustion controls were rejected by automatic approval review with “This content was flagged for possible cybersecurity risk.” They remain UNVERIFIED with no acceptance credit and must not be retried or recast. Separate ordinary API successes and genuine audits do not discharge those controls. Full original responses, inventory rows and rejection receipts remain in ignored private context.
