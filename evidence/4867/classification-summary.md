# Classification of Markdown phrase assertions (CodySwannGT/lisa#4867)

Produced by `scripts/classify-phrase-tests.mjs`. The class rules and the parser
behind every token class are in `scripts/lib/phrase-tests/token-classes.mjs`.

| Class | Meaning |
|---|---|
| MACHINE-TOKEN | The whole phrase is a marker whose exact spelling shipped code reads. The parser is named per entry. |
| STRUCTURAL | Frontmatter shape: the `---` delimiter, or a key (`name`, `description`, `argument-hint`, `allowed-tools`, `skills`, `model`, `tools`) whose value is an identifier rather than prose. |
| WORDING | Anything else. A sentence that only mentions a token is WORDING, and so is a marker that no shipped code parses. |
| NOT-MARKDOWN | (Manifest only.) The pinned file is a workflow, hook or script, not a Markdown document. These guard source text, are outside this cull, and moved to `tests/phrase-manifest/source-text-guards.json`. |
| UNRESOLVED | (Test assertions only.) The asserted phrase is computed, not a literal, so it needs a person to read it. |

## Required-phrases manifest

Files: `classification-manifest-before.json`, `classification-manifest-after.json`.

| | Files | Entries | MACHINE-TOKEN | STRUCTURAL | WORDING | NOT-MARKDOWN |
|---|---:|---:|---:|---:|---:|---:|
| `required-phrases.json` before | 376 | 5,391 | 54 | 0 | 5,135 | 202 |
| `required-phrases.json` after | 50 | 54 | 54 | 0 | **0** | **0** |
| `source-text-guards.json` (new) | 23 | 202 | 0 | 0 | 0 | 202 |

Every remaining `required-phrases.json` entry is MACHINE-TOKEN or STRUCTURAL.
The 5,135 WORDING entries are deleted; the 202 non-Markdown source-text
guards (for example `plugins-sync.yml`'s "no `paths:` filter" guard and
`exit 2` in hooks) are kept, in their own file.

MACHINE-TOKEN entries by rule: `[lisa-pr-link]` 36 (parser
`all/copy-overwrite/scripts/lisa-work-item.mjs`), `## Lisa Usage` 14
(`all/copy-overwrite/scripts/lib/usage-ledger.mjs`), `[EVIDENCE: …]` 4
(`plugins/src/base/skills/lisa-jira-journey/scripts/parse-plan.py`).

The manifest held no frontmatter assertions, so STRUCTURAL is 0 there.
`tests/unit/docs/required-phrases.test.ts` checks both files. It fails if a
`required-phrases.json` entry is anything but MACHINE-TOKEN or STRUCTURAL, or
if a `source-text-guards.json` entry pins a Markdown file.

## Phrase assertions in test files

File: `classification-assertions-before.json` (before any test file is culled).

241 test files read a Markdown document. They hold 5,885 phrase assertions:
4,341 on Markdown text, 1,510 on other text (script output, workflow YAML) and
34 whose text comes from imported code and could not be traced. Only the 4,341
are Markdown assertions:

| MACHINE-TOKEN | STRUCTURAL | WORDING | UNRESOLVED |
|---:|---:|---:|---:|
| 14 | 35 | 4,094 | 198 |

164 files make assertions on Markdown text; 160 of them hold at least one
WORDING assertion, and 44 hold nothing else.

## After the test-file cull

File: `classification-assertions-after.json`.

| | Test files reading Markdown | Phrase assertion sites | On Markdown text | MACHINE-TOKEN | STRUCTURAL | WORDING | UNRESOLVED |
|---|---:|---:|---:|---:|---:|---:|---:|
| Before | 241 | 5,885 | 4,341 | 14 | 35 | 4,094 | 198 |
| After | 148 | 1,536 | 217 | 16 | 36 | 120 | 45 |

### Residual WORDING and UNRESOLVED Markdown sites

The cull kept each of the 165 sites below on purpose; the keep reason
names the contract the assertion still guards, and reasons for the sites the
cull did not explain come from the review. 66 sites are not document
assertions at all — the classifier's taint analysis attributed generator,
installer or fixture output to a document — and 21 check
frontmatter forms the STRUCTURAL rules do not match. **0 sites
remain `unreviewed`.**

