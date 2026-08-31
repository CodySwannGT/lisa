# Roster Decision — CodySwannGT/lisa#3320

Work item: `CodySwannGT/lisa#3320` — fix: preserve pipelines in generated
recursive `.git` deletion guards.
Flow: Implement / **Fix** (bug). Base branch: `main` (`deploy.branches.production`).

## Orchestration mode: no-team fallback (declared)

Team orchestration is **unavailable for this run**. A fleet-wide
one-agent-per-session cap is in force on this shared machine, so no subagent or
teammate delegation is permitted to this session. Per `lisa-implement`'s
no-team fallback, the flow continues with the lead agent performing every role
inline, and every review, verification, and task-tracking obligation is
preserved locally rather than waived:

- Reproduce sub-flow runs first and must fail before any fix (recorded below).
- Verification is executed against the real shipped hook via the repository's
  own subprocess harness, not by self-assertion.
- The verification verdict is written to `.lisa/verification-status.json`.
- Quality gates (lint, typecheck, tests, mutation) run unbypassed; no
  `--no-verify`.

This is a representation gap in this run's environment, documented here rather
than silently dropped.

## Agent type enumeration

Every specialist type this runtime exposes, one line each.

| Decision | Agent type | Reason |
| --- | --- | --- |
| EXCLUDE | `Explore` | Required by default on every team; excluded **only** by the one-agent cap. Its work — locating the guard family, the four shipped copies, the generators, and the existing fixture matrix — was performed inline by the lead and is recorded in the plan notes below. Recorded as a gap, not a waiver. |
| EXCLUDE | `general-purpose` | One-agent cap. Lead performed input resolution, branch/base derivation, and orchestration inline. |
| EXCLUDE | `Plan` | One-agent cap; the change is a single-file guard fix with a known blast radius, planned inline. |
| EXCLUDE | `lisa:bug-fixer` | One-agent cap. Lead ran the Reproduce sub-flow and the TDD fix inline. |
| EXCLUDE | `lisa:debug-specialist` | One-agent cap. Root cause was proved by direct probing of the hook's decision points (evidence below), not inferred. |
| EXCLUDE | `lisa:test-specialist` | One-agent cap. Regression fixtures added to the existing guard matrix inline. |
| EXCLUDE | `lisa:quality-specialist` | One-agent cap. Repository lint/typecheck/mutation gates carry the quality contract mechanically. |
| EXCLUDE | `lisa:security-specialist` | One-agent cap. The change only tightens a destructive-command guard; it grants no new capability. |
| EXCLUDE | `lisa:verification-specialist` | One-agent cap. Verification is executed against the real hook binary and recorded as machine-readable evidence, so it is not self-assertion even though the lead ran it. Independence gap recorded. |
| EXCLUDE | `lisa:spec-conformance-specialist` | One-agent cap. Acceptance criteria are checked one-by-one in the completion summary. |
| EXCLUDE | `lisa:product-specialist` | One-agent cap; no user-visible UI surface in this change. |
| EXCLUDE | `lisa:performance-specialist` | One-agent cap. Hook latency is nonetheless a design constraint here (PreToolUse runs on every Bash call) and is addressed inline: the fix adds no new subprocess. |
| EXCLUDE | `lisa:architecture-specialist` | One-agent cap. The shared-tokenisation question is answered explicitly in the report. |
| EXCLUDE | `lisa:learner` | One-agent cap. MLD recorded inline in the plan notes. |
| EXCLUDE | `lisa:learning-judge` / `lisa:skill-evaluator` / `lisa:learnings-synthesizer` | One-agent cap; no learning promotion is proposed by this flow. |
| EXCLUDE | `lisa:git-history-analyzer` | One-agent cap; `git log` on the guard file consulted inline. |
| EXCLUDE | `coderabbit:code-reviewer` | One-agent cap for the local spawn. CodeRabbit still reviews the PR through its GitHub app, so the review obligation is met on the PR rather than skipped. |
| EXCLUDE | `code-simplifier:code-simplifier` | One-agent cap; the change is ~20 lines in one function. |
| EXCLUDE | `lisa:github-agent` / `lisa:github-build-intake` / `lisa:github-prd-intake` | Lifecycle dispatchers; this flow was dispatched directly and performs the tracker writes itself. |
| EXCLUDE | `lisa:jira-agent`, `lisa:jira-build-intake`, `lisa:linear-agent`, `lisa:linear-build-intake`, `lisa:linear-prd-intake`, `lisa:notion-prd-intake`, `lisa:confluence-prd-intake` | Wrong vendor — `tracker` is `github`. |
| EXCLUDE | `lisa:eval-specialist` | Measures the factory, not this work item. |
| EXCLUDE | `lisa:pr-mining-specialist` / `lisa:tracker-mining-specialist` | Debrief-flow agents; not an Implement-flow role. |
| EXCLUDE | `lisa-expo:ops-specialist` | Wrong stack — this repository is a Bun/TypeScript monorepo, not an Expo app, and there is no deploy target to health-check. |
| EXCLUDE | `claude-code-guide`, `hookify:conversation-analyzer`, `statusline-setup` | Not implementation roles for this work item. |

## Tool access preflight (`tool-access-gate`)

| Tool | Probe | Status |
| --- | --- | --- |
| `git` | `git rev-parse --git-dir` | pass |
| `gh` (GitHub tracker) | `gh issue view 3320` returned the live issue; `gh issue edit` applied the claim label | pass |
| `bash` | `/bin/bash --version` | pass |
| `jq` (hook input parsing) | `jq --version` | pass |
| `python3` (heredoc classifier) | `python3 -V` | pass |
| `sed` / `tr` / `grep` (BSD, macOS) | used directly by the guard and by the fix | pass |
| `bun` (test + gate runner) | `bun install` exit 0; `bun run test` | pass |
| `node` (generators, work-item binding) | `node scripts/lisa-work-item.mjs current` | pass |

No AWS, Figma, Jam, Sentry, SonarCloud, database, browser, or device access is
required: the change is a shell guard plus its generated copies, and its proof
command runs the real hook as a subprocess locally.

## Completion condition

**Measurable end state.** The real shipped hook
(`plugins/lisa/hooks/parity-safety-net.sh`), driven as a subprocess with
PreToolUse JSON on stdin, exits `2` for every pipeline that pairs `.git` with a
recursive forced deletion across pipeline stages — including
`find .git -type f -print0 | xargs -0 rm -rf` and the stages that no other
guard catches — and continues to exit `0` for harmless pipelines that merely
mention `.git`-adjacent paths or delete non-`.git` targets.

**Proof command.** `bun run test tests/unit/hooks/parity-safety-net-guards.test.ts`
plus a direct probe sweep that feeds candidate commands to the hook binary and
prints its exit status, so the verdict is observed from the hook's own output
rather than asserted.

**Constraints that must hold.** No command blocked before this change may be
allowed after it (the guard may only block strictly more). Every shipped copy
of the hook stays byte-identical to its source, and the generated evidence
manifests, hash ledger, and nightly guard certificate are regenerated in the
same commit.
