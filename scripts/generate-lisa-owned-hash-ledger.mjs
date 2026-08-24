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
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { boundedExecFileSync, isChildTimeout } from "./lib/bounded-spawn.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const outputPath = path.join(repoRoot, "src/core/lisa-owned-hash-ledger.ts");
const COPY_OVERWRITE = "copy-overwrite";
const LISA_NAMESPACE_PREFIX = "lisa-";
const ENFORCEMENT_TREE = "scripts/";

/**
 * Run a git command in the repository and return stdout as latin1 text.
 *
 * Blobs are read as `binary` so arbitrary bytes survive the round trip into the
 * Buffer that gets hashed; decoding as UTF-8 would corrupt any non-text file.
 * A KILLED child re-raises. Every caller reads this as content, and an empty
 * string is a perfectly well-formed answer meaning "no files" — so a timeout
 * on the `ls-files` call would build a ledger that vouches for NOTHING and
 * report it as a complete one. A ledger's whole job is to vouch for bytes; one
 * assembled from silence is worse than none, because it looks authoritative.
 * @param {readonly string[]} args - Arguments passed to git
 * @returns {string} Command stdout, or an empty string when git said nothing
 * @throws {Error} When the child was killed at its deadline
 */
function git(args) {
  try {
    return boundedExecFileSync("git", args, {
      cwd: repoRoot,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString("binary");
  } catch (error) {
    if (isChildTimeout(error)) throw error;
    return "";
  }
}

/**
 * Whether a destination path sits in the territory Lisa owns outright.
 *
 * Mirrors `isLisaOwnedTemplate` in `src/core/lisa-owned-templates.ts`. The
 * duplication is deliberate — this script runs before the TypeScript build, so
 * it cannot import the compiled module — and a test asserts the two agree.
 *
 * This is also the ledger's boundary, and it is inherited rather than chosen:
 * whatever refresh acts on is what provenance has to be able to judge. That is
 * why the two widened together in CodySwannGT/lisa#2551. This function's earlier
 * self predicted it — "widening enrolment is this one function" — and the note
 * is worth keeping, because the direction of the dependency is the load-bearing
 * part: enrolment must never lag the predicate. `classifyHostCopy` returns
 * `unenrolled` for a path it has no hashes for, and refresh reads that as
 * permission to overwrite, so a file the predicate newly owns but the ledger has
 * not recorded is not merely unprotected — it is clobbered on the next apply.
 * A test asserts the containment in that direction so the two cannot drift.
 * @param {string} destination - Repo-relative destination path
 * @returns {boolean} True when Lisa owns the file outright
 */
function isLisaOwned(destination) {
  return (
    destination.startsWith(ENFORCEMENT_TREE) ||
    destination
      .split("/")
      .some(segment => segment.startsWith(LISA_NAMESPACE_PREFIX))
  );
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
 * The bytes currently on disk for a tracked source.
 *
 * Read from the working tree rather than `HEAD:` so an author who edits a guard
 * and regenerates gets *their* new hash recorded. Reading HEAD would record the
 * pre-edit bytes and force a commit-then-regenerate-then-amend dance, and the
 * `--check` gate would be asserting against a version nobody is shipping. In CI
 * the working tree is the checked-out commit, so the two agree there.
 * @param {string} source - Repo-relative source path
 * @returns {Buffer|undefined} File contents, or undefined when unreadable
 */
function workingCopy(source) {
  try {
    return readFileSync(path.join(repoRoot, source));
  } catch {
    return undefined;
  }
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
  const current = workingCopy(source);
  if (current !== undefined) hashes.push(digest(current));

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
  // The ledger grows by one line per published hash, so it crosses the
  // 300-line max-lines budget once enough artifacts accumulate - which it
  // now has, at 42 destinations. A length limit is a readability rule for
  // code humans maintain, and nobody maintains this file; the sibling
  // manifest generator has emitted the same disable since it was written.
  // Emitted by the generator rather than added by hand, because a hand-edit
  // here is lost on the next regeneration.
  return `/* eslint-disable max-lines -- generated append-only hash ledger */
/** Generated by scripts/generate-lisa-owned-hash-ledger.mjs. Do not edit. */

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
/* eslint-enable max-lines -- end generated append-only hash ledger */
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

if (process.argv.includes("--check")) {
  checkCurrentBytesAreRecorded();
} else {
  writeFileSync(outputPath, render(ledger));
  process.stdout.write(`Wrote ${ledger.size} ledger entries.\n`);
}

/**
 * Assert the one property that actually protects refresh: every Lisa-owned file
 * Lisa ships *right now* has its current hash recorded.
 *
 * Deliberately narrower than "the file equals a fresh regeneration". That
 * stricter form looks safer and is not: the history walk depends on clone depth
 * and on merge topology, so a byte-exact check fails whenever CI's view of
 * history differs from the author's. It did exactly that here — `autoupdate`
 * merged `main` into the PR branch, main carried other merged template changes,
 * the walk found hashes the author's run never saw, and a correct ledger was
 * reported out of date. With many PRs in flight it would mean every merge
 * reddens every other open PR.
 *
 * Historical hashes appearing later are purely additive, and being additive they
 * cannot cause harm: an extra known-good hash can only let refresh replace a
 * copy that genuinely came from an older Lisa. What must never happen is the
 * *current* bytes going unrecorded — a guard edited without regenerating would
 * stop being recognised as Lisa's own, and refresh would silently stop
 * delivering it. That is the failure this gate exists to catch, and it is
 * deterministic everywhere.
 */
function checkCurrentBytesAreRecorded() {
  const recorded = existingLedger();
  const missing = [];
  for (const [destination, sources] of lisaOwnedSources()) {
    const known = new Set(recorded.get(destination) ?? []);
    for (const source of sources) {
      const current = workingCopy(source);
      if (current === undefined) continue;
      if (!known.has(digest(current))) missing.push(source);
    }
  }
  if (missing.length > 0) {
    process.stderr.write(
      `Lisa-owned hash ledger does not record the bytes currently shipped for:\n${missing
        .map(source => `  ${source}`)
        .join(
          "\n"
        )}\nRun \`bun run build:lisa-owned-hash-ledger\` and commit the result.\n`
    );
    process.exit(1);
  }
  process.stdout.write(
    `Lisa-owned hash ledger records every shipped artifact (${recorded.size} entries).\n`
  );
}
