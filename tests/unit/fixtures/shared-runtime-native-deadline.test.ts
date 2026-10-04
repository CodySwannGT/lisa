/** Native host work must retain its budget after real fleet admission. */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  admissionDeadlineMs,
  ADMISSION_POLL_MS,
} from "../../../src/configs/vitest/fleet-admission.js";
import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";
import {
  nativeUnitDeadlineMs,
  run,
} from "../../fixtures/shared-runtime-hosts/process.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await cleanupTempDir(root);
});

describe("generated host native admission deadline", () => {
  it("keeps the default admission wait unscaled and the full work budget", () => {
    expect(nativeUnitDeadlineMs({}, 75_000, 375_000)).toBe(197_000);
    expect(
      nativeUnitDeadlineMs(
        { LISA_FLEET_ADMISSION_DEADLINE_MS: "5000" },
        75_000,
        375_000
      )
    ).toBe(82_000);
    for (const value of ["", "0", "invalid"])
      expect(
        nativeUnitDeadlineMs(
          { LISA_FLEET_ADMISSION_DEADLINE_MS: value },
          75_000,
          375_000
        )
      ).toBe(197_000);
  });

  it("refuses disabled, nonfinite and unfit admission rather than hiding it", () => {
    for (const environment of [
      { LISA_FLEET_ADMISSION: "off" },
      { LISA_FLEET_ADMISSION_DEADLINE_MS: "9".repeat(400) },
      { LISA_FLEET_ADMISSION_DEADLINE_MS: "300000" },
    ])
      expect(() => nativeUnitDeadlineMs(environment, 75_000, 375_000)).toThrow(
        /Native unit/
      );
  });

  it("gives an actual child the explicit control-plus-work wall deadline", async () => {
    const root = await createTempDir();
    roots.push(root);
    const environment = {
      ...process.env,
      LISA_FLEET_ADMISSION_DEADLINE_MS: "5000",
    };
    // This is a real plain Node timer, not a mocked clock or a fleet bypass.
    // It outlives the original work-only deadline but fits the control allowance.
    const wallDeadline =
      admissionDeadlineMs(environment) +
      ADMISSION_POLL_MS +
      ioLatencyBudgetMs(100);
    await run(
      process.execPath,
      ["-e", 'setTimeout(() => console.log("actual-child-completed"), 1500)'],
      root,
      environment,
      root,
      "native-deadline-control",
      100,
      wallDeadline
    );
    const log = fs.readFileSync(
      path.join(root, "native-deadline-control.log"),
      "utf8"
    );
    expect(log).toContain("actual-child-completed");
    expect(log).toContain("exit=0 signal=null");
  });
});
