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
import { describe, expect, it, vi } from "vitest";

import { validateGates } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

describe("the retired reuse declaration", () => {
  // The allowlist is built while the module LOADS, and per-test mutation
  // coverage credits load-time code to whichever test imported the module
  // first. So this case loads a fresh copy inside its own body, which makes the
  // mutation gate run it against an altered list (as in CodySwannGT/lisa#3359).
  it("is no longer a gate field, and the real settings all still are", async () => {
    vi.resetModules();
    const fresh =
      await import("../../../all/copy-overwrite/scripts/lisa-gates.mjs");

    expect([...fresh.GATE_FIELDS]).toEqual(["run", "needs", "task"]);
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
