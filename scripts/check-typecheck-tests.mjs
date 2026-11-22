#!/usr/bin/env node
/**
 * Type-check `tests/` and fail on any error, in any file.
 *
 * WHY THIS EXISTS. The required `type-correctness` gate compiles `tsconfig.json`,
 * whose `include` is `src/**\/*`, so it compiled 0 of 1385 test files and reported
 * success — a required gate permitting exactly what it forbids
 * (CodySwannGT/lisa#3811). Test files here are not incidental: they hold fixture
 * builders, shape assertions and harnesses other suites import.
 *
 * THERE IS NO EXEMPTION LIST. The gate once held a file-level quarantine of
 * files that were already failing when the program was switched on, ratcheted
 * so it could only shrink. CodySwannGT/lisa#4923 emptied it and deleted it: an
 * exemption list is debt with a mechanism attached, and the mechanism outlives
 * the reason. Every file in the program is now held to the same rule — one type
 * error anywhere fails the gate.
 *
 * IT REFUSES TO ANSWER FROM AN UNRESOLVABLE TREE (CodySwannGT/lisa#3913). With
 * an empty `node_modules` the compiler cannot start, nothing is compiled and no
 * diagnostic is parsed. Under the old quarantine that emptiness read as "every
 * quarantined file was fixed" and ordered a destructive edit; without one it
 * would read as a clean run. Either way it is a verdict about a program nobody
 * compiled, so it is refused rather than reported.
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
 * `--project` POINTS IT AT ANOTHER PROGRAM. `tsconfig.eslint.json` is the
 * program ESLint's type-aware rules read their types from; it once reported
 * 5,294 errors while lint passed, so those rules were reasoning over `any` and
 * error types (CodySwannGT/lisa#4927). `bun run typecheck:eslint` runs this
 * same gate over it — same rules, same refusals, no exemption list — so that
 * program cannot rot unseen again. Without the flag it checks the test program.
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

/** The project the gate compiles when no `--project` is given. */
const DEFAULT_PROJECT = "tsconfig.tests.json";

/**
 * How each known program is named in the report and the refusal. The test
 * program's wording is a contract: `gate-failure-diagnosis.mjs` and the tests
 * pinning this gate read it.
 * @type {Readonly<Record<string, { gate: string, program: string }>>}
 */
const PROGRAMS = {
  "tsconfig.tests.json": {
    gate: "type-correctness (tests)",
    program: "the test program",
  },
  "tsconfig.eslint.json": {
    gate: "type-correctness (eslint program)",
    program: "the ESLint program",
  },
};

/**
 * Name a program for the report: a known one by its fixed wording, any other
 * by its config file, so a new project never prints as the test program.
 * @param {string} project - The tsconfig path, relative to the root.
 * @returns {{ gate: string, program: string }} The gate name and program noun.
 */
export function describeProgram(project) {
  return (
    PROGRAMS[project] ?? {
      gate: `type-correctness (${project})`,
      program: `the ${project} program`,
    }
  );
}

/**
 * Where the compiler is spawned from, relative to the root: the TypeScript
 * native compiler (`tsgo`, npm `@typescript/native-preview`), which checks this
 * program about ten times faster than `tsc` (CodySwannGT/lisa#4614, #4695). On
 * this program it puts the same set of files in error as `tsc`, though error
 * counts, codes and wording can differ — which is enough, because this gate
 * asks only whether any file is in error and names the files, never compares
 * raw diagnostics across compilers. Its bin is a plain Node script, so it is
 * spawned under `node` exactly as `tsc` was.
 */
const TSC = path.join(
  "node_modules",
  "@typescript",
  "native-preview",
  "bin",
  "tsgo"
);

