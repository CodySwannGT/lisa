#!/usr/bin/env node
/**
 * Git merge driver for Lisa's two checked-in generated artifacts —
 * `src/core/upstream-evidence-manifest.ts` and
 * `src/core/lisa-owned-hash-ledger.ts` (issue CodySwannGT/lisa#3084).
 *
 * ## The problem this exists for
 *
 * Every branch that changes a shipped artifact must regenerate both files, and
 * both are tracked, so **the conflict recurs by construction**: two branches
 * that touch nothing in common still rewrite the same sorted regions and git
 * refuses. Measured on `main` at filing, 27 of the last 40 commits touched
 * them. With a 36–53 minute pre-push gate the branch loses the race it is in,
 * indefinitely, while remaining correct throughout.
 *
 * ## Why this is NOT "a driver picks a side"
 *
 * CodySwannGT/lisa#3046 rejected a merge driver for `readiness.json` on the
 * grounds that a driver can only pick a side, which suppresses a conflict
 * without making either answer right. That objection is sound and it does not
 * reach these two files, for a reason worth stating precisely.
 *
 * Both artifacts are **accumulators over a pointwise function of the tree**:
 *
 *   - every entry is keyed by one path (or one commit sha) and depends on that
 *     key alone — no entry is a function of any other entry;
 *   - entries are only ever added, and the array-valued entries in the hash
 *     ledger are append-only sets that the generator itself unions forward from
 *     whatever is already checked in (`existingLedger()`).
 *
 * For a pointwise function, **a pointwise 3-way merge of the OUTPUT equals the
 * function applied to the merged INPUT**. If a key changed on our side only,
 * the merged tree has our version of the file it describes, so our entry is the
 * right one; symmetrically for theirs; if both sides changed the same key
 * differently, the merged tree has a file that neither side described, and this
 * driver conflicts rather than inventing an answer. So the result is not one
 * side's blob — it is a reconstruction of what regeneration would produce.
 *
 * ## Why the driver cannot simply run the generators
 *
 * Measured (git 2.53.0, `ort` strategy): **inside a merge driver the working
 * tree and the index are still pre-merge.** A probe driver that read a sibling
 * file saw HEAD's bytes, `git ls-files -s` listed stage-0 HEAD entries, and
 * `.git/MERGE_HEAD` did not exist yet — merge-ort computes the whole merge in
 * memory and writes it out only after every content merge has returned. A
 * driver that shelled out to `generate-*.mjs` would therefore regenerate
 * against HEAD and produce, byte for byte, **ours** — picking a side while
 * looking like it regenerated. That is the failure mode #3046 warned about,
 * reached by the route that looks most like the fix.
 *
 * ## Why the artifacts cannot simply be untracked
 *
 * The ticket's own preferred direction — generate at build time, stop tracking
 * the bytes — does not survive contact with either generator. Both carry state
 * that is NOT derivable from the tree: the manifest's `UPSTREAM_PUBLIC_COMMITS`
 * is seeded from the checked-in file and only ever extended (the generator
 * refuses to emit an empty one), and the hash ledger is explicitly append-only
 * across history so that a shallow clone yields fewer new hashes rather than
 * losing known-good ones. They are accumulators, not pure derivations. That is
 * also precisely why union-forward is their correct merge semantics.
 *
 * ## How it works
 *
 * The file is segmented into literal TEXT runs and ENTRIES blocks (a run of
 * `<key>: <value>` lines at one indent, each absorbing its own continuation
 * lines). Entry bodies are carried as **raw source text**, never re-rendered
 * from a parsed model, so this driver has no opinion about either generator's
 * output format and cannot drift from it. Merged entries are re-emitted sorted
 * by unquoted key, which is exactly the order both generators emit.
 *
 * Anything the driver does not fully understand — a differing block shape, a
 * key both sides changed, an array entry that lost elements on one side —
 * exits non-zero and lets git record a conflict. Silence is never chosen over a
 * conflict.
 *
 * ## Registration
 *
 * The `.gitattributes` mapping is committed; the driver COMMAND is machine-
 * local, because git refuses to run a command a repository supplies. An
 * unregistered checkout falls back to git's built-in text merge — today's
 * behaviour exactly, conflict markers and all — so it is degraded, never
 * broken. `scripts/install-generated-artifact-merge-driver.mjs` registers it
 * from Lisa's own `postinstall`, and `lisa doctor` reports any mapping whose
 * driver is unregistered.
 *
 * CLI (git substitutes the placeholders):
 *   node scripts/merge-generated-artifact.mjs --base %O --ours %A --theirs %B --path %P
 *
 * Exit codes:
 *   0 — merged cleanly; the result was written over the `--ours` file.
 *   1 — conflict. `--ours` is left untouched (a parseable artifact plus a
 *       precise stderr reason beats a corrupted one; both sides remain in the
 *       index at stages 2 and 3), and git records the path as unmerged.
 *   2 — usage error.
 *
 * @module scripts/merge-generated-artifact
 */
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * Identity standing for "this side does not have this thing at all".
 *
 * Written as the `\u0000` escape, never as a raw NUL byte: a raw NUL makes the
 * whole file invisible to recursive `grep`/`rg`, and a guard in
 * `tests/integration/tracked-source-nul-bytes.test.ts` refuses one. The runtime
 * string is identical. NUL is the right VALUE because no entry body or text run
 * can ever contain it, so absence can never collide with real content.
 */
