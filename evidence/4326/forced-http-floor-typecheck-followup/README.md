# Final typed HTTP floor regression followup

The initial103-case runtime and scoped lint evidence remains unchanged in the preceding floor-repair packet. The canonical test compiler subsequently rejected two nullable parsed endpoints in the new regression. An explicit null guard fixes those errors without casts, suppressions, or production changes.

Identical final new test bytes (SHA25606c57251993a57ff812dab686d49b36533c6058c2c9a5a43d2fd9bde473a6df0) again produce103 cases with29 intended baseline failures and then103 candidate passes/zero pending cases. The other five floor source hashes are unchanged. Actual compiler, scoped ESLint/Oxlint/SonarJS and formatter commands return0.

The canonical compiler retains an existing362-file quarantine with1542 errors and confirms no errors outside it or stale entries. No quarantine was modified. This establishes the existing compiler gate and this changed test, not an error-free entire test tree.

The source HEAD is still61580e1bc54b26aa9d2825c000b1e958e7655389 with reviewed uncommitted changes. New committed artifact replay, remote CI, merge and public release remain pending. Original raw attempts, initial packet and immutable17-file historical evidence are preserved.
