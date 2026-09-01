# Roster Decision — CodySwannGT/lisa#3490

Flow: Implement / Fix (bug). Work item: `CodySwannGT/lisa#3490`.

## Team orchestration

**Team orchestration is unavailable for this run.** A one-agent-per-session cap is in force for this
flow, so no teammate or subagent may be spawned. This is the `lisa-implement` no-team fallback: the
lead agent continues alone and preserves the review, verification, and task-tracking obligations
locally. Every roster line below is therefore EXCLUDE with the same governing reason, and the
obligations each specialist would have owned are carried by the lead.

## Available agent types (Claude runtime delegation surface)

- EXCLUDE - Explore - read-only search equivalent; one-agent cap in force, so the lead performs the codebase search directly. Recorded gap: no independent read-only researcher on this flow.
- EXCLUDE - general-purpose - one-agent cap in force.
- EXCLUDE - claude - one-agent cap in force.
- EXCLUDE - Plan - one-agent cap in force; the lead records the implementation plan inline.
- EXCLUDE - lisa:bug-fixer - one-agent cap in force; the lead runs the Reproduce sub-flow and the TDD fix.
- EXCLUDE - lisa:debug-specialist - one-agent cap in force; the lead performs the root-cause reading of the existing census comment and the resolution mechanism it describes.
- EXCLUDE - lisa:architecture-specialist - one-agent cap in force; the lead designs the census module split.
- EXCLUDE - lisa:test-specialist - one-agent cap in force; the lead designs and writes the test matrix, including the injection test the work item names.
- EXCLUDE - lisa:security-specialist - one-agent cap in force. The change is read-only filesystem inspection with no credential, network, or write path; the trust surface is the roster file, which the lead validates directly.
- EXCLUDE - lisa:quality-specialist - one-agent cap in force; the lead runs the local quality review.
- EXCLUDE - lisa:verification-specialist - one-agent cap in force. Recorded gap: the verification verdict cannot be produced by an agent that did not implement the change. It is written by the lead and that non-independence is disclosed in the verdict and in the PR.
- EXCLUDE - lisa:spec-conformance-specialist - one-agent cap in force; the lead checks the shipped change against the five Gherkin scenarios on the work item.
- EXCLUDE - lisa:product-specialist - one-agent cap in force; no user-visible UI surface on this item. The operator-facing surface is a terminal report, reviewed by the lead for readability by a non-technical operator.
- EXCLUDE - lisa:performance-specialist - not applicable; the census is an offline, once-a-day read of a bounded set of small files.
- EXCLUDE - lisa:learner / lisa:learning-judge / lisa:skill-evaluator - one-agent cap in force; MLD telemetry is recorded inline in the task plan below.
- EXCLUDE - lisa:builder - not applicable; this is a Fix, not a Build.
- EXCLUDE - coderabbit:code-reviewer - one-agent cap in force; the CodeRabbit bot review still runs against the PR itself and is handled through the PR review loop.
- EXCLUDE - code-simplifier:code-simplifier - one-agent cap in force.
- EXCLUDE - lisa:github-agent / lisa:jira-agent / lisa:linear-agent - lifecycle dispatchers; this flow was dispatched directly.
- EXCLUDE - lisa:github-build-intake / lisa:github-prd-intake / lisa:jira-build-intake / lisa:linear-build-intake / lisa:notion-prd-intake / lisa:confluence-prd-intake / lisa:linear-prd-intake - not applicable; no intake cycle is being run.
- EXCLUDE - lisa:eval-specialist, lisa:git-history-analyzer, lisa:pr-mining-specialist, lisa:tracker-mining-specialist, lisa:learnings-synthesizer, lisa-expo:ops-specialist, hookify:conversation-analyzer, statusline-setup, claude-code-guide - not applicable to this work item.

## Recorded gaps

1. No independent read-only research agent (Explore or equivalent) is on this team.
2. The verification verdict is not independently judged; the implementer writes it, and says so.

Both follow from the one-agent cap, not from a judgement that the specialists were unnecessary.

## Task plan

| # | Task | Type | Status |
| - | ---- | ---- | ------ |
| 1 | Reproduce: a test that fails when "resolves nothing" is folded into the stale count | bug | done |
| 2 | Per-checkout coverage derivation — guard resolution, governing tree, vintage, receipt, installed vs declared | bug | done |
| 3 | Fleet census — roster + discovery, disjoint classes, report-only exit status, redaction | bug | done |
| 4 | `lisa doctor` standing finding for this checkout | task | done |
| 5 | Scheduled surface: skill, command, runbook, automation registration | task | done |
| 6 | Replace the frozen census comment with the command that re-derives it | task | done |
| 7 | Quality gates, verification verdict, PR | task | done |

