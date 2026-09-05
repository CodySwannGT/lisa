/**
 * Unit tests for scripts/check-typecheck-tests.mjs (CodySwannGT/lisa#3913).
 *
 * The defect these exist for is not a wrong comparison — it is a correct
 * comparison run against inputs that never resolved. With an empty
 * `node_modules` the gate spawns `node node_modules/typescript/bin/tsc`, the
 * SPAWN succeeds (node starts; node is what cannot find the module), nothing is
 * compiled, no diagnostic matches the gate's pattern, and every quarantined file
 * therefore satisfies "has no errors". The gate reported all 370 entries as
 * fixed and instructed their deletion.
 *
 * ## The two controls, and why both are required
 *
 * `an unresolvable dependency tree` is the control that must FAIL against the
 * unfixed gate. Measured against `origin/main`'s copy on the fixture below, the
 * unfixed gate names `src/broken.ts` — a file with a real, deliberate type
 * error — as one that "now type-checks". That is the destructive claim in
 * miniature and it is what these assertions refuse.
 *
 * `a genuine stale entry` is the control that must PASS in BOTH states. A fix
 * that bought safety by refusing to report would be worse than the defect,
 * because the quarantine only ratchets shut if a fixed file is actually called
 * out. Measured: the unfixed and fixed gates produce byte-identical output for
 * this case.
 *
 * ## Fixture notes
 *
 * The root is REALPATH'd. tsc reports diagnostic paths relative to its resolved
 * working directory, and on macOS the per-user temp root reached through the
 * unresolved spelling is a symlink, so an un-normalized root yields diagnostic
 * paths that climb out through a chain of `..` segments — and the quarantine,
 * which holds repo-relative paths, then matches nothing. That is a property of
 * the fixture, not of the gate.
 *
 * `typescript` is symlinked rather than installed: the gate only ever reads it.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 *
 * @module tests/unit/scripts/check-typecheck-tests
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

const SCRIPT = path.resolve("scripts/check-typecheck-tests.mjs");
const TYPESCRIPT = path.resolve("node_modules/typescript");

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

/** A file that genuinely does not compile — legitimately quarantined. */
const BROKEN_PATH = "src/broken.ts";

/** A file that compiles. Quarantining it is what a stale entry looks like. */
const CLEAN_PATH = "src/clean.ts";

/** The destructive finding's headline, in the gate's own words. */
const MUST_LEAVE = "must leave the list";

/** The distinct outcome word a refusal must lead with. */
const CANNOT_MEASURE = "CANNOT MEASURE";

/** Assigning a string to a `number` is TS2322 — a diagnostic tsc always emits. */
const BROKEN = 'export const n: number = "not a number";\n';

/** No diagnostic. Quarantining this is what a genuine stale entry looks like. */
const CLEAN = "export const ok: number = 1;\n";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

/**
 * Build a fixture repository.
 * @param options - Whether dependencies resolve, and what is quarantined.
 * @returns The realpath'd fixture root.
 */
function fixture({
  installed,
  quarantined,
}: {
  readonly installed: boolean;
  readonly quarantined: readonly string[];
}): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "lisa-3913-")));
  roots.push(root);
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, BROKEN_PATH), BROKEN);
  writeFileSync(path.join(root, CLEAN_PATH), CLEAN);
  writeFileSync(
    path.join(root, "tsconfig.tests.json"),
    JSON.stringify(TSCONFIG)
  );
  writeFileSync(
    path.join(root, "typecheck-quarantine.json"),
    JSON.stringify({ files: quarantined, reason: "fixture" })
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
    label: "check-typecheck-tests.mjs",
  });
  return {
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    status: result.status ?? -1,
  };
}

describe("check-typecheck-tests", () => {
  describe("an unresolvable dependency tree", () => {
    it("reports that it could not measure, naming the missing compiler", () => {
      const { output } = runGate(
        fixture({
          installed: false,
          quarantined: [BROKEN_PATH, CLEAN_PATH],
        })
      );

      expect(output).toContain(CANNOT_MEASURE);
      expect(output).toContain("node_modules/typescript/bin/tsc");
    });

    it("denies the inference a reader would otherwise draw", () => {
      const { output } = runGate(
        fixture({
          installed: false,
          quarantined: [BROKEN_PATH, CLEAN_PATH],
        })
      );

      // The whole point. Silence about errors reads as "there were none", and
      // the gate's own cleared-entry message turns that into a deletion.
      expect(output).toContain("is NOT reporting");
      expect(output).toContain("now type-check");
    });

    it("names no quarantined file", () => {
      const { output } = runGate(
        fixture({
          installed: false,
          quarantined: [BROKEN_PATH, CLEAN_PATH],
        })
      );

      // A refusal that still printed the paths would be followed exactly as
      // often as the finding it replaces. `src/broken.ts` is the sharpest
      // case: the unfixed gate calls this file, which does NOT compile, fixed.
      expect(output).not.toContain(BROKEN_PATH);
      expect(output).not.toContain(CLEAN_PATH);
      expect(output).not.toContain(MUST_LEAVE);
    });

    it("instructs nobody to edit the quarantine", () => {
      const { output } = runGate(
        fixture({ installed: false, quarantined: [CLEAN_PATH] })
      );

      expect(output).not.toContain(
        "Remove them from typecheck-quarantine.json"
      );
      expect(output).toContain("Do NOT edit typecheck-quarantine.json");
    });

    it("fails closed rather than passing", () => {
      const { status } = runGate(
        fixture({ installed: false, quarantined: [CLEAN_PATH] })
      );

      // Exit code is the gate's only surface, so there is no third code to
      // emit. Resolving an unestablished subject to success would be a fresh
      // instance of the defect being fixed.
      expect(status).toBe(1);
    });
  });

  describe("a vacuous run with the compiler present", () => {
    it("refuses when tsc fails without one parseable diagnostic", () => {
      const root = fixture({ installed: true, quarantined: [CLEAN_PATH] });
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
      expect(output).not.toContain(MUST_LEAVE);
      expect(status).toBe(1);
    });
  });

  describe("a genuine stale entry", () => {
    // MUST PASS AGAINST BOTH THE FIXED AND UNFIXED GATE. This is the control
    // that catches an over-broad fix — one that stopped reporting in order to
    // stop reporting wrongly.
    it("is still reported by name, with the removal instruction", () => {
      const { output, status } = runGate(
        fixture({
          installed: true,
          quarantined: [BROKEN_PATH, CLEAN_PATH],
        })
      );

      expect(output).toContain("1 quarantined file(s) now type-check");
      expect(output).toContain(CLEAN_PATH);
      expect(output).toContain("Remove them from typecheck-quarantine.json");
      expect(output).not.toContain(CANNOT_MEASURE);
      expect(status).toBe(1);
    });

    it("leaves a still-failing quarantined file quarantined", () => {
      const { output } = runGate(
        fixture({
          installed: true,
          quarantined: [BROKEN_PATH, CLEAN_PATH],
        })
      );

      expect(output).toContain(
        "type-correctness (tests): 1 file(s) with 1 error(s); 2 quarantined."
      );
      expect(output).not.toContain("outside the quarantine have type errors");
    });
  });

  describe("a clean tree", () => {
    it("passes when every quarantined file still fails and nothing else does", () => {
      const { output, status } = runGate(
        fixture({ installed: true, quarantined: [BROKEN_PATH] })
      );

      expect(output).toContain("✅ No type errors outside the quarantine");
      expect(status).toBe(0);
    });
  });
});