const ABSENT = "\u0000absent";

/** Matches an entry line: indented `"quoted key":` or `bareKey:`. */
const ENTRY_LINE = /^(\s+)("(?:[^"\\]|\\.)*"|[A-Za-z_$][\w$]*)\s*:/u;

/** Header of an append-only array entry, e.g. `"dest": Object.freeze([`. */
const ARRAY_OPEN = /Object\.freeze\(\[\s*$/u;

/**
 * Compare two keys the way both generators sort theirs.
 *
 * Both call `.sort()` (or `left < right`) on the RAW path or sha, before the
 * key is quoted for emission. Sorting on the rendered token instead would
 * reorder the commit block, where `formatObjectKey` leaves a sha starting with
 * a letter bare and quotes one starting with a digit.
 * @param {string} left - First unquoted key
 * @param {string} right - Second unquoted key
 * @returns {number} Negative, zero, or positive per the usual comparator contract
 */
function compareKeys(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Strip the quoting `formatObjectKey` applied, so keys sort as the generator
 * sorted them.
 * @param {string} token - Key token exactly as it appears in the source
 * @returns {string} The underlying path or sha
 */
function unquoteKey(token) {
  if (!token.startsWith('"')) return token;
  try {
    return JSON.parse(token);
  } catch {
    return token;
  }
}

/**
 * Whether a non-entry line continues the entry above it.
 * @param {string} line - Source line
 * @param {string} indent - Indentation shared by the block's entry lines
 * @returns {boolean} True when the line belongs to the preceding entry
 */
function isContinuation(line, indent) {
  if (line.trim() === "" || !line.startsWith(indent)) return false;
  return (
    /^\s/u.test(line.slice(indent.length)) || line.trimStart().startsWith("])")
  );
}

/**
 * Segment one artifact into literal text runs and entry blocks.
 *
 * Entry bodies keep their exact source lines. A block whose entries are not all
 * at one indent is refused rather than guessed at: a mis-segmented block would
 * merge plausible-looking garbage.
 * @param {string} text - Whole file contents
 * @returns {{ok: true, chunks: object[]} | {ok: false, reason: string}} Parse result
 */
export function parseArtifact(text) {
  const lines = text.split("\n");
  const chunks = [];
  let pending = [];
  let block = null;
  const flushText = () => {
    if (pending.length > 0) {
      chunks.push({ kind: "text", text: pending.join("\n") });
      pending = [];
    }
  };
  const flushBlock = () => {
    if (block !== null) {
      chunks.push({
        kind: "entries",
        indent: block.indent,
        entries: block.map,
      });
      block = null;
    }
  };
  for (const line of lines) {
    const match = ENTRY_LINE.exec(line);
    if (match === null) {
      // A continuation line belongs to the entry above it; anything else after
      // a block has ended is ordinary text. "More indented, or the `])` that
      // closes an array-valued entry" is the whole rule — and the second half
      // is load-bearing in the other direction too: the line that CLOSES the
      // block (`  });`) sits at the entry indent, so a rule of merely
      // "starts with the indent" would swallow it into the last entry and then
      // re-emit it wherever that entry happened to sort.
      if (block !== null && isContinuation(line, block.indent)) {
        block.map.get(block.last).push(line);
        continue;
      }
      flushBlock();
      pending.push(line);
      continue;
    }
    const indent = match[1];
    const key = unquoteKey(match[2]);
    if (block !== null && block.indent !== indent) {
      return {
        ok: false,
        reason: `mixed indentation in an entry block near ${key}`,
      };
    }
    if (block === null) {
      flushText();
      block = { indent, map: new Map(), last: "" };
    }
    if (block.map.has(key)) {
      return { ok: false, reason: `duplicate key ${key}` };
    }
    block.map.set(key, [line]);
    block.last = key;
  }
  flushBlock();
  flushText();
  return { ok: true, chunks };
}

/**
 * Re-emit a parsed artifact.
 *
 * Entry text is replayed verbatim, so this is the identity on any file that
 * parsed — asserted by a round-trip test against the real checked-in artifacts,
 * which is what stops this driver drifting from the generators' formatting.
 * @param {object[]} chunks - Parsed segments
 * @returns {string} File contents
 */
export function renderArtifact(chunks) {
  return chunks
    .map(chunk =>
      chunk.kind === "text"
        ? chunk.text
        : [...chunk.entries.keys()]
            .sort(compareKeys)
            .flatMap(key => chunk.entries.get(key))
            .join("\n")
    )
    .join("\n");
}

/**
 * Split an append-only array entry into its header, element lines, and footer.
 * @param {string[]} lines - Raw entry lines
 * @returns {{head: string, items: string[], tail: string[]} | undefined} Parts, when the entry is an array
 */
function splitArrayEntry(lines) {
  if (lines.length < 3 || !ARRAY_OPEN.test(lines[0])) return undefined;
  const closeAt = lines.findIndex(line => /^\s*\]\)/u.test(line));
  if (closeAt < 1) return undefined;
  return {
    head: lines[0],
    items: lines.slice(1, closeAt),
    tail: lines.slice(closeAt),
  };
}

/**
 * Union two append-only array entries that both grew from the same base.
 *
 * Only applies when neither side REMOVED an element. Append-only is the ledger
 * generator's own invariant — losing a hash permanently reclassifies a stale
 * host copy as host-modified — so a side that dropped one is not an append and
 * must not be merged silently.
 * @param {string[] | undefined} base - Merge-base entry lines
 * @param {string[]} ours - Our entry lines
 * @param {string[]} theirs - Their entry lines
 * @returns {string[] | undefined} Unioned entry lines, when the union is sound
 */
function unionArrayEntry(base, ours, theirs) {
  const left = splitArrayEntry(ours);
  const right = splitArrayEntry(theirs);
  if (left === undefined || right === undefined) return undefined;
  if (
    left.head !== right.head ||
    left.tail.join("\n") !== right.tail.join("\n")
  ) {
    return undefined;
  }
  const ourItems = new Set(left.items);
  const theirItems = new Set(right.items);
  if (base !== undefined) {
    const parts = splitArrayEntry(base);
    if (parts === undefined) return undefined;
    for (const item of parts.items) {
      if (!ourItems.has(item) || !theirItems.has(item)) return undefined;
    }
  }
  const merged = [...new Set([...left.items, ...right.items])].sort(
    compareKeys
  );
  return [left.head, ...merged, ...left.tail];
}

/**
 * Three-way merge of one value that may be absent on any side.
 *
 * `hasBase` is separate from `base === undefined` on purpose, and conflating
 * the two is a bug this driver shipped for exactly one test run: a key that one
 * branch ADDED is absent from the base, which is a perfectly good base value
 * ("this key did not exist") and the single most common case here. Reading that
 * absence as "there is no merge base" turned every ordinary one-sided addition
 * into a conflict — the precise thing the driver exists to stop.
 * @param {boolean} hasBase - Whether merge-base information exists at all
 * @param {T | undefined} base - Merge-base value, undefined when genuinely absent there
 * @param {T | undefined} ours - Our value
 * @param {T | undefined} theirs - Their value
 * @param {(value: T | undefined) => string} key - Stable identity for comparison
 * @returns {{ok: true, value: T | undefined} | {ok: false}} Merged value, or a conflict
 * @template T
 */
function mergeSide(hasBase, base, ours, theirs, key) {
  if (key(ours) === key(theirs)) return { ok: true, value: ours };
  if (hasBase && key(ours) === key(base)) return { ok: true, value: theirs };
  if (hasBase && key(theirs) === key(base)) return { ok: true, value: ours };
  return { ok: false };
}

/** Identity of an entry body (or its absence) for three-way comparison. */
const entryKey = lines => (lines === undefined ? ABSENT : lines.join("\n"));

/**
 * Merge one entries block.
 * @param {Map<string, string[]> | undefined} base - Merge-base entries
 * @param {Map<string, string[]>} ours - Our entries
 * @param {Map<string, string[]>} theirs - Their entries
 * @returns {{ok: true, entries: Map<string, string[]>} | {ok: false, reason: string}} Merged block
 */
function mergeEntries(base, ours, theirs) {
  const merged = new Map();
  const keys = [
    ...new Set([...(base?.keys() ?? []), ...ours.keys(), ...theirs.keys()]),
  ];
  for (const name of keys.sort(compareKeys)) {
    const b = base?.get(name);
    const o = ours.get(name);
    const t = theirs.get(name);
    const straight = mergeSide(base !== undefined, b, o, t, entryKey);
    if (straight.ok) {
      if (straight.value !== undefined) merged.set(name, straight.value);
      continue;
    }
    const unioned =
      o !== undefined && t !== undefined ? unionArrayEntry(b, o, t) : undefined;
    if (unioned === undefined) {
      return {
        ok: false,
        reason: `both sides changed the entry for ${name} in incompatible ways`,
      };
    }
    merged.set(name, unioned);
  }
  return { ok: true, entries: merged };
}

/**
 * Merge three versions of one generated artifact.
 *
 * An empty merge base means the file was created independently on both sides;
 * the merge then degrades to add/add, where only identical or disjoint content
 * can merge.
 * @param {string} base - `%O` contents ("" when the file is new on both sides)
 * @param {string} ours - `%A` contents
 * @param {string} theirs - `%B` contents
 * @returns {{ok: true, text: string} | {ok: false, reason: string}} Merge result
 */
export function mergeGeneratedArtifact(base, ours, theirs) {
  const parsedOurs = parseArtifact(ours);
  const parsedTheirs = parseArtifact(theirs);
  if (!parsedOurs.ok)
    return { ok: false, reason: `ours: ${parsedOurs.reason}` };
  if (!parsedTheirs.ok)
    return { ok: false, reason: `theirs: ${parsedTheirs.reason}` };
  let parsedBase;
  if (base !== "") {
    const attempt = parseArtifact(base);
    if (!attempt.ok) return { ok: false, reason: `base: ${attempt.reason}` };
    parsedBase = attempt.chunks;
  }
  const shape = chunks => chunks.map(chunk => chunk.kind).join(",");
  if (shape(parsedOurs.chunks) !== shape(parsedTheirs.chunks)) {
    return {
      ok: false,
      reason: "the two sides have different block structures",
    };
  }
  if (
    parsedBase !== undefined &&
    shape(parsedBase) !== shape(parsedOurs.chunks)
  ) {
    parsedBase = undefined;
  }
  const merged = [];
  for (const [index, ourChunk] of parsedOurs.chunks.entries()) {
    const theirChunk = parsedTheirs.chunks[index];
    const baseChunk = parsedBase?.[index];
    if (ourChunk.kind === "text") {
      const result = mergeSide(
        baseChunk !== undefined,
        baseChunk?.text,
        ourChunk.text,
        theirChunk.text,
        value => value ?? ABSENT
      );
      if (!result.ok) {
        return {
          ok: false,
          reason: "both sides edited the same non-generated text",
        };
      }
      merged.push({ kind: "text", text: result.value });
      continue;
    }
    const result = mergeEntries(
      baseChunk?.entries,
      ourChunk.entries,
      theirChunk.entries
    );
    if (!result.ok) return result;
    merged.push({
      kind: "entries",
      indent: ourChunk.indent,
      entries: result.entries,
    });
  }
  return { ok: true, text: renderArtifact(merged) };
}

/**
 * Read one merge side, never conflating "unreadable" with "empty".
 *
 * The learnings driver failed OPEN exactly once by collapsing the two: an
 * unreadable base silently became "no base", the merge degraded to two-way, and
 * a superseded entry was resurrected into a CLEAN committed merge. Here the
 * same collapse would drop one side's whole accumulated block.
 * @param {string} file - Path git supplied
 * @returns {{ok: true, content: string} | {ok: false}} Contents, or a read failure
 */
function readSide(file) {
  try {
    return { ok: true, content: readFileSync(file, "utf8") };
  } catch {
    return { ok: false };
  }
}

/**
 * Parse `--flag value` pairs.
 * @param {readonly string[]} argv - Arguments after the script name
 * @returns {Record<string, string>} Flag values
 */
export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!flag.startsWith("--")) continue;
    options[flag.slice(2)] = argv[index + 1] ?? "";
  }
  return options;
}

