# Roster Decision — CodySwannGT/lisa#4490

Plan: `4490-evidence-ignored-dir`. Work type: Fix (bug), but the change is to rule and skill prose, with no runtime code path. It edits `plugins/src/base/rules/{eager,reference}/verification.md` and `plugins/src/base/skills/lisa-tracker-evidence/SKILL.md`, then regenerates the per-agent artifacts with `bun run build:plugins`.

- INCLUDE - lisa:github-agent - Acted as the bounded input-resolver. It read #4490, its graph, and its comments.
- INCLUDE - Explore - Required on every team. The lead did the reference sweep (`git grep` across every agent's generated rule copies) inline because it took a single command.
- INCLUDE - lisa:quality-specialist - Independent review of the policy wording, the internal consistency between the three files, and parity across the generated agent artifacts.
- INCLUDE - lisa:verification-specialist - Independent empirical check. It runs the new `git check-ignore` branch in a scratch repo with `evidence/` both ignored and tracked, confirms the generated artifacts match the source, and writes the verdict.
- INCLUDE - lisa:learner - Captures task learnings to the ledger, as the flow requires.
- EXCLUDE - general-purpose - More specific specialists already cover every role.
- EXCLUDE - lisa:builder - This is a bug, not a feature build. The prose edit is three bullets, and the lead makes it directly.
- EXCLUDE - lisa:bug-fixer - The defect is missing policy text. There is no executable path for a failing unit test to reproduce. The reproduction is the scratch-repo `git add` silently skipping an ignored `evidence/`, which verification-specialist runs.
- EXCLUDE - lisa:architecture-specialist - The fix stays inside existing sections and adds no new module or design.
- EXCLUDE - lisa:test-specialist - No source code changes, so there are no unit tests to design. Plugin sync and parity checks cover the generated artifacts.
- EXCLUDE - lisa:debug-specialist - The root cause is stated in the issue and confirmed by reading the source.
- EXCLUDE - lisa:security-specialist - The change has no auth, secret, or input-handling surface. The only security-adjacent point (no credential values in evidence) is unchanged.
- EXCLUDE - lisa:performance-specialist - The change has no performance surface.
- EXCLUDE - lisa:product-specialist - The change has no UI or user-flow surface. The operator-readability of the wording is covered by quality review.
- EXCLUDE - lisa:spec-conformance-specialist - The issue's three-bullet Expected section is small enough for verification-specialist to map directly. A separate conformance pass would duplicate that.
- EXCLUDE - lisa:git-history-analyzer - The history is not in question. The issue cites the exact lines.
- EXCLUDE - lisa:eval-specialist - This change does not measure the factory.
- EXCLUDE - lisa:learning-judge / lisa:skill-evaluator / lisa:learnings-synthesizer / lisa:pr-mining-specialist / lisa:tracker-mining-specialist - These are debrief and learning-routing agents, which are not part of the Implement lifecycle.
- EXCLUDE - lisa:jira-agent / lisa:linear-agent / lisa:*-build-intake / lisa:*-prd-intake - The tracker is GitHub, and this run is not an intake cycle.
- EXCLUDE - Plan / claude / claude-code-guide / code-simplifier:code-simplifier / hookify:conversation-analyzer / statusline-setup / web-fetch - These are not relevant to a prose policy fix.
