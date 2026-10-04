# Tooling donor handoff

Work item: CodySwannGT/lisa#4333. Target: main / production. Local donor ancestry starts at `995f533b00d9b8a60256096bf6d28940164cd893`; the parent coordinator owns integration and delivery.

| Logical source donor | SHA |
| --- | --- |
| Coupled Rails/npm refresh and manifest | `096032a7ec688c60c9f01c3e4b357f97ca48dd05` |
| Optional registration lifecycle and manifest | `f1acee3348444932c03e37ef7bc6691bdebfb379` |
| Ordinary CDK fixture budget and reason assertions | `7b4a50cda73ad6fdcd99da522ce89ff778dfb7af` |

All three commits passed normal hooks. A report-only donor follows them. Reviewed product bytes and the final generated manifest still match the 30-file digest `f5475d311ed63389507d184de2909aa266c5e64c7c2fcbf5b7316f2568f81cdf` after normal formatter and index-boundary regeneration. No reviewed product byte changed at commit time.

## Repaired ordinary gates

The CDK fixture wrongly gave ordinary synthesis the deliberate timeout arm's 500 ms budget. Fresh RED reproduced one failure/11 passes. Ordinary pass/fail cases now inherit the existing 10-second CDK factory budget; timeout remains 500 ms and signal arms remain live. GREEN passes 12/12, including intended failure reasons, owned cleanup and live-sibling preservation. No global deadline or coverage floor changed.

Optional registration previously had unbounded shell commands and recorded a success marker after failed installs. Current source uses real fixed CLI argv, closed input, bounded streams, a 15-second probe, a new 120-second aggregate cap using existing normal waiting precedents, and owned POSIX group cleanup. Disabled plugins are excluded and incomplete registration leaves retry state. Ordinary RED proved absent budgets and the false marker; current registration/selection/marker tests pass 15/15. Windows retains direct-child termination only.

Independent current-byte source review reports findings `[]`, MLD `[]`. Focused tooling/privacy tests pass 108/108. Scoped lint and slow lint, typechecks, formatter, build and artifact checks pass. This is focused local evidence; historical broad suite failures remain preserved.

## Independent terminal proof

Fresh installed immutable-package full applies pass for Rails (44.444 seconds) and TypeScript/CDK (38.166 seconds). Each has a real apply receipt, version marker and actual vendor CLI readback covering every enabled project plugin. All 7,551 package members match the installed consumers. Ordinary installed API checks pass 7/7.

The unchanged focused packed-host gate passes two journeys. TypeScript/CDK bootstraps complete in 39.890/46.100 seconds under the unchanged 60-second base. Native tests, two adoptions, frozen-install equality and repeated offline CDK synthesis pass. The raw manual tar is `ca9a57a49089df79e10405d885951899ecf4e6400b986f333e09c428e2cabc7f`; the separate locally stamped gate tar is `039fb8b6e59c68a353b8b641e9614f6b4e9c66ad890b04dd8ac8fe3333bdddaf`. Both are local proof, not published artifacts.

Owned empirical processes and registries are terminal, no owned registration CLI remains, and fixture scratch was removed normally. Fresh isolated target/cache bytes remain for read-only review. Exact source, target and raw-log inventories are private; the public verification report maps each authored criterion to observations.

## Preserved limits

Full/production audits exit 1/1 upstream and 1/0 in the emitted consumer. Physical inventories retain four GHSAs after 27 of 31 baseline repairs; the additional deepmerge finding is repaired. Production metadata does not prove a clean physical tree. No ignore, suppression, vendor-byte patch or obsolete Lisa downgrade was used.

Historical joint Ruby tooling proof is reused only against identical seed/harness hashes, including unchanged 80/70 coverage floors. Stock duplicate Gemfile declarations required explicit reconciliation; this does not prove zero-edit stock readiness. The historical 600-second failures, setup refusals and overwritten-log limitation remain documented rather than relabelled as successes.

CI, release delivery, downstream adoption and six independent agent journeys remain unproved. Complete-flow usage/cost is unknown; the private accounting uses one cumulative native snapshot. Binding and the original hold/history remain intact; current direct session repair authority is recorded honestly, without a fabricated human release.

Automatic approval review rejected adversarial npm security/resource-exhaustion controls with “This content was flagged for possible cybersecurity risk.” Those controls remain UNVERIFIED with no acceptance credit and were not retried, recast or routed elsewhere. Complete originals and precise rejection receipts remain in ignored private context.
