#!/usr/bin/env node
/**
 * Generate the ledger of every content hash Lisa has ever shipped at each
 * Lisa-owned destination path.
 *
 * Refresh uses it to tell a host copy that is *behind* Lisa (its bytes are some
 * past Lisa release, so overwriting is correct) from one that is *ahead* (its
 * bytes match no Lisa release, so overwriting would delete downstream work).
 *
 * Three properties are load-bearing:
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
 * - **Every digest says where it came from.** Two sources feed the ledger: the
 *   `git log --follow` walk in {@link historicalHashes}, and carry-forward of
 *   whatever is already checked in. Before CodySwannGT/lisa#3115 the two were
 *   indistinguishable once written, so settling "should this line be here?" for
 *   a single digest cost a per-digest excavation — 10 reachable revisions and
 *   14 reflog entries checked, then a delete-and-regenerate to find out which
 *   source had produced it. `LISA_OWNED_HASH_HISTORY_DERIVED` answers that in
 *   one lookup, and this generator reports every digest it kept without being
 *   able to derive it.
 *
 * ## Why provenance is a second append-only set, not a label per digest
 *
 * Whether *this* clone can derive a digest depends on clone depth and merge
 * topology — the same instability that stops the `--check` gate being a
 * byte-exact regeneration check. So the recorded fact is deliberately weaker
 * and stable: **some run of this generator derived this digest from history**.
 * Once true it stays true, exactly like the ledger itself, so a shallower clone
 * downgrades nothing and a deeper one only ever adds.
 *
 * It also has to survive the merge driver added in CodySwannGT/lisa#3084, which
 * unions array-valued entries **line by line** at one indent. A per-digest label
 * written into the entry line would make the same hash render differently on two
 * branches: the union would keep both spellings, and the base check would see an
 * element that vanished — a permanent conflict on the very file that driver
 * exists to stop conflicting. A second block of the same shape merges pointwise
 * exactly like the first one does.
 * @module scripts/generate-lisa-owned-hash-ledger
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { boundedExecFileSync, isChildTimeout } from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/** Repository this generator runs against when no root is supplied. */
export const DEFAULT_REPO_ROOT = path.resolve(import.meta.dirname, "..");

/** Repo-relative path of the generated ledger module. */
export const LEDGER_RELATIVE_PATH = "src/core/lisa-owned-hash-ledger.ts";

/** Name of the record holding every hash ever shipped at a destination. */
export const LEDGER_EXPORT = "LISA_OWNED_HASH_LEDGER";

/** Name of the record holding the digests the history walk attested. */
export const HISTORY_EXPORT = "LISA_OWNED_HASH_HISTORY_DERIVED";

/** The command that rebuilds this artifact, quoted in every diagnostic. */
const REGENERATE = "bun run build:lisa-owned-hash-ledger";

/**
 * How many carried-forward digests the report names before it summarises.
 *
 * The count is the headline and is never truncated; the list is a courtesy. It
 * runs on every commit that touches a template, and a wall of hashes is how a
 * report teaches its reader to scroll past it — measured at 89 carried-forward
 * digests on `main` when this was written. Anyone chasing one digest reads the
 * artifact, where the answer is a single lookup; the remainder line says
 * exactly how.
 */
const REPORT_LIST_LIMIT = 25;

const COPY_OVERWRITE = "copy-overwrite";
const LISA_NAMESPACE_PREFIX = "lisa-";
const ENFORCEMENT_TREE = "scripts/";

/**
 * Compare two strings the way both this generator and the merge driver sort.
 *
 * Spelled out rather than left to a bare `.sort()`: the default comparator
 * stringifies and compares by UTF-16 code unit, which is the same answer here
 * and a SonarCloud finding everywhere.
 * @param {string} left - First value
 * @param {string} right - Second value
 * @returns {number} Negative, zero, or positive per the comparator contract
 */
function byText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * A set of hashes as the sorted array the ledger renders.
 * @param {Iterable<string>} hashes - Hashes in any order
 * @returns {string[]} Sorted hashes
 */
function sorted(hashes) {
  return [...hashes].sort(byText);
}

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
 * @param {string} root - Repository root
 * @param {readonly string[]} args - Arguments passed to git
 * @returns {string} Command stdout, or an empty string when git said nothing
 * @throws {Error} When the child was killed at its deadline
 */
