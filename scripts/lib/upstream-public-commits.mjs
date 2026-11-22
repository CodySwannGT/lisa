/**
 * upstream-public-commits — read the public-commit list back out of the
 * generated manifest, and say what is wrong when it is stale.
 *
 * @remarks
 * `lisa file-upstream` accepts a commit reference only when it is a key of
 * `UPSTREAM_PUBLIC_COMMITS` in `src/core/upstream-evidence-manifest.json`. That
 * list is an accumulator rather than a derivation: the generator seeds it from
 * the checked-in file and extends it from git history only when asked to
 * (`--refresh-public-commits`). For four months nothing asked, so every commit
 * made after the list was introduced was refused, and an upstream filing that
 * cited recent history could not complete (CodySwannGT/lisa#4960). The refresh
 * now runs in the release hook, and this module holds the two questions that
 * hook has to be able to answer about its own output.
 *
 * ## Why the reader is deliberately loose
 *
 * The generator carries the recorded list forward by parsing the JSON it
 * writes. That is the right way to WRITE the list and the wrong way to CHECK
 * it: if the recorded file ever stops parsing — a conflict marker, a hand edit
 * — the strict read comes back empty, and a refresh then writes only what
 * history reaches today. Nothing fails; the list is just smaller. So the check
 * reads the same record as text, with a pattern that has no opinion about
 * syntax, and the two reads disagreeing is the signal.
 *
 * @module scripts/lib/upstream-public-commits
 */
/** The manifest record that holds the list. */
const PUBLIC_COMMITS_RECORD = "UPSTREAM_PUBLIC_COMMITS";

/** The generated manifest data, relative to the repository root. */
export const MANIFEST_PATH = "src/core/upstream-evidence-manifest.json";

/**
 * The text of one record of the manifest, read without parsing it.
 *
 * Sliced by record name rather than swept across the whole file, because the
 * tracked-surface record renders `"<path>": true` in the same shape. The
 * records hold only flat `key: value` pairs, so the record ends at the first
 * closing brace after its own.
 * @param {string} source - Contents of the generated manifest.
 * @param {string} name - Record name.
 * @returns {string} The record body, or an empty string when it is absent.
 */
function recordText(source, name) {
  const key = source.indexOf(`"${name}"`);
  if (key === -1) return "";
  const open = source.indexOf("{", key);
  if (open === -1) return "";
  const close = source.indexOf("}", open);
  return close === -1 ? "" : source.slice(open, close);
}

/** The command that extends the list from git history. */
export const REFRESH_PUBLIC_COMMITS_COMMAND =
  "node scripts/generate-upstream-evidence-manifest.mjs --refresh-public-commits";

/**
 * Every full commit SHA the generated manifest lists, however it is spelled.
 *
 * Scoped to the public-commit block: the tracked-surface block renders
 * `<path>: true,` in the same shape, and a file named with forty hex characters
 * is not a commit.
 * @param {string} source - Contents of the generated manifest.
 * @returns {Set<string>} Listed SHAs; empty when the block is absent.
 */
export function listedPublicCommits(source) {
  return new Set(
    recordText(source, PUBLIC_COMMITS_RECORD).match(/\b[a-f0-9]{40}\b/gu) ?? []
  );
}

/**
 * Recorded commits a new list would leave out.
 *
 * The list only ever grows — removing a commit that is no longer reachable is a
 * decision nobody has made — so anything returned here is a commit about to be
 * lost by accident.
 * @param {string} recordedSource - The generated manifest as it is on disk.
 * @param {Iterable<string>} kept - SHAs the new list will hold.
 * @returns {string[]} Recorded SHAs absent from `kept`, sorted.
 */
export function droppedPublicCommits(recordedSource, kept) {
  const keptSet = new Set(kept);
  return [...listedPublicCommits(recordedSource)]
    .filter(commit => !keptSet.has(commit))
    .sort();
}

/**
 * The refusal for a release whose own starting commit is not on the list.
 *
 * Written for whoever is watching the release fail, who may never have heard of
 * this list: what is wrong, what it would have cost, and the command that
 * fixes it.
 * @param {object} details - What the check found.
 * @param {string} details.commit - The commit the release is being cut from.
 * @param {number} details.listedCount - How many commits the list holds.
 * @returns {string} Multi-line refusal text.
 */
export function describeUnlistedReleaseCommit({ commit, listedCount }) {
  return [
    "The upstream public-commit list is stale: the commit this release is being cut from is not on it.",
    `  commit: ${commit}`,
    `  list:   ${MANIFEST_PATH} (${listedCount} commits)`,
    "`lisa file-upstream` accepts a commit reference only when it is on this list, so a package",
    "released now would refuse every upstream filing that cites recent history.",
    "Refresh the list from a full clone of the public repository, with this commit pushed to origin:",
    `  ${REFRESH_PUBLIC_COMMITS_COMMAND}`,
  ].join("\n");
}
