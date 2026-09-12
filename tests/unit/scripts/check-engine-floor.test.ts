/**
 * Unit tests for scripts/check-engine-floor.mjs (CodySwannGT/lisa#3817).
 *
 * ## What actually has to be proved here
 *
 * The easy half is that a type check over the shipped `.mjs` exists at all.
 * The half that matters is that `engines.node` is its INPUT — a check that
 * compiled the tree under some fixed library would satisfy the ticket's words
 * and leave the declared floor exactly as disconnected from the published code
 * as it was before.
 *
 * So the load-bearing pair is `the declared floor drives the verdict`: one
 * fixture, one `.mjs` file, two `package.json` manifests. Nothing about the
 * code changes between the two runs — only the declared floor — and the verdict
 * flips. That is the evidence; the rest of this file guards the edges of it.
 *
 * `a diagnostic unrelated to the floor` is the rejection control, and it is not
 * optional. A gate that failed on any compiler diagnostic would pass the flip
 * test above for the wrong reason and make the shipped tree unmaintainable —
 * there are five figures of pre-existing strictness diagnostics in it, and the
 * ten existing `toSorted` call sites are legal under the declared floor and
 * must stay legal.
 *
 * `an unresolvable dependency tree` is the #3913 control in this gate's shape.
 * This gate's subject is a set DIFFERENCE, so a compiler that never ran
 * produces two empty sets whose difference is also empty — indistinguishable
 * from a tree that respects its floor, and reported as a pass by any
 * implementation that does not check its preconditions.
 *
 * ## Fixture notes
 *
 * The root is REALPATH'd: tsc reports diagnostic paths relative to its resolved
 * working directory, and the per-user temp root is a symlink on macOS.
 *
 * `typescript` is symlinked rather than installed — the gate only reads it.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 *
 * @module tests/unit/scripts/check-engine-floor
 */
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const SCRIPT = path.resolve("scripts/check-engine-floor.mjs");
const TYPESCRIPT = path.resolve("node_modules/typescript");

/** A floor whose library covers the ES2023 change-array-by-copy methods. */
const MODERN_FLOOR = "22.21.1";

/** A floor whose library does not. Same code, older declared engine. */
const ANCIENT_FLOOR = "18.20.4";

/** The shipped file both scenarios compile. */
const SHIPPED_PATH = "plugins/uses-tosorted.mjs";

/**
 * `toSorted` is ES2023, so this compiles under Node 20+ and does not under
 * Node 18. The parameter is annotated on purpose: TypeScript can only object
 * to an expression it can type, and an unannotated one is `any` to every lib.
 */
const SHIPPED = [
  "/**",
  " * @param {string[]} xs - Values to order.",
  " * @returns {string[]} A sorted copy.",
  " */",
  "export function ordered(xs) {",
  "  return xs.toSorted();",
  "}",
  "",
].join("\n");

/** A file with a plain type error — present at every library, floor or not. */
const UNRELATED_PATH = "plugins/unrelated.mjs";

const UNRELATED = [
  "/**",
  " * @param {number} n - A number.",
  " * @returns {number} Its successor.",
  " */",
  "export function next(n) {",
  "  return n + notDefinedAnywhere;",
  "}",
  "",
].join("\n");

/** A self-contained program, so the fixture compiles in well under a second. */
const TSCONFIG = {
  compilerOptions: {
    allowJs: true,
    checkJs: true,
    module: "NodeNext",
    moduleResolution: "NodeNext",
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    types: [],
  },
  include: ["plugins/**/*.mjs"],
};

/** The distinct outcome word a refusal must lead with. */
const CANNOT_MEASURE = "CANNOT MEASURE";

/** The gate's own headline when the shipped tree respects its floor. */
const CLEAN = "outruns Node";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

/**
 * Build a fixture repository.
 * @param options - The declared floor, whether the compiler resolves, and
 *   whether the unrelated pre-existing diagnostic is present.
 * @returns The realpath'd fixture root.
 */
