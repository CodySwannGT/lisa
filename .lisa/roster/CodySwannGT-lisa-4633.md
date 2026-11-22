# Roster Decision — CodySwannGT/lisa#4633

Plan: `coderabbit-host-labeling` — Fix flow (Bug). Lisa CLI: new `lisa doctor` check for host
CodeRabbit labeling config, plus `lisa apply` correction of Lisa's own unedited `.coderabbit.yml`.

```text
INCLUDE - Explore - mandatory read-only research of doctor checks, retire-unmodified digest proof, apply pipeline and the existing labeling-scope test.
INCLUDE - lisa:bug-fixer - Fix flow: owns reproduce-as-failing-test (RED) then the TDD fix (GREEN).
INCLUDE - lisa:verification-specialist - independent empirical proof (scratch project: lisa doctor / lisa apply) and the v2 verdict; must not be the implementer.
INCLUDE - lisa:quality-specialist - post-implementation review of correctness, structure and test quality, run in parallel with other reviews.
INCLUDE - lisa:spec-conformance-specialist - checks the shipped change against the six Gherkin scenarios and Out of Scope.
INCLUDE - lisa:learner - captures task MLD into the learnings ledger at task end.
INCLUDE - general-purpose - lead-session helper for branch/base resolution and readiness/flow determination, as the skill prescribes.
EXCLUDE - claude - catch-all; more specific specialists cover every task here.
EXCLUDE - claude-code-guide - no question about Claude Code/API features.
EXCLUDE - code-simplifier:code-simplifier - quality-specialist review covers simplification for a small change.
EXCLUDE - hookify:conversation-analyzer - not analyzing transcripts for hooks.
EXCLUDE - lisa:architecture-specialist - the issue's Technical Approach already names the files and design; Explore research suffices.
EXCLUDE - lisa:builder - this is a Fix, owned by bug-fixer.
EXCLUDE - lisa:confluence-prd-intake - no PRD intake.
EXCLUDE - lisa:debug-specialist - root cause is already proven in the issue (shipped template + keep list); reproduction is a failing test.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - the issue already cites the relevant commits (41e69a0261, 575a3fa7ee, 724b1f9db6); Explore can re-read them.
EXCLUDE - lisa:github-agent - the lead runs this lifecycle directly; no separate tracker lifecycle delegation needed.
EXCLUDE - lisa:github-build-intake - not an intake cycle.
EXCLUDE - lisa:github-prd-intake - no PRD intake.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - invoked only via persist-learning if a candidate arises.
EXCLUDE - lisa:learnings-synthesizer - Debrief-only.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - tracker is GitHub.
EXCLUDE - lisa:notion-prd-intake - no PRD intake.
EXCLUDE - lisa:performance-specialist - a single-file read in doctor has no performance surface.
EXCLUDE - lisa:pr-mining-specialist - Debrief-only.
EXCLUDE - lisa:product-specialist - no UI; acceptance criteria are already Gherkin; spec-conformance covers AC matching.
EXCLUDE - lisa:security-specialist - no auth/secrets/input-trust surface beyond YAML parsing of a local file.
EXCLUDE - lisa:skill-evaluator - no learning routing needed.
EXCLUDE - lisa:test-specialist - bug-fixer writes the test matrix the issue already enumerates.
EXCLUDE - lisa:tracker-mining-specialist - Debrief-only.
EXCLUDE - Plan - Technical Approach is fully specified on the issue.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - no public web pages needed.
```

## Flow facts

- Flow: Implement / Fix (type:Bug). Readiness: build-ready leaf, Gherkin AC + Validation Journey present.
- Target env: `Assumption: production — remote default branch main` → base `main` (Branch Plan matches).
- Branch: `worktree-4633-coderabbit-host-labeling` off `origin/main`; binding verified.
- Tool access: `gh` (GitHub tracker/PR) only; `bun`, `node`, local `lisa` CLI from this checkout. No remote
  runtime: Lisa ships as an npm release, so "remote verification" = the published release's CLI.
- Completion condition: in a scratch dir holding the 41e69a0261 template as `.coderabbit.yml`,
  `lisa doctor` shows the CodeRabbit labeling check FAIL naming "Lisa wrote" + both remedies; after
  `lisa apply` the file has `auto_apply_labels: false` and the check passes; an edited copy is untouched.