/**
 * Run the driver against git-supplied side files.
 * @param {readonly string[]} argv - Arguments after the script name
 * @param {(message: string) => void} [error] - Sink for the diagnostic
 * @returns {number} Process exit code
 */
export function runMergeGeneratedArtifact(
  argv,
  error = message => process.stderr.write(message)
) {
  const options = parseArgs(argv);
  const { base, ours, theirs } = options;
  const label = options.path ?? "the generated artifact";
  if (base === undefined || ours === undefined || theirs === undefined) {
    error(
      "merge-generated-artifact: --base, --ours and --theirs are all required\n"
    );
    return 2;
  }
  const sides = [readSide(base), readSide(ours), readSide(theirs)];
  if (sides.some(side => !side.ok)) {
    error(
      `merge-generated-artifact: could not read every side of the merge for ${label}; refusing to merge\n`
    );
    return 1;
  }
  const [baseText, oursText, theirsText] = sides.map(side => side.content);
  const result = mergeGeneratedArtifact(baseText, oursText, theirsText);
  if (!result.ok) {
    error(
      `merge-generated-artifact: ${label} could not be merged mechanically — ${result.reason}.\n` +
        `Both sides are preserved in the index (stages 2 and 3). Resolve by regenerating against the merged tree:\n` +
        `  git checkout --theirs -- ${label} && bun run build:upstream-evidence-manifest && bun run build:lisa-owned-hash-ledger && git add ${label}\n`
    );
    return 1;
  }
  writeFileSync(ours, result.text);
  return 0;
}

if (invokedAsScript(import.meta.url)) {
  process.exit(runMergeGeneratedArtifact(process.argv.slice(2)));
}
