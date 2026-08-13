/**
 * Wiring contract for the nightly e2e gate's PER-SUITE grace (rows 32-35).
 *
 * The behaviour is proven in `tests/unit/scripts/nightly-e2e-health-grace.test.ts`.
 * What no unit test can see is whether the four surfaces that must agree still
 * do: the normative doc (`docs/nightly-e2e-gate.md` §2 rows 32-35 and §4.1),
 * the guard that implements them, the JSON Schema an editor validates a
 * `suites` table against, and the caller template that tells an operator which
 * knob to reach for. A field the guard accepts and the schema rejects is a
 * table that passes review and fails the gate; a rule that lives only in code
 * is a rule the next reader "simplifies" away.
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
const DOC_REL = "docs/nightly-e2e-gate.md";

/**
 * Reads a repo-relative text file.
 *
 * @param relative - Repo-relative path
 * @returns File contents
 */
function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf-8");
}

describe("per-suite grace — doc, guard, schema and caller agree", () => {
  // Collapsed to one line: the doc is hard-wrapped at 80 columns, so a phrase
  // this test looks for can legitimately straddle a newline.
  const doc = read(DOC_REL).replace(/\s+/g, " ");

  it("the doc states the rules that bound the window", () => {
    // The rule that must survive every future edit: the grace is ANCHORED and
    // BOUNDED. A per-suite window that could sit in the future, or outlive
    // `bootstrap_max_days`, is propswap's forever-bootstrap with extra steps —
    // the exact thing §4 deletes.
    expect(doc).toContain("Per-suite first-seen grace");
    expect(doc).toContain("`first_seen` may not be in the future");
    expect(doc).toContain(
      "Grace forgives absence of evidence, never evidence of failure"
    );
    // Rows 32-35 exist in the numbered table, not only in prose — §2 is what
    // the per-row tests are named after.
    for (const row of ["| 32 |", "| 33 |", "| 34 |", "| 35 |"]) {
      expect(read(DOC_REL)).toContain(row);
    }
  });

  it("the doc argues the version call, because the change points at fail-OPEN", () => {
    // §8 reads "anything that could turn a blocking observation into a passing
    // one is major". These rows can — but only for a table an operator edited,
    // never for an unchanged observation. That distinction is the whole
    // argument for the minor, so it has to be findable rather than inferred.
    expect(doc).toContain("shipped as `1.2.0` → `1.3.0`, a minor");
    expect(read(GUARD_REL)).toContain('NIGHTLY_E2E_CONTRACT_VERSION = "1.3.0"');
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
