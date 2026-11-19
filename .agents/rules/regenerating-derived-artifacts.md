# Regenerating the two derived artifacts

**Stage first, regenerate second, stage again.** Both of Lisa's generated
artifacts read the git INDEX, not your editor, so a regeneration that runs
before `git add` records the file set you had a moment ago.

```sh
git add <the real changes>
bun run build:lisa-owned-hash-ledger
bun run build:upstream-evidence-manifest
git add src/core/lisa-owned-hash-ledger.json src/core/upstream-evidence-manifest.json
bun run check:artifacts
```

The two artifacts are:

- `src/core/lisa-owned-hash-ledger.json` — every content hash Lisa has ever
  shipped at a Lisa-owned destination, built by
  `scripts/generate-lisa-owned-hash-ledger.mjs`. It holds **two** records, and
  both are regenerated together: `LISA_OWNED_HASH_LEDGER` is the hashes, and
  `LISA_OWNED_HASH_HISTORY_DERIVED` says which of them the `git log --follow`
  walk actually produced. A hash in the first and not the second was carried
  forward from an earlier checked-in ledger; that is expected under a shallower
  clone, it is KEPT rather than pruned, and the generator reports it on every
  run (CodySwannGT/lisa#3115). `digestOrigin` in
  `src/core/lisa-owned-provenance.ts` answers the same question in one call.
- `src/core/upstream-evidence-manifest.json` — the hash-pinned allowlist of public
  upstream evidence, built by
  `scripts/generate-upstream-evidence-manifest.mjs`.

Both are JSON data, read at runtime by hand-written loaders of the same name
(`src/core/lisa-owned-hash-ledger.ts`, `src/core/upstream-evidence-manifest.ts`).
Never edit the JSON by hand; the loaders are ordinary source.

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
`src/core/lisa-owned-hash-ledger.json` sits outside
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

## The manifest's commit list is refreshed by the release, not by you

The manifest also holds `UPSTREAM_PUBLIC_COMMITS`, the list of commits
`lisa file-upstream` accepts as references. An ordinary regeneration carries
that list forward unchanged — which is what keeps `--check` byte-reproducible on
any clone — so between releases it is behind `HEAD`, and that is expected.

The release extends it. The `postbump` hook in `.versionrc` stages the release
build, runs `node scripts/generate-upstream-evidence-manifest.mjs
--refresh-public-commits`, runs `node scripts/check-release-commit-listed.mjs`,
and stages the manifest, so the release commit carries every commit reachable
from `origin`'s refs at that moment. Until CodySwannGT/lisa#4960 nothing ran the
refresh, and every commit made after the list was introduced was refused.

Three refusals guard it, each naming its fix:

- **the commit being released from is not on the refreshed list** — it was never
  pushed, or `origin`'s refs were not fetched. The release stops.
- **the clone is shallow** — a shallow clone would add its newest commit and
  silently omit everything older, so the refresh refuses it. The release job
  checks out with `fetch-depth: 0`; keep it that way.
- **the new list would drop a recorded commit** — the list only ever grows, so a
  shorter one means the generated file was reformatted or edited. Restore it.

There is no need to refresh the list in an ordinary pull request: it adds
thousands of lines that the next release writes anyway.

## Why regenerating twice can be right

Both generators read the **working tree**, on purpose: an author who edits a
guard and regenerates gets *their* new hash recorded, rather than the pre-edit
bytes from `HEAD`. That is what makes a second regeneration after a reformat the
correct move rather than a workaround.
