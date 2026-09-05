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
 * IT REFUSES TO ANSWER FROM AN UNRESOLVABLE TREE (CodySwannGT/lisa#3913). The
 * second of those ratchet directions is the destructive one: it names files and
 * tells a reader to delete their quarantine entries. With an empty
 * `node_modules` the compiler cannot start, nothing is compiled, no diagnostic
 * is parsed — and "no diagnostic for this file" is exactly the shape of "this
 * file was fixed". The gate reported all 370 quarantined files as cleared and
 * instructed their removal, which is a destructive edit ordered on the strength
 * of a comparison whose inputs never resolved.
 *
 * So there are two ways this refuses instead of reporting, and the second is
 * the general one:
 *
 *   - the compiler is not present at the path this spawns it from; and
 *   - the compiler signalled failure and produced NOT ONE parseable
 *     diagnostic, which also covers a broken tsconfig, an OOM and a crash.
 *
 * Both exit non-zero with the denial first and NO file list, because a gate
 * whose only surface is an exit code cannot invent a third one — see
 * `scripts/lib/dependency-tree.mjs` for why the wording is a contract rather
 * than a string.
 *
 * `--root` EXISTS SO THIS CAN BE POINTED AT A FIXTURE. Deriving the root solely
 * from `import.meta.url` made the failure above reproducible only by copying
 * this file somewhere else, and `check-empty-subject-guards.mjs` reads that
 * token out of this header to decide the gate is probeable at all — without it
 * this sits in that sweep's declared blind spot.
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
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  cannotMeasure,
  INSTALL_COMMAND,
  missingDependencies,
  ranVacuously,
} from "./lib/dependency-tree.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

const DEFAULT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** The gate's name, as it prints in both the report and the refusal. */
const GATE = "type-correctness (tests)";

/** Where the compiler is spawned from, relative to the root. */
const TSC = path.join("node_modules", "typescript", "bin", "tsc");

