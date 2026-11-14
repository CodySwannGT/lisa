/**
 * The retired `reuse` declaration is refused like any other unknown key.
 *
 * The release-reuse checker that read `gates.<id>.reuse` was removed
 * (CodySwannGT/lisa#4794), which kept the key accepted but ignored for a
 * while. It is now gone from the closed `GATE_FIELDS` allowlist
 * (CodySwannGT/lisa#4899): a setting Lisa silently ignores reads as one that
 * does something, and no Lisa-managed host declared it when it was removed.
 * @module tests/unit/scripts/lisa-gates-reuse-retired
 */
import { describe, expect, it } from "vitest";

import {
  GATE_FIELDS,
  validateGates,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

describe("the retired reuse declaration", () => {
  it("is no longer a gate field", () => {
    expect(GATE_FIELDS.has("reuse")).toBe(false);
  });

  it("is reported as a problem naming reuse", () => {
    const problems = validateGates({
      "code-style": {
        "pull-request": "required",
        reuse: { class: "time-sensitive", max_age_minutes: 60 },
      },
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('gates."code-style"."reuse"');
  });

  it("leaves a gate declaring only real settings and moments valid", () => {
    expect(
      validateGates({
        "code-style": { "pull-request": "required", run: "lint" },
      })
    ).toEqual([]);
  });
});
