# Roster Decision — CodySwannGT/lisa#4641

Plan: `4641-pinned-caller-parse` — Fix (type:Bug). Parse Lisa-pinned reusable-workflow
callers (`uses: …@<sha> # v<version>`) in the shared parser, and fail closed when a Lisa
caller file yields no parsed caller.

```text
INCLUDE - Explore - mandatory read-only research: parser, pinner, detector, health inspection, existing tests, git history.
INCLUDE - lisa:bug-fixer - Fix flow: reproduce as failing tests (RED), then minimal fix (GREEN).
INCLUDE - lisa:verification-specialist - independent empirical proof: runs the detector CLI against a scratch pinned project and writes the verdict.
INCLUDE - lisa:quality-specialist - independent review of the diff for correctness and coding-philosophy compliance.
INCLUDE - lisa:learner - capture task MLD into the learnings ledger.
INCLUDE - general-purpose - lead-session bookkeeping steps the skill assigns to it (plan name, branch, completion condition, access preflight); no narrower specialist covers them.
EXCLUDE - lisa:github-agent - used only as the bounded input-resolver; lifecycle is run by the lead.
EXCLUDE - lisa:test-specialist - bug-fixer owns the RED tests for a 2-point fix; quality-specialist reviews test quality.
EXCLUDE - lisa:builder - this is a Fix, not a Build.
EXCLUDE - lisa:debug-specialist - root cause already proven in the issue (end-anchored regex in the shared parser).
EXCLUDE - lisa:architecture-specialist - the issue prescribes the approach (reuse the pinner's line shape).
EXCLUDE - lisa:product-specialist - no UI or user flow; CLI/health output only.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the three Gherkin scenarios directly; small scope.
EXCLUDE - lisa:security-specialist - no auth, secrets, or input-trust surface changes.
EXCLUDE - lisa:performance-specialist - a regex change; no performance surface.
EXCLUDE - lisa:git-history-analyzer - Explore covers the needed history of two files.
EXCLUDE - lisa:eval-specialist - measures the factory, not this change.
EXCLUDE - lisa:learning-judge - invoked by the learner/persist-learning path, not directly.
EXCLUDE - lisa:skill-evaluator - routing of learnings is the gardener's job.
EXCLUDE - lisa:learnings-synthesizer - debrief-only.
EXCLUDE - lisa:pr-mining-specialist - debrief-only.
EXCLUDE - lisa:tracker-mining-specialist - debrief-only.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - intake dispatcher, not used inside implement.
EXCLUDE - lisa:github-build-intake - intake dispatcher, not used inside implement.
EXCLUDE - lisa:linear-build-intake - intake dispatcher, not used inside implement.
EXCLUDE - lisa:notion-prd-intake - PRD intake, not applicable.
EXCLUDE - lisa:confluence-prd-intake - PRD intake, not applicable.
EXCLUDE - lisa:github-prd-intake - PRD intake, not applicable.
EXCLUDE - lisa:linear-prd-intake - PRD intake, not applicable.
EXCLUDE - Plan - approach is prescribed by the issue.
EXCLUDE - claude - catch-all; specific specialists cover every task.
EXCLUDE - claude-code-guide - no Claude Code product questions.
EXCLUDE - code-simplifier:code-simplifier - quality-specialist covers simplification for a small diff.
EXCLUDE - hookify:conversation-analyzer - not a hook-authoring task.
EXCLUDE - statusline-setup - unrelated.
```

## Flow, base, completion condition

- Flow: Implement → Fix. Readiness: live leaf, build-ready, claimed (reused), bound.
- Target environment: `Assumption: production — remote default branch main`; the Branch Plan
  (branch from `main`, PR into `main`) matches current `deploy.branches.production=main` (Match arm).
- Completion condition: `node scripts/detect-stale-workflow-inputs.mjs --project <scratch>` where
  `<scratch>/.github/workflows/ci.yml` holds a Lisa-pinned caller
  (`uses: CodySwannGT/lisa/.github/workflows/quality.yml@<sha> # v4.87.7`) passing an undeclared
  input prints a `stale` row naming that input and exits 1; an unparseable Lisa caller prints an
  `unparsed` row and exits 1; a project with no Lisa callers exits 0 and says so. Constraints: the
  pin comment Lisa writes is unchanged; comment-free callers parse as before.
- Tool access preflight: local `node`/`bun` (pass) and `gh` (pass — used by the resolver). No external systems.