/** Matches `path/to/file.ts(12,34): error TS1234: message`. */
const ERROR_LINE = /^(?<file>[^(]+)\((?<line>\d+),\d+\): error (?<code>TS\d+):/;

/**
 * Read the quarantined paths.
 * @param {string} root - The directory holding the quarantine.
 * @returns {{files: string[], reason: string} | null} The parsed quarantine, or
 *   `null` when it could not be read — an unreadable list is a refusal, not a
 *   pass, because that file is what makes this gate green.
 */
function readQuarantine(root) {
  const quarantine = path.join(root, "typecheck-quarantine.json");
  try {
    const parsed = JSON.parse(readFileSync(quarantine, "utf-8"));
    return { files: parsed.files ?? [], reason: parsed.reason ?? "" };
  } catch (error) {
    console.error(
      `check-typecheck-tests: cannot read ${path.relative(root, quarantine)} — ${error.message}`
    );
    console.error(
      "That file is what makes this gate green, so an unreadable one is a refusal, not a pass."
    );
    return null;
  }
}

/**
 * Parse tsc's output into a per-file error count.
 * @param {string} output - Combined stdout and stderr.
 * @returns {Map<string, number>} Errors keyed by forward-slashed path.
 */
function parseDiagnostics(output) {
  /** @type {Map<string, number>} */
  const errorsByFile = new Map();
  for (const line of output.split("\n")) {
    const match = ERROR_LINE.exec(line.trim());
    if (!match?.groups) continue;
    const file = match.groups.file.replace(/\\/g, "/");
    errorsByFile.set(file, (errorsByFile.get(file) ?? 0) + 1);
  }
  return errorsByFile;
}

/**
 * The refusal issued when nothing was compiled.
 *
 * The denial names the destructive remedy explicitly. "Nothing type-checked" is
 * the inference a reader draws from an empty diagnostic set, and the gate's own
 * cleared-entry message is what turns that inference into a deletion — so this
 * has to deny both, not just the first.
 *
 * NO FILE IS NAMED HERE, deliberately. A list of paths is what makes the
 * destructive message actionable, and a refusal that still printed 370 paths
 * would be followed exactly as often as the finding it replaces.
 *
 * @param {string} because - Why the measurement could not happen.
 * @param {number} quarantined - How many entries went unexamined.
 * @param {string} fix - The action that repairs THIS cause. Named per call
 *   site rather than fixed, because telling someone to install dependencies
 *   they already have is how a refusal gets dismissed as noise.
 * @returns {string} The refusal block.
 */
function refuseUnmeasurable(because, quarantined, fix) {
  return cannotMeasure({
    gate: GATE,
    denial: `that any of the ${quarantined} quarantined file(s) now type-check`,
    because,
    remedy:
      `${fix} Do NOT edit typecheck-quarantine.json on the strength of ` +
      `this — no file was compiled, so nothing was established about any ` +
      `entry in it.`,
  });
}

/**
 * Run the gate.
 * @param {string} root - Directory to resolve the project and quarantine under.
 * @returns {number} The process exit code.
 */
export function main(root) {
  const quarantine = readQuarantine(root);
  if (quarantine === null) return 1;
  const quarantined = quarantine.files;
  const exempt = new Set(quarantined);

  // PRECONDITION. Checked before the spawn rather than inferred from it: the
  // spawn SUCCEEDS with an empty `node_modules` — node starts, and it is node
  // that cannot find the module — so `tsc.error` never fires and the failure
  // arrives as an empty diagnostic set indistinguishable from a clean run.
  const missing = missingDependencies(root, [TSC]);
  if (missing.length > 0) {
    console.error(
      refuseUnmeasurable(
        `the TypeScript compiler is not installed — no file at ${missing[0]}.`,
        quarantined.length,
        `Run \`${INSTALL_COMMAND}\`, then re-run this gate.`
      )
    );
    return 1;
  }

  const tsc = spawnSync(
    process.execPath,
    [
      path.join(root, TSC),
      "--noEmit",
      "-p",
      path.join(root, "tsconfig.tests.json"),
    ],
    { cwd: root, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }
  );

  if (tsc.error) {
    console.error(
      `check-typecheck-tests: could not run tsc — ${tsc.error.message}`
    );
    return 1;
  }

  const errorsByFile = parseDiagnostics(
    `${tsc.stdout ?? ""}\n${tsc.stderr ?? ""}`
  );

  // POSTCONDITION, and the general form of the same defect. The compiler
  // signalled failure and produced nothing this gate can read, so the
  // comparison below would run against an empty set — the exact shape of "every
  // quarantined file is fixed". A ZERO exit with no diagnostics is not this: it
  // is a clean run, and it reports normally.
  if (ranVacuously(tsc.status, errorsByFile.size)) {
    const firstLine = `${tsc.stderr ?? ""}${tsc.stdout ?? ""}`
      .split("\n")
      .map(line => line.trim())
      .find(Boolean);
    console.error(
      refuseUnmeasurable(
        `tsc exited ${tsc.status} without emitting one diagnostic this gate ` +
          `could parse, so the comparison had no subject.` +
          `${firstLine ? ` First output line: ${firstLine}` : ""}`,
        quarantined.length,
        "Fix the cause named above, then re-run this gate."
      )
    );
    return 1;
  }

  const offenders = [...errorsByFile.keys()]
    .filter(file => !exempt.has(file))
    .sort();
  const cleared = quarantined.filter(file => !errorsByFile.has(file)).sort();

  const totalErrors = [...errorsByFile.values()].reduce((sum, n) => sum + n, 0);
  console.log(
    `${GATE}: ${errorsByFile.size} file(s) with ${totalErrors} error(s); ` +
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

  if (offenders.length > 0 || cleared.length > 0) return 1;

  console.log(
    "✅ No type errors outside the quarantine, and no stale quarantine entries."
  );
  return 0;
}

/**
 * Resolve the root from `--root <dir>`, defaulting to the repository.
 * @param {ReadonlyArray<string>} argv - Arguments after the script name.
 * @returns {string} The absolute root.
 */
export function rootFrom(argv) {
  const flag = argv.indexOf("--root");
  if (flag === -1) return DEFAULT_ROOT;
  const value = argv[flag + 1];
  if (value === undefined) {
    console.error("check-typecheck-tests: --root requires a value");
    process.exit(2);
  }
  return path.resolve(value);
}

if (invokedAsScript(import.meta.url)) {
  process.exit(main(rootFrom(process.argv.slice(2))));
}
