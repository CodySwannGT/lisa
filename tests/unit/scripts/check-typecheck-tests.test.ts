/**
 * Unit tests for scripts/check-typecheck-tests.mjs (CodySwannGT/lisa#3811,
 * #3913, #4923, #4927).
 *
 * The gate is strict: one type error in any file of the test program fails it,
 * and there is no exemption list to consult (#4923 deleted the quarantine that
 * used to hold known-failing files).
 *
 * The other defect these exist for is not a wrong verdict — it is a verdict
 * reached from inputs that never resolved (#3913). With an empty
 * `node_modules` the gate spawns `node node_modules/@typescript/native-preview/bin/tsgo`,
 * the SPAWN succeeds (node starts; node is what cannot find the module),
 * nothing is compiled and no diagnostic matches the gate's pattern. Read
 * naively that is a clean run. The gate must refuse instead, and say so.
 *
 * ## Fixture notes
 *
 * The root is REALPATH'd. tsc reports diagnostic paths relative to its resolved
 * working directory, and on macOS the per-user temp root reached through the
 * unresolved spelling is a symlink, so an un-normalized root yields diagnostic
 * paths that climb out through a chain of `..` segments. That is a property of
 * the fixture, not of the gate.
 *
 * `@typescript/native-preview` (the compiler the gate spawns) is symlinked
 * rather than installed: the gate only ever reads it.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 *
 * @module tests/unit/scripts/check-typecheck-tests
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { createSymlink } from "../../support/borrowed-node-modules.mjs";

const SCRIPT = path.resolve("scripts/check-typecheck-tests.mjs");
/** The compiler the gate spawns: the TypeScript native compiler (`tsgo`). */
const TYPESCRIPT = path.resolve("node_modules/@typescript/native-preview");

/** A self-contained project config, so the fixture compiles in well under a second. */
const TSCONFIG = {
  compilerOptions: {
    module: "ESNext",
    moduleResolution: "bundler",
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: "ES2022",
    types: [],
  },
  include: ["src/**/*"],
};

/** A file that genuinely does not compile. */
const BROKEN_PATH = "src/broken.ts";

/** A file that compiles. */
const CLEAN_PATH = "src/clean.ts";

/** The distinct outcome word a refusal must lead with. */
const CANNOT_MEASURE = "CANNOT MEASURE";

/** The failure header, in the gate's own words. */
const HAS_ERRORS = "file(s) have type errors:";

/** Assigning a string to a `number` is TS2322 — a diagnostic tsc always emits. */
const BROKEN = 'export const n: number = "not a number";\n';

/** No diagnostic. */
const CLEAN = "export const ok: number = 1;\n";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

/**
 * Build a fixture repository.
 * @param options - Whether dependencies resolve, and whether a broken file exists.
 * @returns The realpath'd fixture root.
 */
function fixture({
  installed,
  broken,
}: {
  readonly installed: boolean;
  readonly broken: boolean;
}): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "lisa-3913-")));
  roots.push(root);
  mkdirSync(path.join(root, "src"));
  if (broken) writeFileSync(path.join(root, BROKEN_PATH), BROKEN);
  writeFileSync(path.join(root, CLEAN_PATH), CLEAN);
  writeFileSync(
    path.join(root, "tsconfig.tests.json"),
    JSON.stringify(TSCONFIG)
  );
  if (installed) {
    mkdirSync(path.join(root, "node_modules/@typescript"), {
      recursive: true,
    });
    createSymlink(
      TYPESCRIPT,
      path.join(root, "node_modules/@typescript/native-preview")
    );
  }
  return root;
}

/** The program ESLint's type-aware rules read their types from. */
const ESLINT_PROJECT = "tsconfig.eslint.json";

/**
 * Run the gate against a fixture.
 * @param root - The fixture root.
 * @param extraArgs - Further arguments, e.g. `--project`.
 * @returns The exit status and combined output.
 */
function runGate(
  root: string,
  extraArgs: readonly string[] = []
): { status: number; output: string } {
  const result = boundedSpawnSync({
    args: [SCRIPT, "--root", root, ...extraArgs],
    command: process.execPath,
    label: "check-typecheck-tests.mjs",
  });
  return {
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    status: result.status ?? -1,
  };
}

