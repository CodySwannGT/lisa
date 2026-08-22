/**
 * Structural assertions over the destructive guard's shipped bytes, and over
 * which tree ships the state-classification check.
 *
 * Deliberately kept OUT of the mutation gate's include list. These assertions
 * read the guard's source text rather than calling it, and a file cannot be
 * both mutated and byte-asserted in the same run: Stryker instruments its
 * sandbox copy with a `process.env.__STRYKER_ACTIVE_MUTANT__` read, so
 * `expect(source).not.toMatch(/process\.env/u)` fails inside the gate for a
 * reason that has nothing to do with the guard. Keeping the behavioural halves
 * — `destructive-production-guard` and `destructive-production-unreachable` —
 * on static imports is what brings 153 mutants into the gate; keeping this half
 * on `readFileSync` alone is what keeps it out (issue #2844).
 *
 * The separation is enforced, not merely intended: `mutation-gate-wiring`
 * fails any unit suite that reaches a mutated guard through a runtime
 * `import()`, which is the shape that made both behavioural suites invisible.
 * This file uses neither a static import of the guard nor a dynamic one, so it
 * is outside both the include list and that rule.
 * @module tests/unit/scripts/destructive-guard-source-shape
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPTS_REL = "all/copy-overwrite/scripts";
const GUARD_REL = `${SCRIPTS_REL}/lisa-destructive-guard.mjs`;
const STATE_CHECK_REL = `${SCRIPTS_REL}/check-state-classification.mjs`;

/** The guard exactly as it ships, uninstrumented. */
const guardSource = fs.readFileSync(path.join(REPO_ROOT, GUARD_REL), "utf8");

describe("the shipped destructive guard has no escape hatch", () => {
  it("is the file the mutation gate mutates", () => {
    // Guards the guard: if this path ever stops naming a real file, every
    // assertion below reads an empty string and passes vacuously.
    expect(guardSource.length).toBeGreaterThan(0);
    expect(guardSource).toContain("export function assertDestructiveAllowed");
  });

  it("reads no environment variable in the shipped guard source", () => {
    expect(guardSource).not.toMatch(/process\s*\.\s*env/u);
  });

  it("exposes no exported escape hatch in the shipped guard source", () => {
    expect(guardSource).not.toMatch(
      /export\s+(?:const|function)\s+\w*(?:force|override|allowProduction|bypass|disable)/iu
    );
  });
});

describe("the state-classification gate still reaches typescript and expo adopters", () => {
  it("ships from the stack-agnostic tree", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, STATE_CHECK_REL))).toBe(true);
  });

  it.each(["typescript", "expo"])(
    "is not shadowed by a %s copy that would suppress the shared one",
    stack => {
      expect(
        fs.existsSync(
          path.join(
            REPO_ROOT,
            stack,
            "copy-overwrite/scripts/check-state-classification.mjs"
          )
        )
      ).toBe(false);
    }
  );

  it.each(["all", "typescript", "expo"])(
    "is not listed for deletion by the %s stack",
    stack => {
      const file = path.join(REPO_ROOT, stack, "deletions.json");
      const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "{}";
      expect(raw).not.toContain("scripts/check-state-classification.mjs");
    }
  );
});
