# Roster Decision — CodySwannGT/lisa#3321

Flow: Implement / Fix (bug). Work item: `CodySwannGT/lisa#3321`.

## Team orchestration

**Team orchestration is unavailable for this run.** A fleet-wide one-agent-per-session cap is in
force on the shared machine executing this flow, so no teammate or subagent may be spawned. This is
the `lisa-implement` no-team fallback: the lead agent continues alone and preserves the review,
verification, and task-tracking obligations locally. Every roster line below is therefore EXCLUDE
with the same governing reason, and the obligations each specialist would have owned are listed
against the lead.

## Available agent types (Claude runtime delegation surface)

- EXCLUDE - Explore - read-only search equivalent; one-agent cap in force, so the lead performs the codebase search directly. Recorded gap: no independent read-only researcher on this flow.
- EXCLUDE - general-purpose - one-agent cap in force.
- EXCLUDE - claude - one-agent cap in force.
- EXCLUDE - Plan - one-agent cap in force; the lead records the implementation plan inline.
- EXCLUDE - lisa:bug-fixer - one-agent cap in force; the lead runs the Reproduce sub-flow and the TDD fix.
- EXCLUDE - lisa:debug-specialist - one-agent cap in force; the lead performs root-cause analysis.
- EXCLUDE - lisa:architecture-specialist - one-agent cap in force.
- EXCLUDE - lisa:test-specialist - one-agent cap in force; the lead designs and writes the test matrix.
- EXCLUDE - lisa:security-specialist - one-agent cap in force; the lead applies the trust-boundary review to the credential path directly. This is a security-shaped defect, so the review is performed, just not independently.
- EXCLUDE - lisa:quality-specialist - one-agent cap in force; the lead runs the local quality review.
- EXCLUDE - lisa:verification-specialist - one-agent cap in force. Recorded gap: the verification verdict cannot be produced by an agent that did not implement the change. It is written by the lead and that non-independence is disclosed in the verdict and the PR.
- EXCLUDE - lisa:spec-conformance-specialist - one-agent cap in force; the lead checks the shipped change against the binding acceptance comment on the work item.
- EXCLUDE - lisa:product-specialist - one-agent cap in force; no user-visible UI surface on this item.
- EXCLUDE - lisa:performance-specialist - not applicable; the change is URL validation on a config path and has no performance dimension.
- EXCLUDE - lisa:learner / lisa:learning-judge / lisa:skill-evaluator - one-agent cap in force; MLD telemetry is recorded inline in the task plan below.
- EXCLUDE - lisa:builder - not applicable; this is a Fix, not a Build.
- EXCLUDE - coderabbit:code-reviewer - one-agent cap in force; the CodeRabbit bot review still runs against the PR itself and is handled through the PR review loop.
- EXCLUDE - code-simplifier:code-simplifier - one-agent cap in force.
- EXCLUDE - lisa:github-agent / lisa:jira-agent / lisa:linear-agent - lifecycle dispatchers; this flow was dispatched directly.
- EXCLUDE - lisa:github-build-intake / lisa:github-prd-intake / lisa:jira-build-intake / lisa:linear-build-intake / lisa:notion-prd-intake / lisa:confluence-prd-intake / lisa:linear-prd-intake - not applicable; no intake cycle is being run.
- EXCLUDE - lisa:eval-specialist, lisa:git-history-analyzer, lisa:pr-mining-specialist, lisa:tracker-mining-specialist, lisa:learnings-synthesizer, lisa-expo:ops-specialist, hookify:conversation-analyzer, statusline-setup, claude-code-guide - not applicable to this work item.

## Recorded gaps

1. No independent read-only research agent (Explore or equivalent) is on this team.
2. The verification verdict is not independently judged; the implementer writes it.

Both follow from the one-agent cap, not from a judgement that the specialists were unnecessary.

## Task plan

| # | Task | Type | Status |
| - | ---- | ---- | ------ |
| 1 | Reproduce: failing tests proving userinfo/query/fragment/path acceptance and the wrong-file error | bug | |
| 2 | Fix `server_origin` into a strict canonical-origin validator; use the canonical value as the request base | bug | |
| 3 | Fix `resolve_jira_config_path` to fail on a rejected existing project config, naming that file | bug | |
| 4 | Regenerate all shipped parser copies + evidence manifest + hash ledger | task | |
| 5 | Local review, quality gates, verification verdict, PR | task | |

### Task metadata

```json
{
  "plan": "jira-trust-url-validation",
  "type": "bug",
  "acceptance_criteria": [
    "Only a canonical HTTPS origin with no userinfo, no query, no fragment and a root-only path is accepted.",
    "The Jira API token is never sent when the configured URL fails validation.",
    "A rejected existing project config is named in the error together with the trust-root mismatch, instead of reporting a missing home config.",
    "Environment, project-config and home-config resolution are all covered by tests.",
    "Every shipped parser copy is regenerated, along with the upstream evidence manifest and the Lisa-owned hash ledger."
  ],
  "relevant_documentation": "plugins/src/base/skills/lisa-jira-journey/scripts/parse-plan.py is the source parser; six shipped copies are generated from it. tests/unit/scripts/jira-server-origin.test.ts and tests/unit/strategies/jira-config-resolution.test.ts are the existing coverage. The binding URL policy is the [lisa-resolved-acceptance] comment on CodySwannGT/lisa#3321.",
  "testing_requirements": [
    "Unit tests exercising server_origin against the full accept/reject matrix from the binding policy.",
    "Subprocess tests proving get_jira_config exits non-zero before any network call for every rejected URL shape, on each of the environment, project-config and home-config resolution paths.",
    "A test proving the token is not transmitted on the rejection path (no request is constructed).",
    "A test proving a rejected existing project config is named in the diagnostic.",
    "No browser/device/e2e harness applies: the surface is a Python CLI parser with no UI."
  ],
  "skills": [],
  "learnings": [],
  "required_access": [
    { "tool": "python3", "probe": "python3 --version", "status": "pass" },
    { "tool": "GitHub (tracker + PR)", "probe": "gh issue view 3321", "status": "pass" },
    { "tool": "bun test runner", "probe": "bun install", "status": "pass" }
  ],
  "verification": {
    "type": "cli-test",
    "command": "python3 -c \"...\" driving parse-plan.py get_jira_config with each rejected URL shape, with a stub urllib.request.urlopen that records any outbound request, plus `bunx vitest run tests/unit/scripts/jira-server-origin.test.ts tests/unit/strategies/jira-config-resolution.test.ts`",
    "expected": "Every rejected shape exits 1 with a diagnostic naming the responsible source, the recorder observes zero outbound requests, and every accepted shape yields the canonical origin as the request base."
  }
}
```

### Tool access preflight

External systems this flow needs: `python3` (the parser runtime), the GitHub tracker and PR surface,
and the `bun`/`vitest` test runner. All three probed pass. The parser's own network dependency
(a live Jira instance) is deliberately **not** required: the verification proves that no request is
constructed on the rejection path, which is established by a recording stub rather than by reaching
a real Jira. No AWS, Figma, Jam, Sentry, SonarCloud, PostHog, database, or deploy target is involved.

### Completion condition

Driving `get_jira_config` with a URL carrying userinfo, a query, a fragment, or a non-root path
exits non-zero with a diagnostic that names the responsible source, and a recording stub installed
over `urllib.request.urlopen` observes **zero** outbound requests — proving the token is never sent.
Driving it with a canonical origin returns that origin as the request base. Constraint: nothing
previously accepted by `server_origin` other than the four newly rejected shapes changes behaviour,
and every shipped parser copy is byte-identical to the regenerated source.