describe("check-typecheck-tests", () => {
  describe("a type error in any test file", () => {
    it("fails the check and names the file", () => {
      const { output, status } = runGate(
        fixture({ installed: true, broken: true })
      );

      expect(status).toBe(1);
      expect(output).toContain(
        "type-correctness (tests): 1 file(s) with 1 error(s)."
      );
      expect(output).toContain(`1 ${HAS_ERRORS}`);
      expect(output).toContain(`${BROKEN_PATH} (1)`);
      expect(output).not.toContain(CANNOT_MEASURE);
    });

    it("fails even when a leftover exemption list names the file", () => {
      // There is no quarantine to consult. A stale `typecheck-quarantine.json`
      // left in a checkout must change nothing: the error still fails the gate.
      const root = fixture({ installed: true, broken: true });
      writeFileSync(
        path.join(root, "typecheck-quarantine.json"),
        JSON.stringify({ files: [BROKEN_PATH], reason: "fixture" })
      );

      const { output, status } = runGate(root);

      expect(status).toBe(1);
      expect(output).toContain(`${BROKEN_PATH} (1)`);
    });
  });

  describe("a clean tree", () => {
    it("passes when no file has a type error", () => {
      const { output, status } = runGate(
        fixture({ installed: true, broken: false })
      );

      expect(output).toContain(
        "type-correctness (tests): 0 file(s) with 0 error(s)."
      );
      expect(output).toContain("✅ The test program type-checks");
      expect(output).not.toContain(HAS_ERRORS);
      expect(status).toBe(0);
    });
  });

  describe("an unresolvable dependency tree", () => {
    it("reports that it could not measure, naming the missing compiler", () => {
      const { output } = runGate(fixture({ installed: false, broken: true }));

      expect(output).toContain(CANNOT_MEASURE);
      expect(output).toContain(
        "node_modules/@typescript/native-preview/bin/tsgo"
      );
    });

    it("denies the inference a reader would otherwise draw", () => {
      const { output } = runGate(fixture({ installed: false, broken: false }));

      // Silence about errors reads as "there were none". Nothing was compiled,
      // so the refusal has to say that is NOT what it found.
      expect(output).toContain(
        "is NOT reporting that the test program type-checks"
      );
      expect(output).not.toContain("✅");
    });

    it("names no file", () => {
      const { output } = runGate(fixture({ installed: false, broken: true }));

      // Nothing was compiled, so nothing is known about any file.
      expect(output).not.toContain(BROKEN_PATH);
      expect(output).not.toContain(CLEAN_PATH);
      expect(output).not.toContain(HAS_ERRORS);
    });

    it("fails closed rather than passing", () => {
      const { status } = runGate(fixture({ installed: false, broken: false }));

      // Exit code is the gate's only surface, so there is no third code to
      // emit. Resolving an unestablished subject to success would be a fresh
      // instance of the defect being fixed.
      expect(status).toBe(1);
    });
  });

  describe("a vacuous run with the compiler present", () => {
    it("refuses when tsc fails without one parseable diagnostic", () => {
      const root = fixture({ installed: true, broken: false });
      // A config selecting no inputs: tsc exits non-zero emitting TS18003,
      // which carries no `file(line,col)` prefix and so parses to nothing —
      // the same empty subject set, reached without touching node_modules.
      writeFileSync(
        path.join(root, "tsconfig.tests.json"),
        JSON.stringify({
          compilerOptions: { noEmit: true },
          include: ["absent/**/*"],
        })
      );

      const { output, status } = runGate(root);

      expect(output).toContain(CANNOT_MEASURE);
      expect(output).toContain("had no subject");
      expect(output).not.toContain("✅");
      expect(status).toBe(1);
    });
  });

  describe("--project tsconfig.eslint.json (CodySwannGT/lisa#4927)", () => {
    /**
     * A fixture whose ESLint program differs from its test program, so a pass
     * or a failure can only come from the project the flag named.
     * @param broken - Whether the ESLint program holds a type error.
     * @returns The fixture root.
     */
    function eslintFixture(broken: boolean): string {
      const root = fixture({ installed: true, broken: false });
      mkdirSync(path.join(root, "configs"));
      writeFileSync(
        path.join(root, "configs/lint-only.ts"),
        broken ? BROKEN : CLEAN
      );
      writeFileSync(
        path.join(root, ESLINT_PROJECT),
        JSON.stringify({ ...TSCONFIG, include: ["src/**/*", "configs/**/*"] })
      );
      return root;
    }

    it("fails on an error in a file only the ESLint program compiles", () => {
      const root = eslintFixture(true);

      const eslint = runGate(root, ["--project", ESLINT_PROJECT]);
      expect(eslint.status).toBe(1);
      expect(eslint.output).toContain(
        "type-correctness (eslint program): 1 file(s) with 1 error(s)."
      );
      expect(eslint.output).toContain(`1 ${HAS_ERRORS}`);
      expect(eslint.output).toContain("configs/lint-only.ts (1)");

      // The same tree under the default project is clean: the verdict above
      // came from the program the flag named, not from the test program.
      expect(runGate(root).status).toBe(0);
    });

    it("passes when the ESLint program is clean", () => {
      const { output, status } = runGate(eslintFixture(false), [
        "--project",
        ESLINT_PROJECT,
      ]);

      expect(output).toContain("✅ The ESLint program type-checks");
      expect(status).toBe(0);
    });

    it("refuses, naming the ESLint program, when the compiler is absent", () => {
      const root = fixture({ installed: false, broken: false });
      writeFileSync(path.join(root, ESLINT_PROJECT), JSON.stringify(TSCONFIG));

      const { output, status } = runGate(root, ["--project", ESLINT_PROJECT]);

      expect(output).toContain(CANNOT_MEASURE);
      expect(output).toContain(
        "is NOT reporting that the ESLint program type-checks"
      );
      expect(status).toBe(1);
    });

    it("is part of `bun run typecheck`", () => {
      const scripts = (
        JSON.parse(readFileSync("package.json", "utf8")) as {
          readonly scripts: Readonly<Record<string, string>>;
        }
      ).scripts;

      expect(scripts["typecheck:eslint"]).toBe(
        "node scripts/check-typecheck-tests.mjs --project tsconfig.eslint.json"
      );
      expect(scripts["typecheck"]).toContain("bun run typecheck:eslint");
    });
  });
});
