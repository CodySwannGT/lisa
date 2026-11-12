/**
 * The retired `reuse` declaration is still accepted, and nothing reads it.
 *
 * The release-reuse checker that consumed `gates.<id>.reuse` was removed
 * (CodySwannGT/lisa#4794). The key stays in the closed `GATE_FIELDS` allowlist
 * because refusing it would fail validation of a host's whole `gates` block and
 * silently un-configure every gate.
 * @module tests/unit/scripts/lisa-gates-reuse-retired
 */
import { describe, expect, it } from "vitest";

import {
  GATE_FIELDS,
  validateGates,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

describe("the retired reuse declaration", () => {
  it("is still an accepted gate field", () => {
    expect(GATE_FIELDS.has("reuse")).toBe(true);
  });

  it("validates whatever value an old host declared", () => {
    expect(
      validateGates({
        "dependency-vulnerability": {
          "pull-request": "required",
          reuse: { class: "time-sensitive", max_age_minutes: 60 },
        },
        "code-style": {
          "pull-request": "required",
          reuse: { class: "no-longer-a-class" },
        },
      })
    ).toEqual([]);
  });
});
