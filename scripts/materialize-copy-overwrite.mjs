#!/usr/bin/env node
/**
 * Copy a Lisa-owned file into a `copy-overwrite/` template tree, stamping the
 * ownership header on the way in.
 *
 * Thirteen `copy-overwrite` assets are not authored where they ship. The build
 * materializes them from `plugins/src/base/hooks/` (the five PreToolUse guards,
 * the Sonar wrapper, the three threshold-ratchet modules into two stack lanes)
 * and from `scripts/lisa-enforcement-fallback.sh` (the dispatcher). A header
 * typed into the shipped copy is erased by the next `bun run build`, which is
 * why those thirteen were the only files #2545 could not correct.
 *
 * The header cannot move upstream to the source either. `plugins/src/base/hooks/
 * block-no-verify.sh` is precisely the file maintainers edit, so telling it that
 * it will be overwritten would be a fresh instance of the false statement #2538
 * exists to remove. So the header becomes a property of the *generation step*:
 * the source stays honest, the shipped copy states its real contract, and the
 * two can never disagree because one produces the other.
 *
 * This matters most on exactly these files. A `copy-overwrite` asset that reads
 * as editable silently loses downstream hardening — a consumer repo hardened its
 * `block-no-verify.sh` and the next sync reverted it, noticed only because two
 * of its own tests started failing.
 * @module scripts/materialize-copy-overwrite
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * The `copy-overwrite` ownership contract, verbatim from the header #2545
 * established. Duplicated nowhere: `tests/unit/templates/
 * template-ownership-header.test.ts` asserts the same two sentences over every
 * template in the lane, and this generator writes them into the thirteen that
 * cannot hold a hand-typed copy.
 */
export const OWNERSHIP_HEADER = [
  "This file is managed by Lisa and IS replaced on each `lisa` run.",
  "Do not edit directly — durable changes belong upstream in Lisa.",
];

/**
 * Line comment syntax per extension, for the formats this generator emits.
 *
 * Deliberately a closed map rather than a default. A file type that is not
 * listed makes `materialize` throw, so wiring a new generated asset through
 * here is a decision someone has to make — the alternative is a silent
 * pass-through that reintroduces the headerless copy this module exists to end.
 *
 * `.py` is here because a guard's dependency does not have to share the guard's
 * language. `parity-safety-net.sh` resolves its heredoc classifier as a sibling
 * of itself, and that classifier is Python; with `.py` absent from this map the
 * companion could not have been materialized even once someone named it, so the
 * closed map was the second of the two extension filters that kept it out of
 * the shipped tree (issue #3483). A `#` comment above a module docstring is a
 * comment, not a statement, so stamping the header leaves `__doc__` intact.
 */
const COMMENT_PREFIX = new Map([
  [".sh", "#"],
  [".bash", "#"],
  [".mjs", "//"],
  [".cjs", "//"],
  [".js", "//"],
  [".py", "#"],
]);

/**
 * The comment prefix a generated file's format uses.
 * @param {string} filePath - Path whose extension selects the syntax.
 * @returns {string | undefined} Prefix, or undefined when unsupported.
 */
export const commentPrefixFor = filePath =>
  COMMENT_PREFIX.get(path.extname(filePath));

/**
 * The header block as it appears in a file of the given comment syntax.
 * @param {string} prefix - Line comment prefix, e.g. `#` or `//`.
 * @returns {string[]} The header lines, ready to splice in.
 */
const headerLines = prefix => OWNERSHIP_HEADER.map(line => `${prefix} ${line}`);

/**
 * Whether contents already state the ownership contract.
 * @param {string} contents - File contents.
 * @returns {boolean} True when every header sentence is present.
 */
export const hasOwnershipHeader = contents =>
  OWNERSHIP_HEADER.every(line => contents.includes(line));

/**
 * Contents with the ownership header stamped in.
 *
 * Placement is not cosmetic: a `#!` line that stops being line 1 stops being a
 * shebang, so the header lands *below* it when one is present. Idempotent, so
 * re-running the build over an already-stamped tree is a no-op rather than a
 * pile of headers.
 * @param {string} contents - Source file contents.
 * @param {string} filePath - Destination path, for its extension.
 * @returns {string} Contents carrying the header.
 * @throws {Error} When the destination's format has no known comment syntax.
 */
export const withOwnershipHeader = (contents, filePath) => {
  const prefix = commentPrefixFor(filePath);
  if (prefix === undefined) {
    throw new Error(
      `No comment syntax known for ${path.basename(filePath)} — a generated ` +
        `copy-overwrite asset must be able to state its ownership contract.`
    );
  }
  if (hasOwnershipHeader(contents)) return contents;

  const lines = contents.split("\n");
  const insertAt = lines[0]?.startsWith("#!") ? 1 : 0;
  return [
    ...lines.slice(0, insertAt),
    ...headerLines(prefix),
    "",
    ...lines.slice(insertAt),
  ].join("\n");
};

/**
 * Contents with the ownership header removed, leaving the authored source.
 *
 * The byte-equality tests that pin a shipped copy to its reviewed original run
 * through here, so "generated file minus its stamp" has exactly one definition
 * and cannot drift from what the stamp step actually writes.
 * @param {string} contents - Generated file contents.
 * @param {string} filePath - Path, for its comment syntax.
 * @returns {string} Contents without the header block.
 */
export const withoutOwnershipHeader = (contents, filePath) => {
  const prefix = commentPrefixFor(filePath);
  if (prefix === undefined) return contents;

  const block = headerLines(prefix);
  const lines = contents.split("\n");
  const at = lines.findIndex(
    (line, index) => line === block[0] && lines[index + 1] === block[1]
  );
  if (at === -1) return contents;

  // The blank separator belongs to the stamp, not to the source, so it comes
  // out with it — otherwise round-tripping would grow a line each build.
  const end =
    lines[at + block.length] === "" ? at + block.length + 1 : at + block.length;
  return [...lines.slice(0, at), ...lines.slice(end)].join("\n");
};

/**
 * Read a source file and write it to a destination carrying the header.
 * @param {string} source - Authored file to materialize.
 * @param {string} destination - Path inside a `copy-overwrite/` tree.
 * @returns {void}
 */
export const materialize = (source, destination) => {
  writeFileSync(
    destination,
    withOwnershipHeader(readFileSync(source, "utf8"), destination)
  );
};

if (invokedAsScript(import.meta.url)) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) {
    console.error(
      "usage: materialize-copy-overwrite.mjs <source> <destination>"
    );
    process.exit(1);
  }
  materialize(source, destination);
}
