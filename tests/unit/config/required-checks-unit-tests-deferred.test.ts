/**
 * The review-evidence gate stops waiting for `🧪 Run Unit Tests`, and merge
 * still requires it (CodySwannGT/lisa#4675).
 *
 * With unit sharding, the aggregate `🧪 Run Unit Tests` posts only after every
 * shard finishes, past the gate's registration wait. Without a deferral the
 * gate reports it absent and goes red on every Lisa pull request. Deferring
 * registration must never drop the check from the merge requirement, so both
 * halves are pinned here against Lisa's own `.github/required-checks.json`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const UNIT = "🔍 Quality Checks / 🧪 Run Unit Tests";

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

describe("Lisa's required-check declaration for 🧪 Run Unit Tests", () => {
  it("defers its registration with a stated reason", () => {
    const reason = declaration.registration_deferred?.[UNIT];
    expect(reason, UNIT).toEqual(expect.stringContaining("shard"));
  });

  it("still requires it for merge, overall and on main", () => {
    expect(declaration.required_contexts).toContain(UNIT);
    expect(declaration.required_contexts_by_branch?.main).toContain(UNIT);
  });
});
