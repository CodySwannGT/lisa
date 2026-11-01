# Review convergence for #4521

Independent product, code/security and quality reviews ran concurrently after
the prepared build and generation finished. They reviewed staged tree
`ed5c2cdf208574758e7ab66b916f80f68be2f3d2`, without source changes or builds.
The candidate was not approved for delivery. Review reports and controlled
probe outputs are preserved privately.

| Finding | Scenario and evidence | Disposition |
| --- | --- | --- |
| P1 Sonar job boundary | Audit replacement deleted the separate static-security job header, moving its steps into the audit job | Accepted; restore exact baseline header and preserve job/gate semantics |
| P1 Existing CI callers | Reusable CI references an adapter absent before a Lisa apply/package update, so an older caller fails before auditing | Accepted; use an immutable workflow-owned action with isolated pinned dependencies and an ephemeral bundle of the same canonical source; no second matcher |
| P1 Host audit composition | Template force of security:audit replaces existing project security checks | Accepted; force the governed security:audit:lisa task and default the project composition alias, with actual apply preservation coverage |
| P2 Scalar CVE | An old accepted single-cve report stops matching a legacy CVE exception | Accepted; normalize scalar cve alongside cves, with a no-lockfile legacy regression |
| P1 Incomplete Yarn report | A positive high/critical summary without advisory material produces a false pass | Accepted; validate summary shape/counts and reject positive summaries without concrete findings, retaining a real clean-shape control |
| P1 Missing severity material | An excluded HIGH advisory masks a positive CRITICAL summary with no critical details, or the converse | Fixed; retain normalized severity and require concrete material for each positive governed severity, without equating occurrence counts with advisory counts |

The independent quality reviewer also replayed the exact preserved doctor
input three times: GREEN with unchanged input SHA256
`b7beb5311d8e80d3d2e7289423e97b863f603ffcc95e0df40b1b24046bc1a49e`.
This proves the bounded doctor validation only, not full consumer, hosted or
released behavior.

The implementation specialist owns the action and host-composition fix; root
owns the report-normalizer regressions, exact Sonar boundary restoration,
immutable source pin, convergence, generation, and full normal gates. These
tasks inherit the full metadata/context/access contract in plan-4521.md.
The new action is a delivery adapter over the existing canonical implementation,
and its outputs must be reviewed and empirically qualified before use.

All six findings are fixed in the candidate. The workflow references source
commit `9eda9c429ca5fa2acc67539c5867f02c37d3474e`; a regression compares every
canonical matcher module and all four action runtime/dependency files with
the immutable commit's actual bytes. An older caller fixture has neither
the adapter nor installed audit export, and the action runs independently.
The former caller-tree staleness classification is removed with that coupling.

The combined focused normal wrapper passed all 14 files: 269 tests passed,
2 pre-existing manager-specific skips. No skipped case receives proof credit.
The isolated action's genuine frozen npm installation matched all five exact
pins. Actual live Bun queries against the preserved alias lock passed when
the alias was covered and failed naming the alias when uncovered. Controlled
consumer fixtures remain separately labeled.

Product re-review found no further blocker in the action/wiring. Code and
quality review confirmed the prior fixes and identified the severity-material
case above, now covered symmetrically. Status: final bounded review of that
fix and full normal gates remain. No hosted or delivery pass claimed.

The first full normal push at head 83c81e6a ran 30,115 unit tests with verdicts:
30,109 passed and 6 failed (plus 5 existing skips). Coverage was unproved and
integration was not run after that failure. The branch was not pushed.
The full log is preserved privately; no #4581 failure was observed in that run.

The ensuing repairs preserve the existing contracts:

- Stamp the new managed adapter's ownership header in its template and root copy.
- Register that exact shipped script in the host-format exclusion list; no host
  script glob is added, and upstream source formatting remains checked.
- Retire dependency-vulnerability's obsolete unshipped-task exception. An explicit
  fallbackWhenTaskMissing marker preserves the existing unconditional facade for
  older callers; explicit tasks, supplied defaults and unsupported moments keep
  their existing behavior, covered by controls.
- Execute the real audit adapter in the Git-environment fixture and record only
  actual work-item validation calls, retaining the foreign-repository assertions.
- Resolve the migration fixture's release pin with the genuine GitHub tag:
  v4.87.2 exists at fb6048f26c8b483de05edb23c5ceaaf1b1116edd and was fetched
  normally. No migration test, release identity, or resolver was weakened.

Focused validation of all prior cases plus all failed suites passed 19 files:
397 tests passed, 2 pre-existing skips. This is not a full-floor pass.
