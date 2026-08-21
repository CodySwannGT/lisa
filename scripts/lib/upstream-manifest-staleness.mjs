/**
 * upstream-manifest-staleness — turn "the manifest is out of date" into "here is
 * what moved underneath it".
 *
 * @remarks
 * `src/core/upstream-evidence-manifest.ts` is derived from two things: the set
 * of TRACKED files (`git ls-files`, so the git index), and the working-tree
 * bytes of every tracked file under a packaged-evidence prefix. Its `--check`
 * regenerates and compares byte-for-byte, so it can say *that* the file is out
 * of date, and until CodySwannGT/lisa#2852 that is all it said:
 *
 * ```
 * src/core/upstream-evidence-manifest.ts is stale; run bun run build:upstream-evidence-manifest
 * ```
 *
 * The refusal is accurate and points away from the cause. It names the file
 * that is out of date, so the obvious response is to regenerate that file — and
 * when the cause is an input that moves again afterwards, regenerating
 * reproduces the identical refusal. That is a loop with no exit signposted from
 * inside it, and it cost a full cycle.
 *
 * There are exactly two ways an input can move, and they need opposite fixes:
 *
 * - **The bytes of a hash-pinned file changed.** Overwhelmingly this is
 *   `lint-staged`, which runs `oxlint --fix`, `eslint --fix` and
 *   `prettier --write` over every staged file at commit time — *after* the
 *   author regenerated, and *before* the artifact gate runs. The fix is to
 *   regenerate again now, after the reformat.
 * - **The tracked set changed.** A file staged (or `git rm`'d) after the
 *   manifest was generated is a membership change, and regenerating before the
 *   next `git add` will produce the same wrong answer. The fix is to stage
 *   first and regenerate second.
 *
 * A third outcome is possible and worth naming: no input moved at all, which
 * means the generated file itself was rewritten after generation — a hand edit,
 * or a formatter reaching the artifact.
 *
 * ## What this module deliberately does not claim
 *
 * The obvious story — "the manifest hashes the ledger, so a stale manifest means
 * a stale ledger" — is false, and was measured false while fixing #2852:
 * `src/core/lisa-owned-hash-ledger.ts` lives outside every packaged-evidence
 * prefix, so the manifest records its PATH and never its bytes. Mutating the
 * ledger's contents leaves the manifest check passing. The two artifacts are
 * independent in content; what couples them is a shared INPUT. Editing a
 * `copy-overwrite` template moves bytes both of them record, so both go stale
 * together — which is why the message below sends a template change to
 * regenerate the ledger too, and says nothing of the sort for any other path.
 *
 * @module scripts/lib/upstream-manifest-staleness
 */

/** Marker identifying a template whose bytes the Lisa-owned hash ledger records. */
const COPY_OVERWRITE = "/copy-overwrite/";

/** Longest list of paths a refusal prints before summarizing the remainder. */
const MAX_LISTED_PATHS = 10;

/**
 * @typedef {object} ManifestInputs
 * @property {Map<string, string>} evidence - Hash-pinned path to sha256 digest.
 * @property {Set<string>} surface - Every tracked path recorded at generation.
 */

/**
 * @typedef {object} ManifestDiagnosis
 * @property {string[]} changed - Pinned paths whose recorded digest no longer matches.
 * @property {string[]} added - Paths present now and absent when the file was generated.
 * @property {string[]} removed - Paths recorded then and absent now.
 */

/**
 * The body of one `Object.freeze({ … })` block in the generated module.
 *
 * Sliced by export name rather than matched with one regex over the whole file,
 * because the public-commit block renders `<sha>: true,` — the same shape as a
 * tracked-surface entry. A single sweep reads 40-character SHAs as file paths
 * and then reports thousands of phantom removals.
 * @param {string} source - Generated module source.
 * @param {string} exportName - Name of the exported constant to slice.
 * @returns {string} The block body, or an empty string when it is absent.
 */
function blockFor(source, exportName) {
  const start = source.indexOf(`export const ${exportName}`);
  if (start === -1) return "";
  const open = source.indexOf("Object.freeze({", start);
  if (open === -1) return "";
  const close = source.indexOf("\n  });", open);
  if (close === -1) return "";
  return source.slice(open, close);
}

/**
 * The inputs a generated manifest says it was built from.
 * @param {string} source - Contents of `src/core/upstream-evidence-manifest.ts`.
 * @returns {ManifestInputs} Recorded evidence digests and tracked-surface paths.
 */
