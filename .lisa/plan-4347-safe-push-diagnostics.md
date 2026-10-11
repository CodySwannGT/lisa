# Safe native push failure diagnostics

Work-Item: CodySwannGT/lisa#4347

Base: current main 5c1778a99257c712d1ce7314a3e4fac988dd5332. Sole permanent integration branch is main. Existing claimed leaf and worktree-local binding are retained; this task preserves the original six acceptance scenarios.

The actual hosted run passed preparation and signed allocation, then exited at gate-push with native status 1 before publication. The complete job log and artifact inventory retain no original child transcript. No underlying hook, test, or audit-versus-destination cause is established. Unchanged replay cannot recover the lost evidence.

1. Builder adds bounded non-authoritative classification from actually captured native failure bytes. Fixed known hook names, strictly validated committed test locations and bounded numeric summaries are the only admissible output. Unknown output remains unclassified. Arbitrary exception properties, raw transcript tails, credentials, environment, SQL and arguments never leave the process.
2. Prove RED before GREEN using real native failing-process capture, hostile and forged-output negatives, path escapes and preservation of nonzero status, original limits and cleanup. Existing diagnostic tests are relevant documentation; source capture and public formatter establish the loss chain.
3. Separate reviewer checks exact source and executes meaningful controls. Root regenerates official artifacts, commits through normal hooks, opens one PR and drives its unchanged protected gates to merge. New evidence may reopen review; speculative findings cannot.
4. Qualify actual published release, adopt with native coherent locks and full Fleet apply, then resume the original hosted acceptance and recovery journey. Diagnostics passing locally does not complete the source leaf or caller integration ticket.

Roster: .lisa/roster/CodySwannGT-lisa-4347.md. Learnings may be empty; do not invent entries. Preserve all foreign work, failed-run evidence, canonical metadata and review policy. No application deployment.

## Task metadata

```json
{
  "plan": "4347-safe-push-diagnostics",
  "type": "bug",
  "acceptance_criteria": ["Actual native failed push retains bounded non-authoritative diagnostic labels while failing", "Hostile output and forged properties cannot expose arbitrary bytes or establish authority", "All original six acceptance scenarios remain required after release and adoption"],
  "relevant_documentation": "Native capture in npm-update-native-process.mjs; pushProposal in npm-update-gate.mjs; WeakMap-backed publicFailure in npm-update-invariants.mjs; existing npm-update-diagnostics.test.ts",
  "work_item_context": ".lisa/work-item-context.md",
  "testing_requirements": ["Real native process RED/GREEN controls", "Forged exception, hostile transcript and path escape negatives", "Named regression execution in required PR CI", "Separate empirical CLI observation"],
  "skills": ["lisa-implement", "lisa-git-submit-pr", "lisa-drive-pr-to-merge"],
  "learnings": [],
  "required_access": [
    {"tool": "GitHub source and tracker", "probe": "gh issue view 4347 --repo CodySwannGT/lisa; gh api repos/CodySwannGT/lisa/branches/main", "status": "pass"},
    {"tool": "Git transport", "probe": "git fetch origin main", "status": "pass"},
    {"tool": "Hosted runtime Docker", "probe": "docker version --format '{{.Server.Version}}'", "status": "pass"}
  ],
  "verification": {
    "type": "cli-test",
    "command": "Execute an owned native child emitting a known failed-hook line plus hostile canary, retain its original exit 1, then invoke the source public formatter through the actual registered native failure",
    "expected": "Exit 1 is preserved, the fixed non-authoritative classification is visible, and canary/raw child bytes are absent"
  }
}
```

The context path is worktree-relative in this public artifact to avoid publishing operator paths. Teammates receive the exact absolute worktree-local context path privately. The complete comment inventory remains in that ignored canonical bundle and was consumed by the resolver. Required Actions policies were re-read as read/false for source and caller. Docker server responded 29.2.1. No permission setting has been changed for this diagnostic work.

## Exact derived effects and delivery ownership

Root owns official regeneration of all/copy-overwrite/scripts/npm-updater-helper-graph.json, src/core/lisa-owned-hash-ledger.ts, src/core/upstream-evidence-manifest.ts and src/core/export-surface.json when their native freshness checks require it. The existing modules are in the helper graph; any added exported diagnostic helper must appear in the export-surface artifact. No generated output is hand edited. Stage authored inputs first, await each official generator, stage outputs, then run the complete unchanged artifact aggregate.

The builder selected no new module and no exposed test-path surface. Only explicit fixed Lefthook failure-summary labels and complete bounded RSpec numeric tuples may leave observed failing native capture. The push invocation supplies a fixed audit/destination diagnostic role. Every child-derived label is explicitly non-authoritative; a mere check heading is not a failed-check report. Source runtime uses Node 24.21.0 and Bun 1.3.8. Portable native tests also use the qualified Node 22.23.3 updater where relevant.
