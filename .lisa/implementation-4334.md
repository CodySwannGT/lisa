# Version initializer correction

Work-Item: CodySwannGT/lisa#4334

The owning Rails template now has one blank line after its Ruby magic comment. Every other template byte is unchanged, including the ownership warning and `APP_VERSION = Rails.root.join('VERSION').read.strip.freeze`. All agents consume this shared Rails asset, so no equivalent agent or stack template needs a separate correction.

The new regression in `tests/integration/rails-version-initializer.test.ts` supplies the actual repository template to `CopyOverwriteStrategy.apply`, inspects the emitted first two lines and both ownership sentences, then applies again and requires a skipped, byte-identical result. It failed before the template correction, while the unchanged copy-overwrite suite passed all 13 tests. After correction, the owning-template, strategy and emission suites passed all 26 tests. The formatted final regression also passed with a verbose reporter naming its executed scenario.

## Actual CLI evidence

A private driver used the already-built local CLI and the public scratch supervisor to apply Lisa to a disposable synthetic Rails consumer. It inherited supervisor TMPDIR and isolated child HOME, USERPROFILE and XDG_CONFIG_HOME. Both initial apply commands and the corrected repeat exited 0. No other checkout was used.

Actual RuboCop 1.91.0 inspected the emitted initializer with `--only Layout/EmptyLineAfterMagicComment`, cache disabled and a private configuration matching the shipped enabled rule and its one-line requirement. The baseline had one offense at line 2 and exited 1. Corrected output had zero offenses and exited 0. The corrected repeat was byte-identical with exactly one ownership annotation. A Ruby subprocess evaluated the emitted initializer with a synthetic whitespace-padded VERSION and returned `{"value":"7.8.9","frozen":true}`, exit 0.

This is real CLI emission and standalone exact-rule RuboCop evidence. It does not claim consumer bundle lint, Rails application boot, release adoption or CI execution. Ancillary marketplace/plugin registration warnings appeared during synthetic full apply. They did not prevent initializer emission, and their logs are retained. An initial proof invocation without `LISA_BOOTSTRAP=1` correctly skipped in the non-interactive environment and produced no file. The documented environment was supplied before baseline proof and before changing the template.

Private evidence root: `/private/tmp/lisa-4334-prerequisites/proof`. Complete apply/RuboCop/version stdout, stderr and command records are under `baseline/` and `corrected/`. The runner logs are `regression-red.log`, `regression-green.log` and `regression-green-named.log`. `emission-driver.mjs` records commands, observation time and individual log digests. Each phase retains its source bytes, emitted bytes, lint config and `summary.json`.

Baseline observed: `2026-10-03T23:51:22.342Z`. Corrected CLI/repeat/version observed: `2026-10-03T23:51:52.431Z`.

| Source | SHA256 |
| --- | --- |
| Baseline template and emitted file | `703bdfcceb031f38d19ddebe7ae3d432051f0d444ab7467b406ddd8e451ec9c7` |
| Corrected template and emitted file | `9304268500aada31d8bd158dca4274888d10db4e30f8dadd9bf23a01d67f2480` |
| Formatted regression | `c5fbb8a57db8cc055113f320658e1549f4a06d587da4909b5e9ba9531a5b6fd1` |
| Unchanged copy-overwrite implementation | `61fe72ff0354d8aa428689691fc871920d171988a0016607ed123a73414abab9` |
| Built CLI entry point | `10c4c29ef3e49fc3769d367f4c086e349700001dfe031262deda113677cbf865` |
| Private proof driver | `d703509b82d0c6ce2a41a9f42361b4687f4a3d83fe4a41483ada516cc6284008` |

## Boundary and remaining work

The full ignored provider context and six comments were consumed. Historical prioritization is superseded by automation's honest record of direct session authorization. Original bodies/comments and trusted-human configuration remain unchanged. The related adoption work, coordination history and separate active hook lane remain outside this patch.

This worker changed only the template, emission regression and this report. Dependencies, release/version workflows, ownership machinery, guard configuration and learnings were untouched. Nothing was staged or committed. The parent owns independent verification, required local gates, scoped staging followed by both derived-artifact regenerations, and subsequent authorized delivery. Verification stays in progress until the parent completes the normal shipping and release obligations.

MLD candidates: `[{"kind":"learning","note":"Built Lisa CLI apply requires documented LISA_BOOTSTRAP=1 for a non-interactive synthetic emission proof, otherwise it exits successfully after skipping.","evidence":"private proof baseline and corrected apply command records"}]`.
