#!/usr/bin/env node
/**
 * Generate the ledger of every content hash Lisa has ever shipped at each
 * Lisa-owned destination path.
 *
 * Refresh uses it to tell a host copy that is *behind* Lisa (its bytes are some
 * past Lisa release, so overwriting is correct) from one that is *ahead* (its
 * bytes match no Lisa release, so overwriting would delete downstream work).
 *
 * Two properties are load-bearing:
 *
 * - **Keyed by destination, not source.** Several stacks ship a variant of the
 *   same installed path; a host has exactly one of them and refresh must accept
 *   whichever it has. The union across stacks is the honest answer to "has Lisa
 *   ever shipped these bytes here?".
 * - **Append-only.** Existing entries are unioned in, never dropped. That makes
 *   the generator safe under a shallow clone: less history yields fewer new
 *   hashes, never the loss of known-good ones. Losing a hash would reclassify a
 *   legitimately stale file as host-modified and stop refreshing it — failing
 *   safe, but permanently.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const outputPath = path.join(repoRoot, "src/core/lisa-owned-hash-ledger.ts");
const COPY_OVERWRITE = "copy-overwrite";
const LISA_NAMESPACE_PREFIX = "lisa-";

/**
 * Run a git command in the repository and return stdout as latin1 text.
 *
 * Blobs are read as `binary` so arbitrary bytes survive the round trip into the
 * Buffer that gets hashed; decoding as UTF-8 would corrupt any non-text file.
 * @param {readonly string[]} args - Arguments passed to git
 * @returns {string} Command stdout, or an empty string when git fails
 */
function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString("binary");
  } catch {
    return "";
  }
}

/**
 * Whether a destination path sits in the namespace Lisa owns outright.
 *
 * Mirrors `isLisaOwnedTemplate` in `src/core/lisa-owned-templates.ts`. The
 * duplication is deliberate — this script runs before the TypeScript build, so
 * it cannot import the compiled module — and a test asserts the two agree.
 *
 * This is also the ledger's boundary, and it is inherited rather than chosen.
 * The `lisa-` path segment is what decides which files refresh at all, so a file
 * outside it is never refreshed after its initial create and has nothing for
 * provenance to decide — recording hashes for it would add a regeneration gate
 * to ~120 more templates and buy nothing today. If that predicate is ever
 * replaced (CodySwannGT/lisa#2491 tracks it freezing non-`lisa-` guards at
 * whatever version first landed), widening enrolment is this one function: the
 * ledger answers "has Lisa ever shipped these bytes here?" for any managed path.
 * @param {string} destination - Repo-relative destination path
 * @returns {boolean} True when Lisa owns the file outright
 */
function isLisaOwned(destination) {
  return destination
    .split("/")
    .some(segment => segment.startsWith(LISA_NAMESPACE_PREFIX));
}

/**
 * Every tracked copy-overwrite source that installs a Lisa-owned file.
 * @returns {Map<string, string[]>} Destination path to the source paths producing it
 */
function lisaOwnedSources() {
  const byDestination = new Map();
  const marker = `/${COPY_OVERWRITE}/`;
  for (const tracked of git(["ls-files"]).split("\n")) {
    const at = tracked.indexOf(marker);
    if (at === -1) continue;
    const destination = tracked.slice(at + marker.length);
    if (!isLisaOwned(destination)) continue;
    const sources = byDestination.get(destination) ?? [];
    sources.push(tracked);
    byDestination.set(destination, sources);
  }
  return byDestination;
}

/**
 * Hex sha256 of a blob's bytes.
 * @param {Buffer} bytes - Blob contents
 * @returns {string} Lower-case hex digest
 */
function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Every hash this source path has ever had, across all of its history.
 *
 * `--follow` keeps a renamed guard's earlier hashes, which is exactly the case
 * where a host is most likely to be running an older copy.
 * @param {string} source - Repo-relative source path
 * @returns {string[]} Hashes of every historical revision plus the checked-in copy
 */
function historicalHashes(source) {
  const hashes = [];
  const current = git(["show", `HEAD:${source}`]);
  if (current !== "") hashes.push(digest(Buffer.from(current, "binary")));

  // `--name-only` is what makes rename-following actually work. Asking for the
  // commit list alone and then reading `<rev>:<source>` fails for every revision
  // before a rename, because the file did not live at that path yet — the very
  // revisions a long-installed host is most likely to be running.
  const log = git([
    "log",
    "--format=%H",
    "--follow",
    "--name-only",
    "--",
    source,
  ]).split("\n");
  let revision = "";
  for (const line of log) {
    if (/^[0-9a-f]{40}$/.test(line)) {
      revision = line;
      continue;
    }
    if (line === "" || revision === "") continue;
    const blob = git(["show", `${revision}:${line}`]);
    if (blob !== "") hashes.push(digest(Buffer.from(blob, "binary")));
  }
  return hashes;
}

/**
 * Hashes already recorded in the checked-in ledger, so none is ever lost.
 * @returns {Map<string, string[]>} Destination path to previously recorded hashes
 */
function existingLedger() {
  const previous = new Map();
  let source = "";
  try {
    source = readFileSync(outputPath, "utf8");
  } catch {
    return previous;
  }
  const entry = /"([^"]+)": Object\.freeze\(\[([^\]]*)\]\)/g;
  for (const match of source.matchAll(entry)) {
    previous.set(
      match[1],
      [...match[2].matchAll(/"([0-9a-f]{64})"/g)].map(hash => hash[1])
    );
  }
  return previous;
}

/**
 * Render the ledger module.
 * @param {Map<string, string[]>} ledger - Destination path to known-good hashes
 * @returns {string} TypeScript module source
 */
function render(ledger) {
  const entries = [...ledger.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    // Indentation matches what Prettier produces. `lint-staged` reformats every
    // staged file, so a generator whose output Prettier would reindent leaves
    // `--check` failing immediately after the commit that regenerated it.
    .map(([destination, hashes]) => {
      const rendered = hashes.map(hash => `    "${hash}",`).join("\n");
      return `  "${destination}": Object.freeze([\n${rendered}\n  ]),`;
    })
    .join("\n");
  return `/** Generated by scripts/generate-lisa-owned-hash-ledger.mjs. Do not edit. */

/**
 * Every content hash Lisa has published at each Lisa-owned destination path.
 *
 * A host copy whose hash appears here is provably an older Lisa artifact and may
 * be refreshed. One that appears nowhere here was edited downstream, and refresh
 * refuses rather than risk deleting a stronger guard. See
 * \`src/core/lisa-owned-provenance.ts\`.
 */
export const LISA_OWNED_HASH_LEDGER: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
${entries}
});
`;
}

const ledger = new Map(existingLedger());
for (const [destination, sources] of lisaOwnedSources()) {
  const known = new Set(ledger.get(destination) ?? []);
  for (const source of sources) {
    for (const hash of historicalHashes(source)) known.add(hash);
  }
  ledger.set(destination, [...known].sort());
}

const rendered = render(ledger);
if (process.argv.includes("--check")) {
  let actual = "";
  try {
    actual = readFileSync(outputPath, "utf8");
  } catch {
    actual = "";
  }
  if (actual !== rendered) {
    process.stderr.write(
      "Lisa-owned hash ledger is out of date. Run `bun run build:lisa-owned-hash-ledger` and commit the result.\n"
    );
    process.exit(1);
  }
  process.stdout.write("Lisa-owned hash ledger is current.\n");
} else {
  writeFileSync(outputPath, rendered);
  process.stdout.write(`Wrote ${ledger.size} ledger entries.\n`);
}
