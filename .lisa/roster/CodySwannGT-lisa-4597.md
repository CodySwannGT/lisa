# Roster Decision — CodySwannGT/lisa#4597

Plan: `4597-cleanup-sweep` — start-of-run cleanup sweep (C1). Work type: Build.
Recorded: 2026-11-07. Runtime: Claude Code (implicit-team model).

```text
INCLUDE - Explore - mandatory read-only research: prefix inventory, scratch modules, lisa-test-run and gate-runner wiring, test conventions.
INCLUDE - lisa:builder - Build work type; implements the sweep helper and its wiring via TDD against the Gherkin criteria.
INCLUDE - lisa:quality-specialist - reviews correctness, immutability/function-structure compliance and test coverage of the new helper.
INCLUDE - lisa:security-specialist - the sweep deletes directories and kills processes; symlink refusal, tmpdir confinement and kill-targeting need a threat review.
INCLUDE - lisa:spec-conformance-specialist - verifies the shipped helper matches the ticket's approach, criteria and Out of Scope (no C2/C3 policing removal).
INCLUDE - lisa:verification-specialist - independent empirical verification of the Validation Journey and the v2 verdict.
INCLUDE - lisa:learner - captures task MLD to the learnings ledger.
EXCLUDE - general-purpose - only the input-resolver used it; every later role has a more specific specialist.
EXCLUDE - claude - catch-all; specialists cover every role.
EXCLUDE - Plan - the ticket already carries a detailed technical approach; architecture review is unnecessary for one helper.
EXCLUDE - lisa:architecture-specialist - approach, file paths and invocation points are prescribed by the ticket.
EXCLUDE - lisa:test-specialist - the ticket prescribes the test matrix; the builder writes it and quality-specialist reviews it.
EXCLUDE - lisa:bug-fixer - Build, not Fix.
EXCLUDE - lisa:debug-specialist - no defect to diagnose.
EXCLUDE - lisa:performance-specialist - the one perf budget (<5 s at 10k entries) is an executable test the verifier runs.
EXCLUDE - lisa:product-specialist - developer tooling with no user-facing UX; spec-conformance covers the criteria.
EXCLUDE - lisa:git-history-analyzer - the ticket's Relationship Search already covers history; Explore covers the rest.
EXCLUDE - lisa:eval-specialist - measures the factory, not this change.
EXCLUDE - lisa:learning-judge - invoked by the learner/persist pipeline where needed, not as a teammate.
EXCLUDE - lisa:skill-evaluator - advisory routing for learnings; not part of this build.
EXCLUDE - lisa:learnings-synthesizer - Debrief flow only.
EXCLUDE - lisa:pr-mining-specialist - Debrief flow only.
EXCLUDE - lisa:tracker-mining-specialist - Debrief flow only.
EXCLUDE - lisa:github-agent - the lead runs this lifecycle directly via lisa-implement.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:github-build-intake - intake cycle, not single-item implement.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:github-prd-intake - PRD intake, not implementation.
EXCLUDE - lisa:confluence-prd-intake - PRD intake, not implementation.
EXCLUDE - lisa:linear-prd-intake - PRD intake, not implementation.
EXCLUDE - lisa:notion-prd-intake - PRD intake, not implementation.
EXCLUDE - code-simplifier:code-simplifier - quality-specialist review covers simplification for a single new file.
EXCLUDE - hookify:conversation-analyzer - unrelated to the build.
EXCLUDE - claude-code-guide - no Claude Code product questions.
EXCLUDE - statusline-setup - unrelated.
```

## Flow facts

- Target environment: `Assumption: production — remote default branch main`, mapped through `deploy.branches` to `main`. Branch Plan matches: branch from `main`, PR into `main`.
- Branch: `claude/4597-cleanup-sweep` off `origin/main` @ f7355b414b (lisa 4.90.0).
- Blocker #4591 is still open; the operator approved proceeding (relayed by the managing session on 2026-11-07).
- Regression level: the deliverable is a CLI and library with no browser or device surface. The highest practical observation level is real-process integration tests plus CLI runs; the e2e harnesses (Playwright, Maestro) don't apply.
- Tool access: needs only local git, gh, node and bun; the probes ran in this session. No external systems.