function git(root, args) {
  try {
    return boundedExecFileSync("git", args, {
      cwd: root,
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
export function isLisaOwned(destination) {
  return (
    destination.startsWith(ENFORCEMENT_TREE) ||
    destination
      .split("/")
      .some(segment => segment.startsWith(LISA_NAMESPACE_PREFIX))
  );
}

/**
 * Every tracked copy-overwrite source that installs a Lisa-owned file.
 * @param {string} root - Repository root
 * @returns {Map<string, string[]>} Destination path to the source paths producing it
 */
function lisaOwnedSources(root) {
  const byDestination = new Map();
  const marker = `/${COPY_OVERWRITE}/`;
  for (const tracked of git(root, ["ls-files"]).split("\n")) {
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
 * @param {string} root - Repository root
 * @param {string} source - Repo-relative source path
 * @returns {Buffer|undefined} File contents, or undefined when unreadable
 */
function workingCopy(root, source) {
  try {
    return readFileSync(path.join(root, source));
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
 *
 * Everything this returns is *derived*: the working tree and this clone's own
 * history are both things the current checkout can show a reader on demand.
 * That is what makes it the right feed for the history-derived record.
 * @param {string} root - Repository root
 * @param {string} source - Repo-relative source path
 * @returns {string[]} Hashes of every historical revision plus the checked-in copy
 */
function historicalHashes(root, source) {
  const hashes = [];
  const current = workingCopy(root, source);
  if (current !== undefined) hashes.push(digest(current));

  // `--name-only` is what makes rename-following actually work. Asking for the
  // commit list alone and then reading `<rev>:<source>` fails for every revision
  // before a rename, because the file did not live at that path yet — the very
  // revisions a long-installed host is most likely to be running.
  const log = git(root, [
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
    const blob = git(root, ["show", `${revision}:${line}`]);
    if (blob !== "") hashes.push(digest(Buffer.from(blob, "binary")));
  }
  return hashes;
}

/**
 * The source text of one exported record, or undefined when it is not there.
 *
 * Sliced by export rather than matched across the whole file, because the two
 * records share a shape: a file-wide regex would fold the second block's entries
 * over the first block's under the same key, and the ledger would silently
 * become whichever block happened to be rendered last.
 * @param {string} text - Whole module source
 * @param {string} name - Exported constant name
 * @returns {string|undefined} The declaration's source, when present
 */
function sectionSource(text, name) {
  const start = text.indexOf(`export const ${name}`);
  if (start === -1) return undefined;
  const end = text.indexOf("\n});", start);
  if (end === -1) return undefined;
  return text.slice(start, end);
}

/**
 * Parse one `destination -> hashes` record out of the module source.
 * @param {string} text - Whole module source
 * @param {string} name - Exported constant name
 * @returns {Map<string, string[]>|undefined} Recorded hashes, when the block exists
 */
export function parseSection(text, name) {
  const source = sectionSource(text, name);
  if (source === undefined) return undefined;
  const parsed = new Map();
  const entry = /"([^"]+)": Object\.freeze\(\[([^\]]*)\]\)/g;
  for (const match of source.matchAll(entry)) {
    parsed.set(
      match[1],
      [...match[2].matchAll(/"([0-9a-f]{64})"/g)].map(hash => hash[1])
    );
  }
  return parsed;
}

/**
 * Read the checked-in ledger and split it into its two records.
 *
 * `present` is deliberately not folded into "the maps came back empty". Those
 * are the same value to a caller that only looks at the maps, and the difference
 * decides whether a check is entitled to report all-clear at all.
 * @param {string} root - Repository root
 * @returns {{present: boolean, ledger: (Map<string, string[]>|undefined), historyDerived: (Map<string, string[]>|undefined)}} Parsed records
 */
export function readLedgerSections(root) {
  let text = "";
  try {
    text = readFileSync(path.join(root, LEDGER_RELATIVE_PATH), "utf8");
  } catch {
    return { present: false, ledger: undefined, historyDerived: undefined };
  }
  return {
    present: true,
    ledger: parseSection(text, LEDGER_EXPORT),
    historyDerived: parseSection(text, HISTORY_EXPORT),
  };
}

/**
 * Render one record's `destination: Object.freeze([...])` entries.
 *
 * Indentation matches what Prettier produces. `lint-staged` reformats every
 * staged file, so a generator whose output Prettier would reindent leaves
 * `--check` failing immediately after the commit that regenerated it.
 *
 * A destination with no hashes is dropped rather than rendered as an empty
 * array: an empty entry parses back as a destination the ledger vouches for
 * nothing at, which reads exactly like a destination whose hashes were lost.
 * @param {Map<string, string[]>} entries - Destination path to hashes
 * @returns {string} Rendered entry lines
 */
function renderEntries(entries) {
  return [...entries.entries()]
    .filter(([, hashes]) => hashes.length > 0)
    .sort(([left], [right]) => byText(left, right))
    .map(([destination, hashes]) => {
      const rendered = hashes.map(hash => `    "${hash}",`).join("\n");
      return `  "${destination}": Object.freeze([\n${rendered}\n  ]),`;
    })
    .join("\n");
}

/**
 * Render the ledger module.
 * @param {Map<string, string[]>} ledger - Destination path to known-good hashes
 * @param {Map<string, string[]>} historyDerived - Destination path to history-attested hashes
 * @returns {string} TypeScript module source
 */
export function render(ledger, historyDerived) {
  const entries = renderEntries(ledger);
  const attested = renderEntries(historyDerived);
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
export const ${LEDGER_EXPORT}: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
${entries}
});

/**
 * The subset of the ledger some run of the generator derived from git history.
 *
 * Provenance, in one lookup (CodySwannGT/lisa#3115). A digest recorded here was
 * produced by the \`git log --follow\` walk, or by the bytes in the working tree,
 * at the time it was recorded. A digest in the ledger and NOT here was **carried
 * forward** from an earlier checked-in ledger, and no run of the generator has
 * been able to derive it since.
 *
 * Carried-forward digests are kept, never pruned. The history walk depends on
 * clone depth and merge topology, so "this clone cannot see it" is not evidence
 * that Lisa never shipped it, and dropping one would permanently stop refresh
 * recognising a genuinely older host copy. They are *reported* instead — by
 * \`${REGENERATE}\` and by its \`--check\` mode — so the question is answerable
 * without archaeology.
 */
export const ${HISTORY_EXPORT}: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
${attested}
});
/* eslint-enable max-lines -- end generated append-only hash ledger */
`;
}

/**
 * Split a ledger into digests history attests and digests only carried forward.
 *
 * `orphans` are digests recorded as history-derived that the ledger itself does
 * not record. Generation cannot produce one — the ledger is a superset of the
 * history-derived record by construction — so an orphan means the file was
 * hand-edited, and a provenance record vouching for digests the ledger does not
 * hold is worse than no provenance at all.
 * @param {Map<string, string[]>} ledger - Every recorded digest per destination
 * @param {Map<string, string[]>} historyDerived - History-attested digests per destination
 * @returns {{digests: number, carriedForward: {destination: string, hash: string}[], orphans: {destination: string, hash: string}[]}} Classification
 */
export function classifyProvenance(ledger, historyDerived) {
  const carriedForward = [];
  const orphans = [];
  let digests = 0;
  for (const [destination, hashes] of ledger) {
    const derived = new Set(historyDerived.get(destination) ?? []);
    digests += hashes.length;
    for (const hash of hashes) {
      if (!derived.has(hash)) carriedForward.push({ destination, hash });
    }
  }
  for (const [destination, hashes] of historyDerived) {
    const recorded = new Set(ledger.get(destination) ?? []);
    for (const hash of hashes) {
      if (!recorded.has(hash)) orphans.push({ destination, hash });
    }
  }
  return { digests, carriedForward, orphans };
}

/**
 * One `  <destination> <hash>` line per digest.
 * @param {{destination: string, hash: string}[]} digests - Digests to list
 * @returns {string} Indented lines
 */
function formatDigests(digests) {
  return digests
    .map(({ destination, hash }) => `  ${destination} ${hash}`)
    .join("\n");
}

/**
 * The provenance report, or the reason this run may not report anything.
 *
 * An inspection that saw nothing and a ledger with nothing wrong produce the
 * same silence, so every way of seeing nothing is a failure here: an unreadable
 * ledger, a missing provenance record, no sources to inspect, no digests
 * recorded. Reporting all-clear from any of those is the failure mode this
 * whole gate exists to remove, one level up.
 * @param {{ledgerPresent: boolean, ledger: (Map<string, string[]>|undefined), historyDerived: (Map<string, string[]>|undefined), sourceCount: number}} inspection - What the run managed to read
 * @returns {{ok: true, digests: number, carriedForward: {destination: string, hash: string}[]}|{ok: false, reason: string}} Report or refusal
 */
export function provenanceVerdict(inspection) {
  const { ledgerPresent, ledger, historyDerived, sourceCount } = inspection;
  if (!ledgerPresent || ledger === undefined) {
    return {
      ok: false,
      reason: `could not read ${LEDGER_RELATIVE_PATH}; refusing to report on a ledger it never saw`,
    };
  }
  if (historyDerived === undefined) {
    return {
      ok: false,
      reason: `${LEDGER_RELATIVE_PATH} records no digest provenance (no ${HISTORY_EXPORT})`,
    };
  }
  if (sourceCount === 0) {
    return {
      ok: false,
      reason:
        "found no Lisa-owned copy-overwrite sources; a run that inspected nothing cannot report all-clear",
    };
  }
  const { digests, carriedForward, orphans } = classifyProvenance(
    ledger,
    historyDerived
  );
  if (digests === 0) {
    return {
      ok: false,
      reason: `${LEDGER_RELATIVE_PATH} records zero digests; a run that inspected nothing cannot report all-clear`,
    };
  }
  if (orphans.length > 0) {
    return {
      ok: false,
      reason: `${HISTORY_EXPORT} vouches for digests ${LEDGER_EXPORT} does not record:\n${formatDigests(orphans)}`,
    };
  }
  return { ok: true, digests, carriedForward };
}

/**
 * The provenance summary both modes print.
 *
 * The carried-forward list is a REPORT, not a finding: it names what the run
 * kept without being able to derive it, which is the cheap answer to the
 * question that previously cost a per-digest excavation. It never removes
 * anything and never fails a run.
 * @param {{digests: number, carriedForward: {destination: string, hash: string}[]}} report - A successful verdict
 * @returns {string} Summary text, newline-terminated
 */
export function formatProvenanceReport(report) {
  const carried = report.carriedForward.length;
  const summary = `Digest provenance: ${report.digests - carried} of ${report.digests} derived from this repository's history, ${carried} carried forward only.\n`;
  if (carried === 0) return summary;
  const listed = report.carriedForward.slice(0, REPORT_LIST_LIMIT);
  const remainder =
    carried > listed.length
      ? `  ... and ${carried - listed.length} more: every digest in ${LEDGER_EXPORT} that ${HISTORY_EXPORT} does not list for the same destination.\n`
      : "";
  return `${summary}Carried forward and KEPT — no run has derived these from history, which is expected under a shallower clone and is not on its own evidence of a stray entry:\n${formatDigests(
    listed
  )}\n${remainder}`;
}

/**
 * Union the history walk and the checked-in ledger into the artifact to write.
 *
 * Both records are accumulators. The history-derived record is unioned forward
 * exactly like the ledger, so a shallow clone that derives less than a deep one
 * downgrades no digest's provenance — it simply adds nothing.
 * @param {string} root - Repository root
 * @returns {{ledger: Map<string, string[]>, historyDerived: Map<string, string[]>, sourceCount: number, ledgerPresent: boolean}} The ledger to render
 */
export function buildLedger(root) {
  const existing = readLedgerSections(root);
  const sources = lisaOwnedSources(root);
  const historyDerived = new Map(existing.historyDerived ?? []);
  for (const [destination, paths] of sources) {
    const known = new Set(historyDerived.get(destination) ?? []);
    for (const source of paths) {
      for (const hash of historicalHashes(root, source)) known.add(hash);
    }
    historyDerived.set(destination, sorted(known));
  }
  const ledger = new Map(existing.ledger ?? []);
  for (const [destination, hashes] of historyDerived) {
    const known = new Set(ledger.get(destination) ?? []);
    for (const hash of hashes) known.add(hash);
    ledger.set(destination, sorted(known));
  }
  return {
    ledger,
    historyDerived,
    sourceCount: sources.size,
    ledgerPresent: existing.present,
  };
}

/**
 * Regenerate the ledger and report what it kept without being able to derive.
 * @param {string} root - Repository root
 * @param {(message: string) => void} out - Sink for the report
 * @param {(message: string) => void} error - Sink for diagnostics
 * @returns {number} Process exit code
 */
export function runGenerate(root, out, error) {
  const built = buildLedger(root);
  const verdict = provenanceVerdict({
    ledgerPresent: true,
    ledger: built.ledger,
    historyDerived: built.historyDerived,
    sourceCount: built.sourceCount,
  });
  if (!verdict.ok) {
    error(`Refusing to write the Lisa-owned hash ledger: ${verdict.reason}.\n`);
    return 1;
  }
  writeFileSync(
    path.join(root, LEDGER_RELATIVE_PATH),
    render(built.ledger, built.historyDerived)
  );
  out(`Wrote ${built.ledger.size} ledger entries.\n`);
  out(formatProvenanceReport(verdict));
  return 0;
}

/**
 * Sources whose current bytes are absent from a record.
 * @param {string} root - Repository root
 * @param {Map<string, string[]>} sources - Destination to source paths
 * @param {Map<string, string[]>} recorded - Destination to recorded hashes
 * @returns {string[]} Source paths whose shipped bytes are unrecorded
 */
function missingCurrentBytes(root, sources, recorded) {
  const missing = [];
  for (const [destination, paths] of sources) {
    const known = new Set(recorded.get(destination) ?? []);
    for (const source of paths) {
      const current = workingCopy(root, source);
      if (current === undefined) continue;
      if (!known.has(digest(current))) missing.push(source);
    }
  }
  return missing;
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
 *
 * Asserting the same property against the provenance record costs nothing extra
 * and is equally deterministic — shipped bytes are read from the working tree,
 * never walked — and it is what stops provenance going quietly stale while the
 * ledger stays current.
 * @param {string} root - Repository root
 * @param {(message: string) => void} out - Sink for the report
 * @param {(message: string) => void} error - Sink for diagnostics
 * @returns {number} Process exit code
 */
export function runCheck(root, out, error) {
  const existing = readLedgerSections(root);
  const sources = lisaOwnedSources(root);
  const verdict = provenanceVerdict({
    ledgerPresent: existing.present,
    ledger: existing.ledger,
    historyDerived: existing.historyDerived,
    sourceCount: sources.size,
  });
  if (!verdict.ok) {
    error(
      `Lisa-owned hash ledger check could not run: ${verdict.reason}.\nRun \`${REGENERATE}\` and commit the result.\n`
    );
    return 1;
  }
  const missing = [
    ...new Set([
      ...missingCurrentBytes(root, sources, existing.ledger),
      ...missingCurrentBytes(root, sources, existing.historyDerived),
    ]),
  ];
  if (missing.length > 0) {
    error(
      `Lisa-owned hash ledger does not record the bytes currently shipped for:\n${missing
        .map(source => `  ${source}`)
        .join("\n")}\nRun \`${REGENERATE}\` and commit the result.\n`
    );
    return 1;
  }
  out(
    `Lisa-owned hash ledger records every shipped artifact (${existing.ledger.size} entries).\n`
  );
  out(formatProvenanceReport(verdict));
  return 0;
}

/**
 * CLI entry point.
 * @param {readonly string[]} argv - Arguments after the script name
 * @param {string} [root] - Repository root
 * @param {(message: string) => void} [out] - Sink for reports
 * @param {(message: string) => void} [error] - Sink for diagnostics
 * @returns {number} Process exit code
 */
export function runLedgerCli(
  argv,
  root = DEFAULT_REPO_ROOT,
  out = message => process.stdout.write(message),
  error = message => process.stderr.write(message)
) {
  return argv.includes("--check")
    ? runCheck(root, out, error)
    : runGenerate(root, out, error);
}

if (invokedAsScript(import.meta.url)) {
  process.exit(runLedgerCli(process.argv.slice(2)));
}
