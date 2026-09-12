#!/usr/bin/env node
/**
 * Check the shipped JavaScript against the Node floor `package.json` declares.
 *
 * WHY THIS EXISTS. `plugins/` and `scripts/` are in the npm `files` allowlist,
 * so they are published code, and no `tsconfig` in this repository reads them:
 * `tsconfig.json` includes `src/**\/*`, `tsconfig.eslint.json` includes
 * `**\/*.ts` which does not match `.mjs`, and `allowJs`/`checkJs` are off
 * throughout. ESLint does lint that tree, but lint has no notion of `lib` or
 * `target`, so it cannot tell an API that exists from one that outruns the
 * declared engine floor (CodySwannGT/lisa#3817).
 *
 * The consequence was never that something was broken. `engines.node` is
 * `22.21.1` and the ES2023 array APIs in the shipped tree are covered by it.
 * The defect is that **nothing would have noticed if it were not** — the
 * safety was incidental rather than enforced, and the next author reaching for
 * an API newer than the floor would have learned about it from a consumer's
 * runtime rather than from this repository.
 *
 * WHAT MAKES `engines.node` THE INPUT RATHER THAN A DECORATION. The floor is
 * parsed out of `package.json`, mapped through {@link FLOOR_LIBS} to the ES
 * library that Node major actually implements, and that library is what the
 * compiler runs under. Raise or lower the declared floor and the verdict
 * changes: measured, `22.21.1` reports nothing and `18.20.4` reports the
 * `toSorted`/`toReversed` call sites by name. A check that type-checked this
 * tree without consulting `engines.node` would satisfy the letter of the
 * ticket and miss its point.
 *
 * WHY A DIFFERENTIAL RATHER THAN A DIAGNOSTIC ALLOW-LIST. The obvious spelling
 * is "fail on TS2550", the code whose message is literally *"Do you need to
 * change your target library?"*. Measured against this tree at `es2022`, that
 * spelling finds `xs.toSorted()` on `string[]` and MISSES `xs.toReversed()` on
 * `readonly AutomationRunRecord[]`, which arrives as a bare TS2339 with no lib
 * hint at all. An allow-list of codes is a search that cannot match the half of
 * the population TypeScript happens not to annotate.
 *
 * So the compiler is run twice over the same program — once at the declared
 * floor, once at `esnext` — and the gate's subject is the SET DIFFERENCE:
 * diagnostics that exist at the floor and vanish when the library is widened.
 * That is, by construction, "this code needs a newer engine than the one we
 * publish". It needs no code allow-list, it catches the unannotated half, and
 * it is blind to the pre-existing strictness backlog — those 12,436
 * diagnostics are present in both runs and cancel.
 *
 * THE BACKLOG IS REPORTED, NOT GATED. Turning `checkJs` on over 653 shipped
 * files surfaces a large population of implicit-`any` and JSDoc-shape errors
 * that predate this gate and have nothing to do with the engine floor. Burning
 * those down is a separate job; recording the number is this gate's third
 * acceptance scenario, so the count prints on every run and blocks nothing.
 *
 * WHAT THIS DOES NOT REACH, stated plainly so the green is not read as more
 * than it is: the compiler can only object to an expression it can type, and
 * much of this tree is untyped. Five of the ten `toSorted` call sites are on
 * values inferred as `any` and are invisible to any lib. The printed backlog
 * count is the honest measure of how much of the tree is in that state.
 *
 * IT REFUSES TO ANSWER FROM AN UNRESOLVABLE TREE, for the reason
 * `check-typecheck-tests.mjs` documents at length (CodySwannGT/lisa#3913): a
 * differential run against a compiler that never started produces two empty
 * sets whose difference is also empty, which is the exact shape of "nothing
 * outruns the floor". So an absent compiler, an unparseable `engines.node`,
 * and a run that exited non-zero without one parseable diagnostic each exit
 * non-zero with the denial first.
 *
 * `--root` EXISTS SO THIS CAN BE POINTED AT A FIXTURE, which is how the
 * floor-drives-the-verdict claim above is proved in the suite rather than
 * asserted in this comment.
 * @module scripts/check-engine-floor
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
const GATE = "type-correctness (engine floor)";

/** Where the compiler is spawned from, relative to the root. */
const TSC = path.join("node_modules", "typescript", "bin", "tsc");

/** The program describing the shipped JavaScript. */
const PROJECT = "tsconfig.shipped-js.json";