| Site | Class | Value | Keep reason |
|---|---|---|---|
| `integration/lisa.test.ts:1237` | WORDING | `Rails governance rules` | only proof the Rails template overrode base |
| `unit/cli/doctor.test.ts:257` | WORDING | `@AGENTS.md` | `@AGENTS.md` CLAUDE.md import line |
| `unit/cli/doctor.test.ts:258` | WORDING | `AGENTS.md` | subject is generated/fixture output, not a shipped doc |
| `unit/cli/doctor.test.ts:278` | WORDING | `LISA_RULES_START` | subject is generated/fixture output, not a shipped doc |
| `unit/cli/doctor.test.ts:279` | WORDING | `Host note.` | subject is generated/fixture output, not a shipped doc |
| `unit/codex/command-plugin-artifacts.test.ts:84` | UNRESOLVED | `body` | subject is generated/fixture output, not a shipped doc |
| `unit/codex/command-plugin-artifacts.test.ts:105` | UNRESOLVED | `description` | subject is generated/fixture output, not a shipped doc |
| `unit/codex/command-plugin-artifacts.test.ts:106` | UNRESOLVED | `description` | subject is generated/fixture output, not a shipped doc |
| `unit/codex/command-plugin-artifacts.test.ts:107` | UNRESOLVED | `body` | subject is generated/fixture output, not a shipped doc |
| `unit/codex/hooks-installer-rules-mirror.test.ts:113` | WORDING | `load-bearing` | subject is generated/fixture output, not a shipped doc |
| `unit/codex/hooks-installer-rules-mirror.test.ts:118` | WORDING | `full reference` | subject is generated/fixture output, not a shipped doc |
| `unit/core/host-rules-parity.test.ts:116` | UNRESOLVED | `LISA_HOST_RULES_START_MARKER` | subject is generated/fixture output, not a shipped doc |
| `unit/core/host-rules-parity.test.ts:117` | UNRESOLVED | `HOST_RULES_DIR` | subject is generated/fixture output, not a shipped doc |
| `unit/core/host-rules-parity.test.ts:136` | WORDING | `/read every file under/iu` | subject is generated/fixture output, not a shipped doc |
| `unit/core/host-rules-parity.test.ts:173` | WORDING | `@AGENTS.md` | `@AGENTS.md` CLAUDE.md import line |
| `unit/core/host-rules-parity.test.ts:222` | UNRESOLVED | `HOST_RULES_DIR` | subject is generated/fixture output, not a shipped doc |
| `unit/core/host-rules-parity.test.ts:225` | WORDING | `<!-- LISA_RULES_START -->` | subject is generated/fixture output, not a shipped doc |
| `unit/core/host-rules-pointer.test.ts:154` | WORDING | `We deploy on Fridays. Deal with it.` | subject is generated/fixture output, not a shipped doc |
| `unit/core/host-rules-pointer.test.ts:155` | UNRESOLVED | `LISA_HOST_RULES_START_MARKER` | subject is generated/fixture output, not a shipped doc |
| `unit/core/host-rules-pointer.test.ts:156` | UNRESOLVED | `HOST_RULES_DIR` | subject is generated/fixture output, not a shipped doc |
| `unit/core/host-rules-pointer.test.ts:174` | UNRESOLVED | `LISA_HOST_RULES_START_MARKER` | subject is generated/fixture output, not a shipped doc |
| `unit/core/host-rules-pointer.test.ts:190` | UNRESOLVED | `HOST_RULES_DIR` | subject is generated/fixture output, not a shipped doc |
| `unit/core/host-rules-pointer.test.ts:191` | WORDING | `Read the rules in .claude/rules/ instead.` | subject is generated/fixture output, not a shipped doc |
| `unit/core/host-rules-pointer.test.ts:193` | WORDING | `We deploy on Fridays. Deal with it.` | subject is generated/fixture output, not a shipped doc |
| `unit/core/host-rules-pointer.test.ts:219` | UNRESOLVED | `LEGACY_PROJECT_RULES_FILE` | subject is generated/fixture output, not a shipped doc |
| `unit/core/host-rules-pointer.test.ts:231` | UNRESOLVED | `custom` | subject is generated/fixture output, not a shipped doc |
| `unit/core/host-rules-pointer.test.ts:241` | UNRESOLVED | `HOST_RULES_DIR` | subject is generated/fixture output, not a shipped doc |
| `unit/core/host-rules-pointer.test.ts:242` | UNRESOLVED | `LEGACY_PROJECT_RULES_FILE` | subject is generated/fixture output, not a shipped doc |
| `unit/core/instruction-files-migration.test.ts:55` | UNRESOLVED | `CLAUDE_MD_AGENTS_IMPORT` | `@AGENTS.md` CLAUDE.md import line |
| `unit/core/instruction-files-migration.test.ts:65` | UNRESOLVED | `CLAUDE_MD_AGENTS_IMPORT` | `@AGENTS.md` CLAUDE.md import line |
| `unit/core/instruction-files-migration.test.ts:66` | WORDING | `Use tabs, not spaces.` | subject is generated/fixture output, not a shipped doc |
| `unit/core/instruction-files-migration.test.ts:90` | UNRESOLVED | `LISA_RULES_START_MARKER` | subject is generated/fixture output, not a shipped doc |
| `unit/core/instruction-files-migration.test.ts:91` | WORDING | `Lots of baked rule text.` | subject is generated/fixture output, not a shipped doc |
| `unit/core/instruction-files-migration.test.ts:92` | WORDING | `Host note above.` | subject is generated/fixture output, not a shipped doc |
| `unit/core/instruction-files-migration.test.ts:114` | UNRESOLVED | `CLAUDE_MD_AGENTS_IMPORT` | `@AGENTS.md` CLAUDE.md import line |
| `unit/core/instruction-files-migration.test.ts:115` | WORDING | `Notes.` | subject is generated/fixture output, not a shipped doc |
| `unit/core/instruction-files-migration.test.ts:138` | UNRESOLVED | `LISA_PROJECT_LEARNINGS_START_MARKER` | subject is generated/fixture output, not a shipped doc |
| `unit/core/instruction-files-migration.test.ts:139` | WORDING | `Resolved path for this project: `.lisa/PROJECT_LEARNINGS....` | subject is generated/fixture output, not a shipped doc |
| `unit/core/instruction-files-migration.test.ts:140` | UNRESOLVED | `LISA_RULES_START_MARKER` | subject is generated/fixture output, not a shipped doc |
| `unit/core/instruction-files-migration.test.ts:158` | WORDING | `Resolved path for this project: `docs/LEARNINGS.md`.` | subject is generated/fixture output, not a shipped doc |
| `unit/core/instruction-files-migration.test.ts:159` | WORDING | `Resolved path for this project: `.lisa/PROJECT_LEARNINGS....` | subject is generated/fixture output, not a shipped doc |
| `unit/core/instruction-files-migration.test.ts:176` | UNRESOLVED | `LISA_PROJECT_LEARNINGS_START_MARKER` | subject is generated/fixture output, not a shipped doc |
| `unit/core/instruction-files-migration.test.ts:177` | WORDING | `Host` | subject is generated/fixture output, not a shipped doc |
| `unit/core/instruction-files-migration.test.ts:178` | WORDING | `After` | subject is generated/fixture output, not a shipped doc |
| `unit/core/instruction-files-migration.test.ts:205` | WORDING | `Full eager rule body` | subject is generated/fixture output, not a shipped doc |
| `unit/core/instruction-files-migration.test.ts:206` | UNRESOLVED | `LISA_PROJECT_LEARNINGS_START_MARKER` | subject is generated/fixture output, not a shipped doc |
| `unit/core/instruction-files-migration.test.ts:207` | WORDING | `Host before.` | subject is generated/fixture output, not a shipped doc |
| `unit/core/instruction-files-migration.test.ts:208` | WORDING | `Host after.` | subject is generated/fixture output, not a shipped doc |
| `unit/docs/onboarding-walkthrough.test.ts:34` | UNRESOLVED | ``environment ${surface}`` | doc-to-code vocabulary parity |
| `unit/docs/onboarding-walkthrough.test.ts:45` | UNRESOLVED | `name` | every materialized surface in SURFACES must be named in the skill |
| `unit/hooks/block-direct-issue-create-container.test.ts:207` | UNRESOLVED | `CONTAINER_DECLARATION` | MACHINE-TOKEN: CONTAINER_DECLARATION is parsed by block-direct-issue-create.sh |
| `unit/hooks/operational-hazards-wiring.test.ts:92` | WORDING | `--declare` | flags operational-hazards.mjs parses; the eager rule is the only delivery on hookless surfaces |
| `unit/hooks/operational-hazards-wiring.test.ts:93` | WORDING | `--lift` | flags operational-hazards.mjs parses; the eager rule is the only delivery on hookless surfaces |
| `unit/hooks/operational-hazards-wiring.test.ts:94` | WORDING | `--list` | flags operational-hazards.mjs parses; the eager rule is the only delivery on hookless surfaces |
| `unit/hooks/operational-hazards-wiring.test.ts:97` | WORDING | `--until` | flags operational-hazards.mjs parses; the eager rule is the only delivery on hookless surfaces |
| `unit/plugins/container-view-pattern-parity.test.ts:177` | UNRESOLVED | ``.claude/skills/${SKILL_DIR}/scripts/`` | STRUCTURAL: script paths must resolve through CLAUDE_PLUGIN_ROOT |
| `unit/plugins/container-view-pattern-parity.test.ts:178` | WORDING | `CLAUDE_PLUGIN_ROOT` | STRUCTURAL: script paths must resolve through CLAUDE_PLUGIN_ROOT |
| `unit/scripts/cross-pollinate.test.ts:122` | WORDING | `description: "Style Guide"` | subject is generated/fixture output, not a shipped doc |
| `unit/scripts/cross-pollinate.test.ts:123` | WORDING | `alwaysApply: true` | subject is generated/fixture output, not a shipped doc |
| `unit/scripts/cross-pollinate.test.ts:125` | WORDING | `(api.mdc)` | subject is generated/fixture output, not a shipped doc |
| `unit/scripts/cross-pollinate.test.ts:137` | WORDING | `alwaysApply` | subject is generated/fixture output, not a shipped doc |
| `unit/scripts/cross-pollinate.test.ts:138` | WORDING | `# X` | subject is generated/fixture output, not a shipped doc |
| `unit/scripts/cross-pollinate.test.ts:139` | WORDING | `(y.md)` | subject is generated/fixture output, not a shipped doc |
| `unit/scripts/generate-copilot-plugin-artifacts.test.ts:104` | WORDING | `#scope` | subject is generated/fixture output, not a shipped doc |
| `unit/scripts/generate-copilot-plugin-artifacts.test.ts:105` | WORDING | ``.claude/rules/PROJECT_RULES.md`` | subject is generated/fixture output, not a shipped doc |
| `unit/scripts/generate-copilot-plugin-artifacts.test.ts:106` | WORDING | ``.claude/rules/unknown.md`` | subject is generated/fixture output, not a shipped doc |
| `unit/scripts/generate-cursor-plugin-artifacts.test.ts:359` | WORDING | `](base-rules-reference.mdc)` | subject is generated/fixture output, not a shipped doc |
| `unit/scripts/generate-cursor-plugin-artifacts.test.ts:361` | WORDING | `[reference/base-rules.md]` | subject is generated/fixture output, not a shipped doc |
| `unit/session-manager/orphan-sweep-review.test.ts:74` | UNRESOLVED | ``\`${FINISH_REFUSED_PREFIX}\``` | MACHINE-TOKEN: FINISH_REFUSED_PREFIX is imported from orphan-sweep.mjs, which parses it |
| `unit/strategies/automation-runbook-contract-rule.test.ts:22` | WORDING | `reference/automation-runbook-contract.md` | rule-index reachability (check-rules-pairing.sh reads the `reference/X.md` link) |
| `unit/strategies/automation-status-scaffold.test.ts:48` | WORDING | `$ARGUMENTS` | `$ARGUMENTS` placeholder (transformer rewrites it) |
| `unit/strategies/automation-status-scaffold.test.ts:55` | WORDING | `/name:\s*lisa-automation-status/` | STRUCTURAL (frontmatter form) |
| `unit/strategies/automations-skills.test.ts:67` | WORDING | `/allowed-tools:.*"Write"/` | STRUCTURAL (frontmatter form) |
| `unit/strategies/automations-skills.test.ts:68` | WORDING | `/allowed-tools:.*"Edit"/` | STRUCTURAL (frontmatter form) |
| `unit/strategies/automations-skills.test.ts:79` | WORDING | `scripts/automation-run-record.mjs` | MACHINE-TOKEN: automation-run-record.mjs parses --outcome/--runbook |
| `unit/strategies/automations-skills.test.ts:81` | UNRESOLVED | `flag` | MACHINE-TOKEN: automation-run-record.mjs parses --outcome/--runbook |
| `unit/strategies/bce-parity-and-consumption.test.ts:174` | UNRESOLVED | `expectation` | v2 verdict field names (enforce-verification-gate.sh) |
| `unit/strategies/bce-parity-and-consumption.test.ts:292` | WORDING | `concepts/bounded-claims-evidence-system.md` | wiki page reachable from wiki/index.md |
| `unit/strategies/bdd-e2e-coverage-rule.test.ts:22` | WORDING | `reference/bdd-e2e-coverage.md` | rule-index reachability (check-rules-pairing.sh reads the `reference/X.md` link) |
| `unit/strategies/claim-archaeology-rule.test.ts:24` | WORDING | `reference/claim-archaeology.md` | rule-index reachability (check-rules-pairing.sh reads the `reference/X.md` link) |
| `unit/strategies/claim-evidence-mapping-contract.test.ts:39` | WORDING | `reference/claim-evidence-mapping.md` | rule-index reachability (check-rules-pairing.sh reads the `reference/X.md` link) |
| `unit/strategies/claim-evidence-mapping-contract.test.ts:46` | UNRESOLVED | `field` | fields read by enforce-verification-gate.sh |
| `unit/strategies/credential-resolver-ladder.test.ts:328` | UNRESOLVED | ``could not resolve ${RULE_ENTRY.credential} through lisa-...` | embedded shell the test executes — ladder function extracted from the doc and run |
| `unit/strategies/credential-resolver-ladder.test.ts:331` | UNRESOLVED | `RULE_PLUGIN_RUNG` | embedded shell the test executes — ladder function extracted from the doc and run |
| `unit/strategies/credential-resolver-ladder.test.ts:332` | UNRESOLVED | `FLOOR_RUNG` | embedded shell the test executes — ladder function extracted from the doc and run |
| `unit/strategies/credential-resolver-ladder.test.ts:374` | UNRESOLVED | `REPO_COPY` | embedded shell the test executes — ladder function extracted from the doc and run |
| `unit/strategies/dependency-internalization-kit-rule-pair.test.ts:20` | WORDING | `reference/dependency-internalization-kit.md` | rule-index reachability (check-rules-pairing.sh reads the `reference/X.md` link) |
| `unit/strategies/dependency-trust-classes-rule-pair.test.ts:19` | WORDING | `reference/dependency-trust-classes.md` | rule-index reachability (check-rules-pairing.sh reads the `reference/X.md` link) |
| `unit/strategies/deployed-state-readback-rule.test.ts:20` | WORDING | `reference/deployed-state-readback.md` | rule-index reachability (check-rules-pairing.sh reads the `reference/X.md` link) |
| `unit/strategies/derived-branch-plan-contract.test.ts:39` | UNRESOLVED | ``reference/${SLUG}.md`` | rule-index reachability (check-rules-pairing.sh reads the `reference/X.md` link) |
| `unit/strategies/design-intake-skill.test.ts:30` | WORDING | `/^---\nname: lisa-design-intake\n/u` | STRUCTURAL (frontmatter form) |
| `unit/strategies/design-intake-skill.test.ts:36` | WORDING | `$ARGUMENTS` | `$ARGUMENTS` placeholder (transformer rewrites it) |
| `unit/strategies/design-intake-skill.test.ts:41` | WORDING | `/@[a-z0-9][a-z0-9-]{2,}\b/iu` | leak guard |
| `unit/strategies/design-intake-skill.test.ts:42` | WORDING | `/assignee\s*[:=]\s*["'][a-z][^"']*["']/iu` | leak guard |
| `unit/strategies/design-source-of-truth-rule.test.ts:30` | WORDING | `reference/design-source-of-truth.md` | rule-index reachability (check-rules-pairing.sh reads the `reference/X.md` link) |
| `unit/strategies/design-value-binding-rule.test.ts:28` | WORDING | `reference/design-value-binding.md` | rule-index reachability (check-rules-pairing.sh reads the `reference/X.md` link) |
| `unit/strategies/design-value-binding-rule.test.ts:36` | WORDING | `/@[a-z0-9][a-z0-9-]{2,}\b/iu` | leak guard |
| `unit/strategies/design-value-binding-rule.test.ts:37` | WORDING | `/assignee\s*[:=]\s*["'][^"']+["']/iu` | leak guard |
| `unit/strategies/doctor-scaffold.test.ts:54` | WORDING | `$ARGUMENTS` | `$ARGUMENTS` placeholder (transformer rewrites it) |
| `unit/strategies/doctor-scaffold.test.ts:63` | WORDING | `/name:\s*lisa-doctor/` | STRUCTURAL (frontmatter form) |
| `unit/strategies/doctor-scaffold.test.ts:66` | WORDING | `Skill` | STRUCTURAL (frontmatter form) |
| `unit/strategies/doctor-scaffold.test.ts:67` | WORDING | `Bash` | STRUCTURAL (frontmatter form) |
| `unit/strategies/doctor-scaffold.test.ts:68` | WORDING | `Read` | STRUCTURAL (frontmatter form) |
| `unit/strategies/falsifiable-checks-rule.test.ts:41` | WORDING | `[reference/falsifiable-checks.md](../reference/falsifiabl...` | rule-index reachability (check-rules-pairing.sh reads the `reference/X.md` link) |
| `unit/strategies/git-discipline-force-lease-contract.test.ts:46` | WORDING | `/^---\n(?:description: .+\n)?alwaysApply: true\n---/` | STRUCTURAL: Cursor alwaysApply frontmatter |
| `unit/strategies/git-discipline-force-lease-contract.test.ts:49` | WORDING | `/^---\ndescription: .+\nalwaysApply: false\n---/` | STRUCTURAL: Cursor alwaysApply frontmatter |
| `unit/strategies/github-evidence-upload.test.ts:160` | WORDING | `#` | the extracted `gh release upload` commands are executed/checked |
| `unit/strategies/health-skill-contract.test.ts:45` | WORDING | `$ARGUMENTS` | `$ARGUMENTS` placeholder (transformer rewrites it) |
| `unit/strategies/improve-harness-skill.test.ts:39` | WORDING | `$ARGUMENTS` | `$ARGUMENTS` placeholder (transformer rewrites it) |
| `unit/strategies/improve-harness-skill.test.ts:45` | WORDING | `/name:\s*lisa-improve-harness/` | STRUCTURAL (frontmatter form) |
| `unit/strategies/intake-explain-scaffold.test.ts:45` | WORDING | `$ARGUMENTS` | `$ARGUMENTS` placeholder (transformer rewrites it) |
| `unit/strategies/intake-explain-scaffold.test.ts:52` | WORDING | `/name:\s*lisa-intake-explain/` | STRUCTURAL (frontmatter form) |
| `unit/strategies/learnings-audit-contract.test.ts:66` | UNRESOLVED | `canonical` | template byte-parity — promotion-contract AC template |
| `unit/strategies/learnings-audit-contract.test.ts:74` | WORDING | `$ARGUMENTS` | `$ARGUMENTS` placeholder (transformer rewrites it) |
| `unit/strategies/linear-key-resolver-ladder-parity.test.ts:130` | WORDING | `.claude/skills/lisa-secrets-access/scripts/resolve-secret...` | embedded shell the test executes — ladder function extracted from the doc and run |
| `unit/strategies/linear-key-resolver-ladder-parity.test.ts:133` | WORDING | `.agents/skills/lisa-secrets-access/scripts/resolve-secret...` | embedded shell the test executes — ladder function extracted from the doc and run |
| `unit/strategies/linear-key-resolver-ladder-parity.test.ts:217` | WORDING | `LINEAR_API_KEY_${slug}` | embedded shell the test executes — ladder function extracted from the doc and run |
| `unit/strategies/planning-checks-ledger-read-contract.test.ts:69` | UNRESOLVED | `STEP_ZERO_COMMAND` | command line the test also executes |
| `unit/strategies/planning-checks-ledger-read-contract.test.ts:70` | WORDING | `/cat [^\n]*PROJECT_LEARNINGS/` | raw-ledger negative guard (pairs with the executed command line) |
| `unit/strategies/promotion-contract-rule.test.ts:37` | WORDING | `reference/promotion-contract.md` | rule-index reachability (check-rules-pairing.sh reads the `reference/X.md` link) |
| `unit/strategies/queue-status-scaffold.test.ts:46` | WORDING | `$ARGUMENTS` | `$ARGUMENTS` placeholder (transformer rewrites it) |
| `unit/strategies/queue-status-scaffold.test.ts:53` | WORDING | `/name:\s*lisa-queue-status/` | STRUCTURAL (frontmatter form) |
| `unit/strategies/queue-status-scaffold.test.ts:55` | WORDING | `Skill` | STRUCTURAL (frontmatter form) |
| `unit/strategies/queue-status-scaffold.test.ts:56` | WORDING | `Bash` | STRUCTURAL (frontmatter form) |
| `unit/strategies/queue-status-scaffold.test.ts:57` | WORDING | `Read` | STRUCTURAL (frontmatter form) |
| `unit/strategies/readiness-rubric-contract.test.ts:42` | WORDING | `reference/readiness-rubric.md` | rule-index reachability (check-rules-pairing.sh reads the `reference/X.md` link) |
| `unit/strategies/readiness-rubric-contract.test.ts:49` | UNRESOLVED | `field` | finding fields emitted and read in src/cli/doctor-readiness-*.ts |
| `unit/strategies/ready-role-filing-contract.test.ts:43` | WORDING | `reference/ready-role-filing.md` | rule-index reachability (check-rules-pairing.sh reads the `reference/X.md` link) |
| `unit/strategies/ready-role-filing-contract.test.ts:59` | WORDING | `reference/claim-time-guards.md` | rule-index reachability (check-rules-pairing.sh reads the `reference/X.md` link) |
| `unit/strategies/remote-agent-aws-observer-reads.test.ts:263` | UNRESOLVED | `probe` | doc-to-code vocabulary parity |
| `unit/strategies/remote-agent-aws-setup.test.ts:70` | WORDING | `--secret-id company-remote-agent` | subject is generated/fixture output, not a shipped doc |
| `unit/strategies/reset-seed-coverage-rule.test.ts:25` | WORDING | `reference/reset-seed-coverage.md` | rule-index reachability (check-rules-pairing.sh reads the `reference/X.md` link) |
| `unit/strategies/rework-triage-skill.test.ts:37` | WORDING | `$ARGUMENTS` | `$ARGUMENTS` placeholder (transformer rewrites it) |
| `unit/strategies/rework-triage-skill.test.ts:43` | WORDING | `/name:\s*lisa-rework-triage/` | STRUCTURAL (frontmatter form) |
| `unit/strategies/scoping-label-vocabulary-contract.test.ts:65` | WORDING | `priority:<low\|medium\|high\|critical>` | doc-to-code vocabulary parity |
| `unit/strategies/session-operating-pack.test.ts:79` | UNRESOLVED | ``(../reference/${slug}.md)`` | session-operating-pack breadcrumb link |
| `unit/strategies/session-operating-pack.test.ts:103` | UNRESOLVED | ``reference/${slug}.md`` | rule-index reachability (check-rules-pairing.sh reads the `reference/X.md` link) |
| `unit/strategies/setup-automations-readiness-warning.test.ts:98` | UNRESOLVED | ``reference/${slug}.md`` | rule-index reachability (check-rules-pairing.sh reads the `reference/X.md` link) |
| `unit/strategies/setup-automations-readiness-warning.test.ts:100` | UNRESOLVED | ``${slug}-reference.mdc`` | rule-index reachability (check-rules-pairing.sh reads the `reference/X.md` link) |
| `unit/strategies/stale-state-claims-rule.test.ts:30` | WORDING | `reference/stale-state-claims.md` | rule-index reachability (check-rules-pairing.sh reads the `reference/X.md` link) |
| `unit/strategies/stale-state-claims-rule.test.ts:36` | WORDING | `/\b[A-Z]{2,6}-\d{1,6}\b/` | leak guard |
| `unit/strategies/stale-state-claims-rule.test.ts:37` | WORDING | `/https?:\/\//` | leak guard |
| `unit/strategies/stale-state-claims-rule.test.ts:38` | WORDING | `/\b[a-z0-9-]+\.(com\|net\|org\|io\|dev)\b/` | leak guard |
| `unit/strategies/upstream-attribution-filing-contract.test.ts:60` | UNRESOLVED | ``\`${failureClass}\``` | doc-to-code vocabulary parity |
| `unit/strategies/verify-prd-scaffold.test.ts:60` | WORDING | `$ARGUMENTS` | `$ARGUMENTS` placeholder (transformer rewrites it) |
| `unit/strategies/verify-prd-scaffold.test.ts:69` | WORDING | `/name:\s*lisa-verify-prd/` | STRUCTURAL (frontmatter form) |
| `unit/strategies/verify-prd-scaffold.test.ts:73` | WORDING | `Skill` | STRUCTURAL (frontmatter form) |
| `unit/strategies/verify-prd-scaffold.test.ts:74` | WORDING | `Bash` | STRUCTURAL (frontmatter form) |
| `unit/strategies/verify-workflow-change-skill.test.ts:38` | WORDING | `$ARGUMENTS` | `$ARGUMENTS` placeholder (transformer rewrites it) |
| `unit/strategies/verify-workflow-change-skill.test.ts:43` | WORDING | `/name:\s*lisa-verify-workflow-change/` | STRUCTURAL (frontmatter form) |
| `unit/strategies/verify-workflow-change-skill.test.ts:44` | WORDING | `allowed-tools: ["Bash", "Read"]` | STRUCTURAL (frontmatter form) |
| `unit/strategies/wiki-connector-source-sanitization.test.ts:96` | WORDING | `api_key = [REDACTED:API_KEY]` | subject is generated/fixture output, not a shipped doc |
| `unit/strategies/wiki-connector-source-sanitization.test.ts:97` | WORDING | `[REDACTED:API_KEY]` | subject is generated/fixture output, not a shipped doc |
| `unit/strategies/wiki-connector-source-sanitization.test.ts:156` | WORDING | `[REDACTED:SSN]` | subject is generated/fixture output, not a shipped doc |
| `unit/strategies/wiki-connector-source-sanitization.test.ts:157` | WORDING | `api_key = [REDACTED:API_KEY]` | subject is generated/fixture output, not a shipped doc |
| `unit/strategies/wiki-connector-source-sanitization.test.ts:158` | WORDING | `123-45-6789` | subject is generated/fixture output, not a shipped doc |
| `unit/strategies/wiki-connector-source-sanitization.test.ts:159` | WORDING | `[REDACTED:API_KEY]` | subject is generated/fixture output, not a shipped doc |
| `unit/strategies/wiki-connector-source-sanitization.test.ts:181` | WORDING | `client_secret = [REDACTED:API_KEY]` | subject is generated/fixture output, not a shipped doc |
| `unit/strategies/wiki-connector-source-sanitization.test.ts:182` | WORDING | `[REDACTED:API_KEY]` | subject is generated/fixture output, not a shipped doc |
| `unit/strategies/wiki-status-surface.test.ts:38` | WORDING | `$ARGUMENTS` | `$ARGUMENTS` placeholder (transformer rewrites it) |
| `unit/strategies/wiki-status-surface.test.ts:45` | WORDING | `/name:\s*lisa-wiki-status/` | STRUCTURAL (frontmatter form) |
| `unit/templates/node-version-consistency.test.ts:144` | WORDING | `typescript/copy-overwrite/.github/GITHUB_ACTIONS.md` | subject is generated/fixture output, not a shipped doc |
| `unit/templates/node-version-consistency.test.ts:147` | WORDING | `typescript/package-lisa/package.lisa.json` | subject is generated/fixture output, not a shipped doc |
| `unit/templates/node-version-consistency.test.ts:148` | WORDING | `nestjs/create-only/.github/workflows/ci.yml` | subject is generated/fixture output, not a shipped doc |
| `unit/templates/node-version-consistency.test.ts:149` | WORDING | `npm-package/create-only/.github/workflows/publish-to-npm.yml` | subject is generated/fixture output, not a shipped doc |
