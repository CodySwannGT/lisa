/**
 * Tests for how a doctor result is rendered.
 *
 * The gate report is attached under `--json` and nowhere else, and it is its
 * own key rather than more `DoctorCheck` rows. That is not a layout
 * preference: `DoctorStatus` is `ok | warn | fail` with no unknown state, and
 * a report whose whole contract is that "not checkable here" never becomes a
 * pass cannot be expressed in a shape that lacks the state.
 * @module tests/unit/cli/doctor-render
 */
import { describe, expect, it } from "vitest";

import type { DoctorCheck } from "../../../src/cli/doctor.js";
import { renderDoctorResult } from "../../../src/cli/doctor-render.js";
import { REGISTRY } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

import { makeProject } from "./gate-report-fixtures.js";

/**
 * How many gates the registry ships.
 *
 * Derived, never typed. A literal here has to be edited every time the registry
 * grows, and the edit is indistinguishable from the report genuinely dropping a
 * gate — the assertion would be updated to match the bug.
 */
const GATE_COUNT = Object.keys(REGISTRY).length;

const CHECKS: DoctorCheck[] = [
  { name: "Something", status: "ok", detail: "fine" },
];

describe("rendering a doctor result", () => {
  it("leaves the human output a line per check, with no gate report", async () => {
    const written: string[] = [];
    const result = await renderDoctorResult(
      CHECKS,
      await makeProject({ config: {} }),
      {},
      message => written.push(message)
    );
    expect(written).toEqual(["OK Something: fine"]);
    expect(result.gateReport).toBeUndefined();
  });

  it("attaches the gate report to the machine payload", async () => {
    const written: string[] = [];
    const result = await renderDoctorResult(
      CHECKS,
      await makeProject({ config: {} }),
      { json: true, offline: true },
      message => written.push(message)
    );
    expect(result.gateReport?.gates).toHaveLength(GATE_COUNT);
    const payload: unknown = JSON.parse(written[0] ?? "");
    expect(Object.keys(payload as object)).toEqual(["checks", "gateReport"]);
  });
});
