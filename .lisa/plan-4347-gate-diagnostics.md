# Closed updater gate diagnostics

## Provenance followup on the published main

Two genuine recovery attempts independently completed checkpoint allocation and then failed at native provenance authentication with exit 1, before publication. Existing closed outer diagnostics identify only `gate-validate`. Their finer cause remains unknown. Retrying unchanged is stopped.

Extend the existing closed diagnostic boundary to identify the actual failing provenance phase and, if necessary, the native gateway phase. Preserve nonzero status, exact native error identity and observations, credential isolation, all authorization checks, original time and output bounds, and cleanup. Never print arbitrary exception properties or captured provider/child output. Add reaching CLI/process negative controls and hostile-output redaction tests. This is diagnostic support for the original acceptance journey, not a claim to have repaired its unknown functional cause.

The accepted minimal source design uses six existing helpers under `all/copy-overwrite/scripts/`: `lisa-automation-provenance.mjs`, `lib/github-attestation-recovery.mjs`, `lib/npm-update-invariants.mjs`, `lib/npm-update-native-process.mjs`, `lib/npm-update-hosted-hook.mjs` and `lib/npm-update-hosted-gate.mjs`. Fixed provenance phases remain separate from the original outer stage. Synchronous phase wrappers retain the same thrown object. Native capture privately registers stderr with observed failure facts; only the exact canonical authentication command may parse an exact closed diagnostic line from that capture. Gateway phases cover failure before the canonical entry runs. No new allowed statuses are needed. Existing `npm-update-diagnostics.test.ts` and `automation-provenance.test.ts` provide reaching CLI, native status and hostile-output controls. Before any additional basename or API surface is introduced, return the exact need to ROOT. ROOT owns official graph, export, hash and manifest generation and this plan/roster. Independent review and empirical verification precede normal commit, PR, release and fresh hosted evidence. No source version bump, provider mutation, dependency upgrade, permission change or workflow bypass is included.

The fresh canonical context has all 18 comments and complete linked source review context. The input receipt is preserved privately; source artifacts remain anonymous. Original issue acceptance, failed attempts, first genuine publisher qualification, later fresh leaf identity and fixture retirement remain required. Snyk remains an unconfigured no-op and supplies no scanner evidence.

The reaching RED ran both focused files through the existing compiled Lisa test-run launcher: 86 cases collected, 21 new phase assertions failed and all 65 pre-existing controls passed, with no skips. The retained native log establishes the missing inner diagnostic at the real CLI, recovery hooks and native capture boundary before production edits. The subsequent native progress comment was appended verbatim to the ignored context, bringing its primary comment inventory to 19.

Five relevant files passed 155 cases under an owned short native temp base. A subsequent same-file extraction reduced the newly enlarged capture function to its original size budget; the two affected files then passed all 25 cases on final bytes. These are distinct retained cohorts, not a new aggregate run. The earlier phase-expectation and inherited Unix temp-path failures remain retained. Scoped managed-source lint passed, while canonical test typechecking passed its existing quarantine contract; this is not a claim of globally clean test typechecking or baseline function sizes.

Separate quality and source-conformance reviewers accepted the exact eight authored file hashes without findings. Official helper graph, export surface, owned hash ledger and evidence manifest regeneration completed successfully, and all seven artifact checks passed. No additional production basename, dependency or version change was introduced. Independent empirical CLI verification, normal commit/push gates, current-head review, release, adoption and genuine hosted qualification remain separate pending observations.

The different empirical verifier subsequently observed all 23 diagnostic cases pass and independently invoked the actual canonical CLI, hosted parent and gateway. Native exit 1 propagated the fixed local-proof phase through gate-validate; no-proof exit 10 remained refused, and hostile captured output at exit 23 stayed redacted. All eight authored hashes were unchanged. This establishes the local CLI and code-unit diagnostic boundary only; normal delivery and the original genuine hosted acceptance are still pending.

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