/** Matches `path/to/file.ts(12,34): error TS1234: message`. */
const ERROR_LINE = /^(?<file>[^(]+)\((?<line>\d+),\d+\): error (?<code>TS\d+):/;

/**
 * Parse the compiler's output into a per-file error count.
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
 * The denial names the inference a reader draws from an empty diagnostic set —
 * that the test program type-checks — because that is exactly what was not
 * established.
 *
 * NO FILE IS NAMED HERE, deliberately: nothing was compiled, so nothing is
 * known about any file.
 *
 * @param {{ gate: string, program: string }} named - The program's names.
 * @param {string} because - Why the measurement could not happen.
 * @param {string} fix - The action that repairs THIS cause. Named per call
 *   site rather than fixed, because telling someone to install dependencies
 *   they already have is how a refusal gets dismissed as noise.
 * @returns {string} The refusal block.
 */
function refuseUnmeasurable(named, because, fix) {
  return cannotMeasure({
    gate: named.gate,
    denial: `that ${named.program} type-checks`,
    because,
    remedy: `${fix} No file was compiled, so nothing was established about any of them.`,
  });
}

/**
 * Run the gate.
 * @param {string} root - Directory to resolve the project under.
 * @param {string} [project] - The tsconfig to compile, relative to the root.
 * @returns {number} The process exit code.
 */
export function main(root, project = DEFAULT_PROJECT) {
  const named = describeProgram(project);
  // PRECONDITION. Checked before the spawn rather than inferred from it: the
  // spawn SUCCEEDS with an empty `node_modules` — node starts, and it is node
  // that cannot find the module — so `tsc.error` never fires and the failure
  // arrives as an empty diagnostic set indistinguishable from a clean run.
  const missing = missingDependencies(root, [TSC]);
  if (missing.length > 0) {
    console.error(
      refuseUnmeasurable(
        named,
        `the TypeScript native compiler (tsgo) is not installed — no file at ${missing[0]}.`,
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
      "--pretty",
      "false",
      "-p",
      path.join(root, project),
    ],
    { cwd: root, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }
  );

  if (tsc.error) {
    console.error(
      `check-typecheck-tests: could not run tsgo — ${tsc.error.message}`
    );
    return 1;
  }

  const errorsByFile = parseDiagnostics(
    `${tsc.stdout ?? ""}\n${tsc.stderr ?? ""}`
  );

  // POSTCONDITION, and the general form of the same defect. The compiler
  // signalled failure and produced nothing this gate can read — a broken
  // tsconfig, an OOM, a crash. Reporting that as a pass would be a verdict
  // about a program nobody compiled. A ZERO exit with no diagnostics is not
  // this: it is a clean run, and it reports normally.
  if (ranVacuously(tsc.status, errorsByFile.size)) {
    const firstLine = `${tsc.stderr ?? ""}${tsc.stdout ?? ""}`
      .split("\n")
      .map(line => line.trim())
      .find(Boolean);
    console.error(
      refuseUnmeasurable(
        named,
        `tsgo exited ${tsc.status} without emitting one diagnostic this gate ` +
          `could parse, so the check had no subject.` +
          `${firstLine ? ` First output line: ${firstLine}` : ""}`,
        "Fix the cause named above, then re-run this gate."
      )
    );
    return 1;
  }

  const offenders = [...errorsByFile.keys()].sort();
  const totalErrors = [...errorsByFile.values()].reduce((sum, n) => sum + n, 0);
  console.log(
    `${named.gate}: ${errorsByFile.size} file(s) with ${totalErrors} error(s).`
  );

  if (offenders.length > 0) {
    console.error("");
    console.error(`❌ ${offenders.length} file(s) have type errors:`);
    for (const file of offenders) {
      console.error(`   ${file} (${errorsByFile.get(file)})`);
    }
    console.error("");
    console.error(
      "Fix each at its cause. There is no exemption list: every file in"
    );
    console.error(`${named.program} is type-checked, and one error fails it.`);
    return 1;
  }

  const program =
    named.program.charAt(0).toUpperCase() + named.program.slice(1);
  console.log(`✅ ${program} type-checks with no errors.`);
  return 0;
}

/**
 * Read the value following `flag`, or undefined when the flag is absent.
 * @param {ReadonlyArray<string>} argv - Arguments after the script name.
 * @param {string} flag - The flag, e.g. `--root`.
 * @returns {string | undefined} The flag's value.
 */
function flagValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined) {
    console.error(`check-typecheck-tests: ${flag} requires a value`);
    process.exit(2);
  }
  return value;
}

/**
 * Resolve the root from `--root <dir>`, defaulting to the repository.
 * @param {ReadonlyArray<string>} argv - Arguments after the script name.
 * @returns {string} The absolute root.
 */
export function rootFrom(argv) {
  const value = flagValue(argv, "--root");
  return value === undefined ? DEFAULT_ROOT : path.resolve(value);
}

/**
 * Resolve the project from `--project <tsconfig>`, relative to the root and
 * defaulting to the test program.
 * @param {ReadonlyArray<string>} argv - Arguments after the script name.
 * @returns {string} The tsconfig path relative to the root.
 */
export function projectFrom(argv) {
  return flagValue(argv, "--project") ?? DEFAULT_PROJECT;
}

if (invokedAsScript(import.meta.url)) {
  const argv = process.argv.slice(2);
  process.exit(main(rootFrom(argv), projectFrom(argv)));
}
