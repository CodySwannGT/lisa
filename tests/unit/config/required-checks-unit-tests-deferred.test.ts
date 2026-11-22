/**
 * The review-evidence gate stops waiting for the sharded test aggregates, and
 * merge still requires them (CodySwannGT/lisa#4675, CodySwannGT/lisa#5031).
 *
 * With sharding, the aggregates `🧪 Run Unit Tests` and `🧪 Run Integration
 * Tests` post only after every shard finishes, past the gate's registration
 * wait. Without a deferral the gate reports them absent and goes red on Lisa
 * pull requests. Deferring registration must never drop a check from the merge
 * requirement, so both halves are pinned here against Lisa's own
 * `.github/required-checks.json`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const SHARDED_AGGREGATES = [
  "🔍 Quality Checks / 🧪 Run Unit Tests",
  "🔍 Quality Checks / 🧪 Run Integration Tests",
] as const;

/** The fields of `.github/required-checks.json` this test reads. */
interface RequiredChecks {
  readonly registration_deferred?: Readonly<Record<string, string>>;
  readonly required_contexts?: readonly string[];
  readonly required_contexts_by_branch?: Readonly<
    Record<string, readonly string[]>
  >;
}

const declaration = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../../.github/required-checks.json"),
    "utf8"
  )
) as RequiredChecks;

describe.each(SHARDED_AGGREGATES)(
  "Lisa's required-check declaration for %s",
  aggregate => {
    it("defers its registration with a stated reason", () => {
      const reason = declaration.registration_deferred?.[aggregate];
      expect(reason, aggregate).toEqual(expect.stringContaining("shard"));
    });

    it("still requires it for merge, overall and on main", () => {
      expect(declaration.required_contexts).toContain(aggregate);
      expect(declaration.required_contexts_by_branch?.main).toContain(
        aggregate
      );
    });
  }
);
