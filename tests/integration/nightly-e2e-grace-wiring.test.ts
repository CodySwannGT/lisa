/**
 * Wiring contract for the nightly e2e gate's PER-SUITE grace (rows 32-35).
 *
 * The behaviour is proven in `tests/unit/scripts/nightly-e2e-health-grace.test.ts`.
 * What no unit test can see is whether the surfaces that must agree still do:
 * the guard that implements the rows, the JSON Schema an editor validates a
 * `suites` table against, and the caller template that tells an operator which
 * knob to reach for. A field the guard accepts and the schema rejects is a
 * table that passes review and fails the gate. The normative doc
 * (`docs/nightly-e2e-gate.md`) is prose and is not pinned (#4867).
 *
 * Sibling of `nightly-e2e-health-workflow.test.ts`, which pins the
 * status-check context identity and the rest of the reusable's contract.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const CALLER_REL = "expo/create-only/.github/workflows/nightly-e2e-health.yml";
const REUSABLE_REL = ".github/workflows/nightly-e2e-health.yml";
const GUARD_REL =
  "typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs";
const SCHEMA_REL =
  "typescript/copy-overwrite/scripts/nightly-e2e-suites.schema.json";

/**
 * Reads a repo-relative text file.
 *
 * @param relative - Repo-relative path
 * @returns File contents
 */
function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf-8");
}

describe("per-suite grace — guard, schema and caller agree", () => {
  it("keeps the contract on major 1, because the change cannot fail open", () => {
    // Pinning the guard's current literal here would make every later minor
    // look like a per-suite grace regression. What must hold is that the
    // version is a 1.x — §8's rule is about the MAJOR, and that is what the
    // workflow asserts.
    expect(read(GUARD_REL)).toMatch(
      /NIGHTLY_E2E_CONTRACT_VERSION = "1\.\d+\.\d+"/
    );
    // The workflow still asserts MAJOR 1: a major bump would red-wall every
    // adopter pinned to an older tag for a change that cannot fail open.
    expect(read(REUSABLE_REL)).toContain("default: 1");
  });

  it("the guard resolves the window in one place", () => {
    expect(read(GUARD_REL)).toContain("resolveSuiteGrace");
  });

  it("the schema accepts exactly the fields the guard accepts", () => {
    const schema = JSON.parse(read(SCHEMA_REL)) as {
      $defs: {
        suite: {
          properties: Record<string, { maximum?: number }>;
          dependentRequired: Record<string, readonly string[]>;
        };
      };
    };
    expect(schema.$defs.suite.properties.first_seen).toBeDefined();
    expect(schema.$defs.suite.properties.grace_days).toBeDefined();
    // The ceiling is the bootstrap ceiling — one forgiveness budget, not two.
    expect(schema.$defs.suite.properties.grace_days?.maximum).toBe(30);
    // A grace length with no anchor forgives nothing while reading as though it
    // forgives everything, so the schema refuses it exactly as the guard does.
    expect(schema.$defs.suite.dependentRequired.grace_days).toEqual([
      "first_seen",
    ]);
  });

  it("the caller template sends the operator to the anchor, not the global window", () => {
    // The whole point: widening `bootstrap_until` to admit one new suite
    // un-arms every suite that was already gating.
    expect(read(CALLER_REL)).toContain(
      "do NOT re-open this window — give that one suite a"
    );
    expect(read(CALLER_REL)).toContain('"first_seen"');
  });
});
