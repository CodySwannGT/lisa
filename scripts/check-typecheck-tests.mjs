#!/usr/bin/env node
/**
 * Type-check `tests/` and hold the result to a quarantine that can only shrink.
 *
 * WHY THIS EXISTS. The required `type-correctness` gate compiles `tsconfig.json`,
 * whose `include` is `src/**\/*`, so it compiled 0 of 1385 test files and reported
 * success — a required gate permitting exactly what it forbids
 * (CodySwannGT/lisa#3811). Test files here are not incidental: they hold fixture
 * builders, shape assertions and harnesses other suites import.
 *
 * WHY A FILE-LEVEL QUARANTINE RATHER THAN A STAGED ROLLOUT. Turning the program
 * on surfaces a backlog that predates this gate, so something has to hold it.
 * The tempting option is to widen the program one directory at a time. That is
 * the defect surviving in miniature: with a directory scope, a brand-new file
 * under an unreached directory is unchecked on the day it is written. A
 * file-level quarantine inverts it — **every new or renamed file is checked
 * immediately**, and only the files that were already failing are exempt.
 *
 * IT RATCHETS IN BOTH DIRECTIONS, which is what stops it becoming permanent:
 *
 *   - an error in a file NOT in the quarantine fails the gate: that is new debt;
 *   - a quarantined file with NO errors fails the gate too, asking to be
 *     removed from the list. Without that rule the list would record files that
 *     were fixed years ago and quietly re-authorise them if they regressed.
 *
 * `typecheck-quarantine.json` is additionally watched by the existing
 * threshold-ratchet as an `allow-list` family, so *adding* an entry is flagged
 * by a gate somebody already reads.
 *
 * WHAT IS DELIBERATELY NOT DONE HERE: the declared `lib` is not widened. tsc
 * emits "Try changing the 'lib' compiler option to 'es2023' or later" on the
 * ES2023 array APIs, and taking that suggestion would have erased the
 * measurement proving this gap cost something — `toSorted` appeared 0 times in
 * the type-checked `src/` and 52 times in the unchecked `tests/`. Those call
 * sites were rewritten to ES2022 equivalents instead.
 * @module scripts/check-typecheck-tests
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUARANTINE = path.join(ROOT, "typecheck-quarantine.json");
const PROJECT = path.join(ROOT, "tsconfig.tests.json");

/** Matches `path/to/file.ts(12,34): error TS1234: message`. */
const ERROR_LINE = /^(?<file>[^(]+)\((?<line>\d+),\d+\): error (?<code>TS\d+):/;

/**
 * Read the quarantined paths.
 * @returns {{files: string[], reason: string}} The parsed quarantine.
 */
function readQuarantine() {
  try {
    const parsed = JSON.parse(readFileSync(QUARANTINE, "utf-8"));
    return { files: parsed.files ?? [], reason: parsed.reason ?? "" };
  } catch (error) {
    console.error(
      `check-typecheck-tests: cannot read ${path.relative(ROOT, QUARANTINE)} — ${error.message}`
    );
    console.error(
      "That file is what makes this gate green, so an unreadable one is a refusal, not a pass."
    );
    process.exit(1);
  }
}

const { files: quarantined } = readQuarantine();
const exempt = new Set(quarantined);

const tsc = spawnSync(
  process.execPath,
  [
    path.join(ROOT, "node_modules", "typescript", "bin", "tsc"),
    "--noEmit",
    "-p",
    PROJECT,
  ],
  { cwd: ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }
);

if (tsc.error) {
  console.error(
    `check-typecheck-tests: could not run tsc — ${tsc.error.message}`
  );
  process.exit(1);
}

const lines = `${tsc.stdout ?? ""}\n${tsc.stderr ?? ""}`.split("\n");
/** @type {Map<string, number>} */
const errorsByFile = new Map();
for (const line of lines) {
  const match = ERROR_LINE.exec(line.trim());
  if (!match?.groups) continue;
  const file = match.groups.file.replace(/\\/g, "/");
  errorsByFile.set(file, (errorsByFile.get(file) ?? 0) + 1);
}

const offenders = [...errorsByFile.keys()]
  .filter(file => !exempt.has(file))
  .sort();
const cleared = quarantined.filter(file => !errorsByFile.has(file)).sort();

const totalErrors = [...errorsByFile.values()].reduce((sum, n) => sum + n, 0);
console.log(
  `type-correctness (tests): ${errorsByFile.size} file(s) with ${totalErrors} error(s); ` +
    `${quarantined.length} quarantined.`
);

if (offenders.length > 0) {
  console.error("");
  console.error(
    `❌ ${offenders.length} file(s) outside the quarantine have type errors:`
  );
  for (const file of offenders) {
    console.error(`   ${file} (${errorsByFile.get(file)})`);
  }
  console.error("");
  console.error(
    "Fix them. Do NOT add them to typecheck-quarantine.json — that list"
  );
  console.error(
    "only shrinks, and the threshold-ratchet flags additions to it."
  );
}

if (cleared.length > 0) {
  console.error("");
  console.error(
    `❌ ${cleared.length} quarantined file(s) now type-check and must leave the list:`
  );
  for (const file of cleared) console.error(`   ${file}`);
  console.error("");
  console.error(
    "Remove them from typecheck-quarantine.json. A list that keeps entries"
  );
  console.error(
    "after they are fixed would re-authorise them if they ever regressed."
  );
}

if (offenders.length > 0 || cleared.length > 0) process.exit(1);

console.log(
  "✅ No type errors outside the quarantine, and no stale quarantine entries."
);
