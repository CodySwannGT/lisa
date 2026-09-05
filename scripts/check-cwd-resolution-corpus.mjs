#!/usr/bin/env node
/**
 * Refuse a cwd-resolution corpus that cannot bite.
 *
 * Two guards answer "which file will this command actually execute?" in two
 * languages — POSIX shell in `parity-safety-net.sh`, Node in
 * `worktree-binding-guard.mjs` — and one corpus of rows is what keeps their
 * answers the same (CodySwannGT/lisa#3952). That arrangement is only worth
 * anything while the rows are adversarial, and rows decay in one direction: a
 * `holds` row is easy to write and always passes, so a corpus left alone drifts
 * towards proving the resolver RAN rather than that it BITES.
 *
 * So the shape is enforced rather than requested:
 *
 * - both adversarial classes present, because a resolver is wrong in two
 *   directions and one class of row only ever catches one of them
 * - every contract point carried by at least one adversarial row, because a
 *   point pinned only by rows both wrong implementations already pass is
 *   documented rather than pinned
 * - at least one `unknown` expectation, because the fail-closed floor is the
 *   half nobody writes voluntarily
 * - a row that skips a guard must say why, in the row, rather than by omission
 *
 * Exits 1 with the reason on any violation. Report-only otherwise.
 * @module scripts/check-cwd-resolution-corpus
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const CORPUS = path.resolve(
  "tests/unit/hooks/support/cwd-resolution-corpus.json"
);
const GUARDS = ["shell", "node"];
const CONTROLS = ["bites", "wall", "holds"];
/** The classes that fail under a wrong implementation. `holds` does not. */
const ADVERSARIAL = ["bites", "wall"];

/**
 * Read and parse the corpus.
 * @returns The parsed corpus document
 */
function load() {
  return JSON.parse(readFileSync(CORPUS, "utf8"));
}

/**
 * Every id appears once, so a row cannot be silently replaced by a copy.
 * @param rows - Corpus rows
 * @returns Violation messages
 */
function checkIds(rows) {
  const seen = new Set();
  const bad = [];
  for (const row of rows) {
    if (seen.has(row.id)) bad.push(`duplicate row id: ${row.id}`);
    seen.add(row.id);
  }
  return bad;
}

/**
 * Each row declares a known control class and at least one guard it applies to.
 * @param rows - Corpus rows
 * @returns Violation messages
 */
function checkShape(rows) {
  const bad = [];
  for (const row of rows) {
    if (!CONTROLS.includes(row.control)) {
      bad.push(`${row.id}: control must be one of ${CONTROLS.join(", ")}`);
    }
    const applies = row.applies ?? [];
    if (applies.length === 0) bad.push(`${row.id}: applies to no guard`);
    for (const guard of applies) {
      if (!GUARDS.includes(guard))
        bad.push(`${row.id}: unknown guard ${guard}`);
    }
    if (!applies.includes("node") && !row.why_not_node) {
      bad.push(
        `${row.id}: skips the Node guard without saying why. A row that skips a guard by omission is how a gap becomes invisible — add why_not_node.`
      );
    }
  }
  return bad;
}

/**
 * Both control classes are present, and the fail-closed floor is represented.
 * @param rows - Corpus rows
 * @returns Violation messages
 */
function checkControls(rows) {
  const bad = [];
  for (const control of ADVERSARIAL) {
    if (rows.some(row => row.control === control)) continue;
    bad.push(
      control === "bites"
        ? 'no row has control "bites". Nothing here fails under a pre-fix implementation, so the silent direction — a confident verdict about a file nobody was about to run — is unguarded.'
        : 'no row has control "wall". Nothing here fails under an over-eager implementation, so nothing stops the fail-closed floor becoming a wall, and a wall gets switched off.'
    );
  }
  if (!rows.some(row => row.expect === "unknown")) {
    bad.push(
      'no row expects "unknown". The fail-closed floor is the half nobody writes voluntarily, so it is required.'
    );
  }
  return bad;
}

/**
 * Every contract point is carried by at least one row that a pre-fix
 * implementation would fail.
 * @param contract - Contract points, keyed by number
 * @param rows - Corpus rows
 * @returns Violation messages
 */
function checkCoverage(contract, rows) {
  const bad = [];
  for (const point of Object.keys(contract)) {
    const covering = rows.filter(row =>
      (row.contract ?? []).map(String).includes(point)
    );
    if (covering.length === 0) {
      bad.push(
        `contract point ${point} has no row. Add a row when you add a branch.`
      );
      continue;
    }
    if (!covering.some(row => ADVERSARIAL.includes(row.control))) {
      bad.push(
        `contract point ${point} is carried only by "holds" rows, which both wrong implementations already pass. It is documented, not pinned.`
      );
    }
  }
  return bad;
}

/**
 * Report every violation at once, then exit.
 * @returns Process exit code
 */
function main() {
  const corpus = load();
  const rows = corpus.rows ?? [];
  const bad = [
    ...checkIds(rows),
    ...checkShape(rows),
    ...checkControls(rows),
    ...checkCoverage(corpus.contract ?? {}, rows),
  ];
  if (bad.length > 0) {
    process.stderr.write("cwd-resolution corpus is not adversarial enough:\n");
    for (const line of bad) process.stderr.write(`  - ${line}\n`);
    return 1;
  }
  const biting = rows.filter(row => ADVERSARIAL.includes(row.control)).length;
  process.stdout.write(
    `cwd-resolution corpus: ${rows.length} row(s), ${biting} of which a wrong implementation fails; ${Object.keys(corpus.contract).length} contract point(s) each pinned by at least one.\n`
  );
  return 0;
}

process.exit(main());
