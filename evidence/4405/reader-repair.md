# Bounded canonical GitHub reads — #4405

Large checkpoint histories can overflow the unchanged 1 MiB native capture before canonical validation. A second complete REST backlink read can independently exceed both that capture and the 3 MiB broker response limit. Increasing limits would defer the failure.

The repair uses two closed conservative GH projections. The issue read retains every original field and every native closing reference, while retaining complete comment objects containing the managed backlink marker. The paginated read emits one envelope per native page, containing its unfiltered source count and complete marker-bearing candidate objects. Native pagination still follows provider pagination links. The writer and broker use the same completed JSONL decoder before response-derived writer authorization. The original ownership parser, sibling/first-target rules, count maxima, capture/deadline bounds and claim/signature/publication controls remain in force.

## Evidence recorded before delivery

- `test-run-log: large-history-red`: the new reaching regression on the original sources produced 5 failures and 2 passes. Both original native reads overflowed with ENOBUFS/SIGKILL. An independent real-provider control also failed both oversized reads at the original 1 MiB capture. Setup refusals and fixture-loader failures are excluded from RED evidence.
- `test-run-log: large-history-green`: the corrected regression passed 8/8. The same independent real-provider reads succeeded within 1 MiB/30 seconds: the issue response was 11,445 bytes and complete two-page backlink envelopes were 67 bytes with unfiltered counts [100, 33]. Full issue field/reference equality and complete candidate equality were checked against independently retained native responses. A separate real-provider positive retained both genuine managed backlinks, their IDs, full bodies, order and metadata; projected pages were 3,425 bytes.
- `test-run-log: canonical-authority-negatives`: nine impacted ordinary suites passed 359/359, including original validate-pr acceptance with native closing references and no managed comments. New tests reject changed selectors/repositories/tickets/phases, malformed/failed/incomplete native results and oversized relevant responses before write grants. Independent security review passed 19 hostile controls and found no new source vulnerability. Independent quality review found no correctness defect. Targeted ESLint, the existing test typecheck gate and git diff --check passed. The unchanged test typecheck backlog remains 361 quarantined files / 1,535 errors.
- `state-dump: released-reader-repair`: PENDING. Source review, local tests and native read-only qualification do not establish a published release or hosted updater publication. Exact-head CI execution, ordinary merge and released source/archive identity must still be recorded before this marker is accepted.

Native read-only receipt: [native-reader-green.json](native-reader-green.json). It contains only sanitized counts, source hashes and equivalence outcomes. Raw issue/comment bodies and the local native qualifier are retained in ignored private diagnostics and are not published.

## Source identity reviewed

- `all/copy-overwrite/scripts/lisa-work-item.mjs`: cd1b16e056fefac17018d5c96ad063dc4002f304e4400765e473403186b7175a
- `all/copy-overwrite/scripts/lib/npm-update-gh-grants.mjs`: 62f81b0d6c669594356c8ad63f544d679407100f3fc46723985f286e4d033e50

All qualification receipts were captured against unchanged source bytes. Hermetic fixtures establish code-unit behavior. Genuine native GH reads establish reader acquisition and parser equivalence only. Neither claims hosted publisher authority, a human approval, old-cohort recovery or deployment.