/**
 * The widest library TypeScript offers, used as the comparison run.
 *
 * A diagnostic that survives this is not about the engine floor — nothing is
 * newer than `esnext` — so the difference against it isolates exactly the
 * population this gate owns.
 */
const WIDEST_LIB = "esnext";

/** Matches `path/to/file.mjs(12,34): error TS1234: message`. */
const ERROR_LINE = /^(?<file>[^(]+)\((?<line>\d+),\d+\): error (?<code>TS\d+):/;

/**
 * The ES library each Node major actually implements, lowest first.
 *
 * Anchored on the V8 version each Node line ships, not on release dates:
 * Node 18 carries V8 10.2 (ES2022 complete); Node 20 carries V8 11.3, which is
 * where the ES2023 change-array-by-copy methods landed; Node 22 carries V8
 * 12.4, covering ES2024's `Object.groupBy`, `Promise.withResolvers` and the
 * resizable `ArrayBuffer`; Node 24 carries V8 13.6, covering ES2025's iterator
 * helpers, `RegExp.escape` and `Float16Array`.
 *
 * A major ABOVE the highest row resolves to that highest row rather than to
 * `esnext`. That is the conservative direction on purpose: understating the
 * library makes this gate complain about an API the runtime does support,
 * which a human resolves by validating the new Node line and adding a row.
 * Overstating it would make the gate quietly stop objecting.
 */
const FLOOR_LIBS = [
  { lib: "es2022", minMajor: 18 },
  { lib: "es2023", minMajor: 20 },
  { lib: "es2024", minMajor: 22 },
  { lib: "es2025", minMajor: 24 },
];

/** The oldest Node major {@link FLOOR_LIBS} has a validated row for. */
const OLDEST_KNOWN_MAJOR = 18;

/**
 * Read the declared Node floor.
 * @param {string} root - The directory holding `package.json`.
 * @returns {string | null} The raw `engines.node` value, or `null` when the
 *   manifest could not be read or declares no Node engine.
 */
export function declaredFloor(root) {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf-8")
    );
    const node = manifest?.engines?.node;
    return typeof node === "string" && node.trim() !== "" ? node : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the ES library a declared Node floor is entitled to.
 *
 * The first integer in the range is read as the floor, which is correct for
 * every spelling this repository and its templates use — `22.21.1`, `^22.0.0`,
 * `>=22`, `22.x`, `>=20 <23`. A value carrying no integer at all (`*`, `latest`)
 * declares no floor and is refused rather than guessed.
 *
 * @param {string | null} floor - The raw `engines.node` value.
 * @returns {{lib: string, major: number} | null} The library and the major it
 *   came from, or `null` when the floor is unusable.
 */
export function libForEngineFloor(floor) {
  if (floor === null) return null;
  const major = Number(/\d+/.exec(floor)?.[0]);
  if (!Number.isInteger(major)) return null;
  const entry = FLOOR_LIBS.filter(row => row.minMajor <= major).at(-1);
  return entry === undefined ? null : { lib: entry.lib, major };
}

/**
 * Compile the shipped program under one library.
 * @param {string} root - The directory to resolve the project against.
 * @param {string} lib - The ES library to compile under.
 * @returns {{diagnostics: Set<string>, status: number | null, first: string}}
 *   The parsed diagnostic lines, the compiler's exit status, and its first
 *   line of output for a refusal to quote.
 */
function compileUnder(root, lib) {
  const tsc = spawnSync(
    process.execPath,
    [
      path.join(root, TSC),
      "--noEmit",
      "-p",
      path.join(root, PROJECT),
      "--lib",
      lib,
      "--target",
      lib,
    ],
    { cwd: root, encoding: "utf-8", maxBuffer: 128 * 1024 * 1024 }
  );
  const output = `${tsc.stdout ?? ""}\n${tsc.stderr ?? ""}`;
  /** @type {Set<string>} */
  const diagnostics = new Set();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (ERROR_LINE.test(trimmed)) diagnostics.add(trimmed.replace(/\\/g, "/"));
  }
  const first = output
    .split("\n")
    .map(line => line.trim())
    .find(Boolean);
  return {
    diagnostics,
    first: first ?? "",
    status: tsc.error ? 1 : tsc.status,
  };
}

/**
 * The refusal issued when the comparison had no subject.
 *
 * The denial is the load-bearing clause. Both runs coming back empty is
 * indistinguishable, in the difference, from a tree that respects its floor —
 * so a reader who skims one line has to come away knowing the finding was NOT
 * made.
 *
 * @param {string} because - Why the measurement could not happen.
 * @returns {string} The refusal block.
 */