### Task metadata

```json
{
  "plan": "enforcement-fleet-census",
  "type": "bug",
  "acceptance_criteria": [
    "A checkout resolving no enforcement guard is reported as resolving NO guard and is never folded into the stale count.",
    "A checkout resolving an old guard reports the governing copy and its vintage.",
    "A checkout resolving a current copy with an apply receipt is reported as covered.",
    "The census exit status is unchanged by any finding about the fleet, including a fleet in which every checkout is stale.",
    "A checkout the census cannot read reports that it could not look, and is never counted as covered.",
    "The census derives its numbers at run time from the checkouts on disk; no count is restated from a checked-in file.",
    "`lisa doctor` carries the local half as a standing finding, including installed vs declared vs reference."
  ],
  "relevant_documentation": "scripts/lisa-enforcement-fallback.sh is the resolution mechanism the census measures: six guards resolved first-wins per guard from scripts/lisa-hooks/ (host, written by `lisa apply`, dated by .lisa/apply-receipt.json) shadowing plugins/lisa/hooks/ (the Lisa monorepo's own copy, dated by plugins/lisa/.claude-plugin/plugin.json). The aggregate takes the strongest refusal, so the oldest resolved copy governs (#3205). The frozen census lived in that file's staleness-notice comment block. src/core/apply-receipt.ts is the receipt reader. scripts/lisa-update-local.sh reads the fleet roster .lisa.workspaces.json (gitignored, machine-local, an object mapping checkout path to target branch). src/cli/doctor.ts composes one module per finding; src/cli/doctor-apply-freshness.ts is the closest precedent and warns rather than fails on purpose.",
  "testing_requirements": [
    "An injection test: folding the unguarded class into the stale count must turn a named test red.",
    "Unguarded, partial, resolved-behind, resolved-undateable, covered, and unreadable each proved on a checkout built on disk.",
    "Exit status proved unchanged across an all-stale fleet, an all-unguarded fleet, and a fleet containing an unreadable checkout.",
    "Unreadable proved excluded from covered, and proved to still appear in the report.",
    "Installed-vs-declared drift proved on a checkout whose node_modules is behind its own manifest.",
    "No browser/device/e2e harness applies: the surface is a terminal report from a Node CLI with no UI."
  ],
  "skills": [],
  "learnings": [
    { "kind": "learning", "note": "The fleet roster is gitignored and machine-local, so no CI surface can ever run this census — the schedule has to be a local automation.", "evidence": ".gitignore line for .lisa.workspaces.json" }
  ],
  "required_access": [
    { "tool": "GitHub (tracker + PR)", "probe": "gh issue view 3490", "status": "pass" },
    { "tool": "bun/vitest test runner", "probe": "bun install && bunx vitest run", "status": "pass" },
    { "tool": "local filesystem (the census reads checkouts on disk)", "probe": "temp-dir fixtures built by the test suite", "status": "pass" }
  ],
  "verification": {
    "type": "cli-test",
    "command": "node scripts/lisa-enforcement-census.mjs --roster <fixture roster> --redact; echo \"exit=$?\"",
    "expected": "The report separates NO GUARD RESOLVED, COULD NOT LOOK, PARTIAL and RESOLVED into disjoint counts that sum to the roster size, names the governing copy and vintage for each resolved checkout, and exits 0 on every fleet shape."
  }
}
```

### Tool access preflight

External systems this flow needs: the GitHub tracker and PR surface, and the `bun`/`vitest` test
runner. Both probed pass. The census itself reads only the local filesystem — no network, no
credential, no deploy target — which is why its tests build real checkouts in a temp directory
rather than mocking a filesystem. No AWS, Figma, Jam, Sentry, SonarCloud, PostHog, or database is
involved.

### Completion condition

Running `node scripts/lisa-enforcement-census.mjs --roster <roster>` against a fixture fleet
containing one checkout of every shape prints a report whose four resolution classes are disjoint
and sum to the roster size, names the governing copy and its vintage for each checkout that resolves
one, names the unreadable checkout as "could not look" outside the covered count, and exits 0.

Constraint: the exit status is 0 for every fleet shape, so nothing about another operator's checkout
can redden a build; and no number in the report is read from a checked-in file — each is derived
from the checkouts on disk at run time.