function fixture({
  floor,
  installed = true,
  unrelated = false,
}: {
  readonly floor: string | null;
  readonly installed?: boolean;
  readonly unrelated?: boolean;
}): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "lisa-3817-")));
  roots.push(root);
  mkdirSync(path.join(root, "plugins"));
  writeFileSync(path.join(root, SHIPPED_PATH), SHIPPED);
  if (unrelated) writeFileSync(path.join(root, UNRELATED_PATH), UNRELATED);
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify(
      floor === null ? { name: "f" } : { engines: { node: floor }, name: "f" }
    )
  );
  writeFileSync(
    path.join(root, "tsconfig.shipped-js.json"),
    JSON.stringify(TSCONFIG)
  );
  if (installed) {
    mkdirSync(path.join(root, "node_modules"));
    symlinkSync(TYPESCRIPT, path.join(root, "node_modules/typescript"));
  }
  return root;
}

/**
 * Run the gate against a fixture.
 * @param root - The fixture root.
 * @returns The exit status and combined output.
 */
function runGate(root: string): { status: number; output: string } {
  const result = boundedSpawnSync({
    args: [SCRIPT, "--root", root],
    command: process.execPath,
    label: "check-engine-floor.mjs",
  });
  return {
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    status: result.status ?? -1,
  };
}

describe("check-engine-floor", () => {
  describe("the declared floor drives the verdict", () => {
    it("accepts an API the declared floor supports", () => {
      const { output, status } = runGate(fixture({ floor: MODERN_FLOOR }));

      expect(output).toContain("--lib es2024");
      expect(output).toContain(CLEAN);
      expect(status).toBe(0);
    });

    it("refuses the same code once the declared floor is older", () => {
      // The only thing that changed between this case and the one above is
      // package.json. If the verdict did not move, engines.node would not be
      // an input to this gate — which is the defect being fixed, not the fix.
      const { output, status } = runGate(fixture({ floor: ANCIENT_FLOOR }));

      expect(output).toContain("--lib es2022");
      expect(status).toBe(1);
    });

    it("names the file and the API when it refuses", () => {
      const { output } = runGate(fixture({ floor: ANCIENT_FLOOR }));

      expect(output).toContain(SHIPPED_PATH);
      expect(output).toContain("toSorted");
    });
  });

  describe("a diagnostic unrelated to the floor", () => {
    // THE REJECTION CONTROL. A gate that failed on any compiler diagnostic
    // would pass every assertion above and still be wrong: the shipped tree
    // carries a five-figure pre-existing strictness backlog, and the existing
    // ES2023 call sites are legal under the declared floor.
    it("does not fail the gate", () => {
      const { status } = runGate(
        fixture({ floor: MODERN_FLOOR, unrelated: true })
      );

      expect(status).toBe(0);
    });

    it("is reported as measured backlog rather than as a floor violation", () => {
      const { output } = runGate(
        fixture({ floor: MODERN_FLOOR, unrelated: true })
      );

      expect(output).toContain("Measured backlog (NOT gated): 1 diagnostic(s)");
      expect(output).toContain("0 are attributable to the floor");
    });
  });

  describe("an undeclared floor", () => {
    it("refuses rather than assuming one", () => {
      const { output, status } = runGate(fixture({ floor: null }));

      expect(output).toContain(CANNOT_MEASURE);
      expect(output).toContain("declares no engines.node");
      expect(output).not.toContain(CLEAN);
      expect(status).toBe(1);
    });
  });

  describe("an unresolvable dependency tree", () => {
    it("reports that it could not measure, naming the missing compiler", () => {
      const { output } = runGate(
        fixture({ floor: MODERN_FLOOR, installed: false })
      );

      expect(output).toContain(CANNOT_MEASURE);
      expect(output).toContain("node_modules/typescript/bin/tsc");
    });

    it("denies the inference a reader would otherwise draw", () => {
      // Two empty diagnostic sets have an empty difference, which is exactly
      // the shape of a tree that respects its floor. Silence has to be denied
      // in words or it reads as a pass.
      const { output } = runGate(
        fixture({ floor: MODERN_FLOOR, installed: false })
      );

      expect(output).toContain("is NOT reporting");
      expect(output).toContain("stays within the Node floor");
    });

    it("fails closed rather than passing", () => {
      const { status } = runGate(
        fixture({ floor: MODERN_FLOOR, installed: false })
      );

      expect(status).toBe(1);
    });
  });
});