export function parseManifestInputs(source) {
  const evidence = new Map();
  for (const match of blockFor(source, "UPSTREAM_EVIDENCE_MANIFEST").matchAll(
    /^ {4}"([^"]+)":\n {6}"([a-f0-9]{64})",$/gmu
  )) {
    evidence.set(match[1], match[2]);
  }

  const surface = new Set();
  for (const match of blockFor(source, "UPSTREAM_SURFACE_MANIFEST").matchAll(
    /^ {4}(?:"([^"]+)"|([A-Za-z_$][A-Za-z0-9_$]*)): true,$/gmu
  )) {
    surface.add(match[1] ?? match[2]);
  }

  return { evidence, surface };
}

/**
 * What moved between the checked-in manifest and a fresh regeneration.
 *
 * Direction matters: `current` is what is on disk and `fresh` is the truth, so
 * a path in `fresh` alone was staged after generation and a path in `current`
 * alone was removed after it.
 * @param {string} current - The manifest as it exists on disk.
 * @param {string} fresh - The manifest as it would be generated right now.
 * @returns {ManifestDiagnosis} Inputs that changed, were added, or were removed.
 */
export function diagnoseStaleManifest(current, fresh) {
  const before = parseManifestInputs(current);
  const after = parseManifestInputs(fresh);

  const changed = [...after.evidence.entries()]
    .filter(
      ([file, digest]) =>
        before.evidence.has(file) && before.evidence.get(file) !== digest
    )
    .map(([file]) => file)
    .sort();
  const added = [...after.surface]
    .filter(file => !before.surface.has(file))
    .sort();
  const removed = [...before.surface]
    .filter(file => !after.surface.has(file))
    .sort();

  return { changed, added, removed };
}

/**
 * Render at most `MAX_LISTED_PATHS` paths, then say how many were withheld.
 * @param {readonly string[]} paths - Paths to render, already sorted.
 * @returns {string} Indented lines, one path each.
 */
function listPaths(paths) {
  const shown = paths
    .slice(0, MAX_LISTED_PATHS)
    .map(file => `    ${file}`)
    .join("\n");
  const withheld = paths.length - MAX_LISTED_PATHS;
  return withheld > 0 ? `${shown}\n    …and ${withheld} more` : shown;
}

/**
 * The operator-facing refusal for a stale manifest.
 *
 * Written for whoever is standing at the gate, which is not necessarily whoever
 * wrote the generator: it names the input that moved, why it usually moves, and
 * the command that clears it.
 * @param {ManifestDiagnosis} diagnosis - Output of {@link diagnoseStaleManifest}.
 * @returns {string} Multi-line refusal text.
 */
export function describeStaleManifest(diagnosis) {
  const sections = ["src/core/upstream-evidence-manifest.ts is stale."];

  if (diagnosis.changed.length > 0) {
    sections.push(
      "  Its inputs moved after it was generated. These files no longer have\n" +
        "  the bytes it recorded:\n" +
        `${listPaths(diagnosis.changed)}\n` +
        "  At commit time lint-staged reformats every staged file BEFORE this\n" +
        "  check runs, so a manifest generated first is stale by the time it is\n" +
        "  checked. Regenerate now, after the reformat."
    );
  }

  if (diagnosis.added.length > 0 || diagnosis.removed.length > 0) {
    const movements = [];
    if (diagnosis.added.length > 0) {
      movements.push(
        `  Staged since it was generated:\n${listPaths(diagnosis.added)}`
      );
    }
    if (diagnosis.removed.length > 0) {
      movements.push(
        `  Removed since it was generated:\n${listPaths(diagnosis.removed)}`
      );
    }
    sections.push(
      "  The tracked file set moved after it was generated.\n" +
        `${movements.join("\n")}\n` +
        "  The manifest reads TRACKED files, so `git add` (or `git rm`) first and\n" +
        "  regenerate second — the other order records the pre-change file set."
    );
  }

  if (
    diagnosis.changed.length === 0 &&
    diagnosis.added.length === 0 &&
    diagnosis.removed.length === 0
  ) {
    sections.push(
      "  None of its inputs moved — only the generated file's own bytes differ,\n" +
        "  so something rewrote it after generation: a hand edit, or a formatter\n" +
        "  reaching the artifact. It is generated; do not edit it by hand."
    );
  }

  sections.push(
    "  Fix: bun run build:upstream-evidence-manifest\n" +
      "  Then: git add src/core/upstream-evidence-manifest.ts"
  );

  if (
    [...diagnosis.changed, ...diagnosis.added, ...diagnosis.removed].some(
      file => file.includes(COPY_OVERWRITE)
    )
  ) {
    sections.push(
      "  A copy-overwrite template is among the files above, so the Lisa-owned\n" +
        "  hash ledger records those same bytes and is stale for the same reason.\n" +
        "  Regenerate it in this commit too, or its own check fails next:\n" +
        "  bun run build:lisa-owned-hash-ledger"
    );
  }

  return sections.join("\n\n");
}
