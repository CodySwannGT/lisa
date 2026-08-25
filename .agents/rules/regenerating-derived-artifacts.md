# Regenerating the two derived artifacts

**Stage first, regenerate second, stage again.** Both of Lisa's generated
artifacts read the git INDEX, not your editor, so a regeneration that runs
before `git add` records the file set you had a moment ago.

```sh
git add <the real changes>
bun run build:lisa-owned-hash-ledger
bun run build:upstream-evidence-manifest
git add src/core/lisa-owned-hash-ledger.ts src/core/upstream-evidence-manifest.ts
bun run check:artifacts
```

The two artifacts are:

- `src/core/lisa-owned-hash-ledger.ts` — every content hash Lisa has ever
  shipped at a Lisa-owned destination, built by
  `scripts/generate-lisa-owned-hash-ledger.mjs`. It holds **two** records, and
  both are regenerated together: `LISA_OWNED_HASH_LEDGER` is the hashes, and
  `LISA_OWNED_HASH_HISTORY_DERIVED` says which of them the `git log --follow`
  walk actually produced. A hash in the first and not the second was carried
  forward from an earlier checked-in ledger; that is expected under a shallower
  clone, it is KEPT rather than pruned, and the generator reports it on every
  run (CodySwannGT/lisa#3115). `digestOrigin` in
  `src/core/lisa-owned-provenance.ts` answers the same question in one call.
- `src/core/upstream-evidence-manifest.ts` — the hash-pinned allowlist of public
  upstream evidence, built by
  `scripts/generate-upstream-evidence-manifest.mjs`.

`bun run check:artifacts` runs both `--check`s. The same pair runs at commit
time from `.husky/pre-commit` via `scripts/check-derived-artifacts.mjs`.

## The trap: a check that passes by hand and fails at commit

`lint-staged` runs `oxlint --fix`, `eslint --fix` and `prettier --write` over
**every staged file** at commit time, and the artifact gate deliberately runs
*after* it — a gate placed before the reformat would vouch for bytes that no
longer exist. So a manifest you generated, verified by hand, and staged can be
stale by the time it is checked, through no fault of yours: the reformat moved
an input underneath it.

The recovery is always the same, and it terminates: regenerate **now**, after
the reformat, `git add`, and commit again. It converges because the second
reformat is a no-op on already-formatted bytes.

## Order between the two: it does not matter

Folklore says ledger-before-manifest because "the manifest hashes the ledger".
**Measured, the manifest does not hash the ledger.**
`src/core/lisa-owned-hash-ledger.ts` sits outside
every packaged-evidence prefix, so the manifest records its *path* and never its
*bytes*; changing the ledger's contents leaves the manifest's `--check` passing.

What actually couples them is a shared **input**. A `copy-overwrite` template is
hashed by both, so editing one template stales both artifacts at once and each
must be regenerated — in either order. Any other file stales at most one of
them.

Do not write the ordering claim back in. It sends whoever believes it to
regenerate the wrong file, which is the exact cost that produced this rule.

## A stale-manifest refusal tells you what moved

Since CodySwannGT/lisa#2852 the manifest's refusal names the cause rather than
only the file, and each cause has a different fix:

- **an input's bytes moved** — usually the lint-staged reformat above.
  Regenerate now.
- **the tracked file set moved** — you staged or `git rm`'d something after
  regenerating. Stage first, then regenerate.
- **no input moved at all** — the generated file itself was rewritten after
  generation, by a hand edit or a formatter. It is generated; do not edit it.

When the listed files include a `copy-overwrite` template, the refusal also
tells you to regenerate the ledger, because that template's bytes are recorded
in both.

## Why regenerating twice can be right

Both generators read the **working tree**, on purpose: an author who edits a
guard and regenerates gets *their* new hash recorded, rather than the pre-edit
bytes from `HEAD`. That is what makes a second regeneration after a reformat the
correct move rather than a workaround.
