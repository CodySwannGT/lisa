# Roster decision — #4237

EXCLUDE - lisa-architecture-specialist - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.
INCLUDE - lisa-bug-fixer - Implement scoped bug fixes with reproduction tests.
INCLUDE - lisa-builder - Implement scoped feature changes with meaningful tests.
EXCLUDE - lisa-confluence-prd-intake - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.
EXCLUDE - lisa-debug-specialist - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.
EXCLUDE - lisa-eval-specialist - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.
EXCLUDE - lisa-git-history-analyzer - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.
EXCLUDE - lisa-github-agent - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.
EXCLUDE - lisa-github-build-intake - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.
EXCLUDE - lisa-github-prd-intake - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.
EXCLUDE - lisa-jira-agent - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.
EXCLUDE - lisa-jira-build-intake - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.
INCLUDE - lisa-learner - Capture task telemetry when supported by evidence.
INCLUDE - lisa-learning-judge - Judge learning candidates before persistence.
EXCLUDE - lisa-learnings-synthesizer - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.
EXCLUDE - lisa-linear-agent - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.
EXCLUDE - lisa-linear-build-intake - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.
EXCLUDE - lisa-linear-prd-intake - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.
EXCLUDE - lisa-notion-prd-intake - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.
EXCLUDE - lisa-performance-specialist - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.
EXCLUDE - lisa-pr-mining-specialist - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.
INCLUDE - lisa-product-specialist - Assess operator messages and acceptance behavior.
INCLUDE - lisa-quality-specialist - Independent local correctness and test review.
EXCLUDE - lisa-security-specialist - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.
EXCLUDE - lisa-skill-evaluator - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.
INCLUDE - lisa-spec-conformance-specialist - Check all issue requirements and parity surfaces.
EXCLUDE - lisa-test-specialist - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.
EXCLUDE - lisa-tracker-mining-specialist - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.
INCLUDE - lisa-verification-specialist - Execute CLI and release proof independently.
INCLUDE - default - Bounded input resolver; no specific resolver role is exposed.
INCLUDE - explorer - Read-only code and contract research before implementation.
EXCLUDE - worker - No separate responsibility needed for this scoped workflow bug; relevant concerns are covered by included specialists.

## Implementation task metadata

```json
{
  "plan": "4237-design-source-opt-out",
  "type": "task",
  "acceptance_criteria": [
    "Explicit boolean false skips the CLI before diff resolution with visible SKIPPED output, including JSON.",
    "Missing, true and invalid flag values retain fail-closed UI declarations.",
    "All five consuming skills omit provenance marker and Figma requests when disabled, without disabling design-value-binding.",
    "Rule documents explicit project opt-out and generated harnesses stay in parity."
  ],
  "relevant_documentation": "Live issue #4237; parent research packet; canonical design-source-gate.mjs runCli/evaluateDesignSource and reference rule; five consuming skills; verdict/rule/entry-guard test patterns.",
  "testing_requirements": [
    "RED then GREEN CLI fixtures with real git diff and malformed/unresolved controls",
    "Pure evaluator and all five skill contract tests",
    "Build/check plugin parity, typecheck and targeted lint"
  ],
  "skills": [
    "lisa-task-triage",
    "lisa-tdd-implementation",
    "lisa-jsdoc-best-practices"
  ],
  "learnings": [
    {
      "kind": "learning",
      "note": "check:plugins refuses uncommitted plugin changes; parent must run it after the reviewed commit.",
      "evidence": "scripts/check-plugins-sync.sh:25"
    },
    {
      "kind": "mistake",
      "note": "Initial lint cleanup targeted the wrong duplicated literal; line-number inspection identified the repeated CLI base option.",
      "evidence": "tests/unit/strategies/design-source-gate-opt-out.test.ts"
    }
  ],
  "required_access": [
    {
      "tool": "GitHub",
      "probe": "gh issue view 4237 --repo CodySwannGT/lisa",
      "status": "pass"
    }
  ],
  "verification": {
    "type": "cli-test",
    "command": "node plugins/lisa/scripts/design-source-gate.mjs --base=HEAD~1 (in temporary repository, test designSource.enabled false and true)",
    "expected": "false prints SKIPPED with exit 0, true prints FAIL with undeclared UI and exit 1"
  }
}
```

## Builder evidence

- RED: 15 failed / 50 passed (opt-out and rule/consumer tests).
- GREEN: 123 passed across five focused suites; CLI fixture rerun after lint cleanup.
- Full typecheck passed under existing quarantine; targeted oxlint/eslint passed.
- build:plugins completed; all four shipped script lanes match canonical bytes.
- CLI proof: boolean false exits 0 with explicit SKIPPED on valid and missing refs; true and string false exit 1 on undeclared UI.
- check:plugins awaits reviewed commit because its preflight rejects uncommitted plugin files.