function refuseUnmeasurable(because) {
  return cannotMeasure({
    because,
    denial:
      "that the shipped JavaScript stays within the Node floor package.json declares",
    gate: GATE,
    remedy:
      "Fix the cause named above, then re-run this gate. Nothing was " +
      "compiled, so nothing was established about any shipped file.",
  });
}

/**
 * Run the gate.
 * @param {string} root - Directory to resolve the manifest and project under.
 * @returns {number} The process exit code.
 */
export function main(root) {
  const floor = declaredFloor(root);
  const resolved = libForEngineFloor(floor);
  if (resolved === null) {
    console.error(
      refuseUnmeasurable(
        floor === null
          ? "package.json declares no engines.node, so there is no floor to " +
              "check against."
          : `engines.node is "${floor}", which names no Node major this gate ` +
              `has a validated library for. Known floors start at Node ` +
              `${OLDEST_KNOWN_MAJOR}.`
      )
    );
    return 1;
  }

  // PRECONDITION, checked before the spawn rather than inferred from it: with
  // an empty `node_modules` the spawn SUCCEEDS — node starts, and it is node
  // that cannot find the module — so the failure would arrive as two empty
  // diagnostic sets whose difference is empty.
  const missing = missingDependencies(root, [TSC]);
  if (missing.length > 0) {
    console.error(
      refuseUnmeasurable(
        `the TypeScript compiler is not installed — no file at ` +
          `${missing[0]}. Run \`${INSTALL_COMMAND}\`, then re-run this gate.`
      )
    );
    return 1;
  }

  const atFloor = compileUnder(root, resolved.lib);
  const atWidest = compileUnder(root, WIDEST_LIB);

  // POSTCONDITION. A compiler that signalled failure and produced nothing this
  // gate can read leaves the difference below with no subject — the same shape
  // as a clean tree. A ZERO exit with no diagnostics is not this: that is a
  // program with no errors, and it reports normally.
  const vacuous = [
    { label: resolved.lib, run: atFloor },
    { label: WIDEST_LIB, run: atWidest },
  ].find(({ run }) => ranVacuously(run.status, run.diagnostics.size));
  if (vacuous !== undefined) {
    const { label, run } = vacuous;
    const quoted = run.first === "" ? "" : ` First output line: ${run.first}`;
    console.error(
      refuseUnmeasurable(
        `tsc exited ${run.status} under --lib ${label} without emitting one ` +
          `diagnostic this gate could parse, so the comparison had no ` +
          `subject.${quoted}`
      )
    );
    return 1;
  }

  const floorOnly = [...atFloor.diagnostics]
    .filter(diagnostic => !atWidest.diagnostics.has(diagnostic))
    .sort();

  console.log(
    `${GATE}: engines.node "${floor}" → Node ${resolved.major} → ` +
      `--lib ${resolved.lib}. ${atFloor.diagnostics.size} diagnostic(s) at ` +
      `that library, of which ${floorOnly.length} are attributable to the ` +
      `floor.`
  );
  console.log(
    `Measured backlog (NOT gated): ${atWidest.diagnostics.size} diagnostic(s) ` +
      `survive at --lib ${WIDEST_LIB} and are unrelated to the engine floor.`
  );

  if (floorOnly.length === 0) {
    console.log(
      `✅ Nothing in the shipped JavaScript outruns Node ${resolved.major}.`
    );
    return 0;
  }

  console.error("");
  console.error(
    `❌ ${floorOnly.length} diagnostic(s) exist only because engines.node ` +
      `declares Node ${resolved.major}:`
  );
  for (const diagnostic of floorOnly) console.error(`   ${diagnostic}`);
  console.error("");
  console.error(
    `Each of these compiles at --lib ${WIDEST_LIB} and does not compile at ` +
      `the declared floor, so the code needs a newer`
  );
  console.error(
    "engine than the package publishes. Rewrite the call site to an API the " +
      "floor supports."
  );
  console.error(
    "Raising engines.node is a separate decision with consumer consequences, " +
      "not a way to clear this gate."
  );
  return 1;
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
    console.error("check-engine-floor: --root requires a value");
    process.exit(2);
  }
  return path.resolve(value);
}

if (invokedAsScript(import.meta.url)) {
  process.exit(main(rootFrom(process.argv.slice(2))));
}
