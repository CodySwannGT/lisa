# Closed updater gate diagnostics

Work item: CodySwannGT/lisa#4347. Agent-written by Codex.

## Task metadata

```json
{
  "plan": "4347-gate-diagnostics",
  "type": "bug",
  "acceptance_criteria": [
    "The existing CLI catch reports a fixed source-selected stage for unexpected failures without arbitrary error content.",
    "Only observed native capture can supply closed category, status, signal and errno diagnostics.",
    "Original error identity, cause, failure status, authority checks, cleanup and deadlines are preserved.",
    "The functional hosted failure remains unknown until fresh authentic evidence establishes it; full issue acceptance and genuine human approval remain outstanding."
  ],
  "relevant_documentation": "Current issue body and six complete comments; released CLI catch, gate orchestration and native capture; AGENTS and all host rules.",
  "work_item_context": ".lisa/work-item-context.md",
  "testing_requirements": ["Actual CLI catch RED/GREEN with malformed committed configuration", "Actual orchestration throw and original error/cause preservation", "Adversarial message/stack/path/output/property redaction", "Native nonzero status and signal remain observations rather than success", "Original applicable source, artifact, type, lint, push and hosted gates"],
  "skills": ["lisa-implement", "lisa-tdd-implementation"],
  "learnings": [],
  "required_access": [{"tool": "GitHub repository and open issue", "probe": "Native repository read, complete issue/comments and canonical link/attach", "status": "pass"}],
  "verification": {
    "type": "cli-test",
    "command": "Run the actual updater entry against an owned malformed committed policy, then the released owned hosted caller after review and release.",
    "expected": "Native failure remains nonzero and stderr identifies only the fixed failing stage and genuinely observed closed native facts. No sensitive canary or arbitrary error content appears."
  }
}
```

## Ownership and order

Existing source only: `all/copy-overwrite/scripts/lisa-npm-updater.mjs`, `lib/npm-update-invariants.mjs`, `lib/npm-update-native-process.mjs`, `lib/npm-update-gate.mjs`, `lib/npm-update-hosted-gate.mjs` under that scripts root. A dedicated focused `tests/unit/scripts/npm-update-diagnostics.test.ts` seals the previously uncovered CLI/orchestration diagnostic boundary. Official helper graph, owned hash ledger and evidence manifest are regenerated after staging. No new production basename or dependency.

The existing team remains in place: the assigned implementation actor resolves and repairs this bounded diagnostic seam; ROOT independently reviews exact source and evidence. No additional actors are created. Source is isolated from the other active feature worktrees.

RED must reach the current CLI catch before production edits. GREEN and redaction controls precede official derived refresh and ROOT review. Commit, push, release, fixture adoption and hosted retry are held until their actual authorized delivery gates.

## Comment obligations

All six current comments are consumed in full. Filing/claim and managed backlinks establish the existing leaf; source milestones and published compatibility are retained as source/release evidence only. Comment 6031046086 expressly retains native default-token publication, recovery/retry, later distinct proposal, exact current-head checks and genuine human review/approval. This diagnostic repair does not satisfy or close those obligations. No App/PAT substitution, automatic approval or workflow settings change.

## Current evidence

The released hosted gate failed through the redacted generic non-UpdaterError catch. Its functional cause is unknown. Only this loss of fixed stage information is established. Fresh repository main is the genuine published release; local claim/binding readback passed. Bounded learnings projection returned twenty entries with none omitted. The original failed provider log and artifact diagnosis remain private and unchanged.

The outward CLI now uses its static generic prefix for every exception, including `UpdaterError`, and appends only closed facts. This is an intentional stderr compatibility change: arbitrary overridden error-message getters are never read. Original error messages, identities and causes remain unchanged internally. Configuration policy refusals receive the closed configuration stage. Native stderr/stdout stay in their existing private error object rather than being printed.

`gatePhase` and `hookProfile` extract the unchanged gate entry payload and read-only profile within the same existing files, keeping diagnostic wrapping inside the existing 300-line/75-line function limits. No new production module, authority or dependency direction is introduced.
