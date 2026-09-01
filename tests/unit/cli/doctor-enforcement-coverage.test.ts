/**
 * Doctor reports what THIS checkout resolves, separating "resolves nothing"
 * from "resolves something old" the same way the fleet census does.
 *
 * The distinction is the whole point: a stale copy still refuses things and
 * names its vintage in every refusal, while a checkout resolving nothing is
 * silent. Reporting both as one "enforcement is stale" line would lose the
 * serious half exactly where an operator goes looking for it
 * (CodySwannGT/lisa#3490).
 */
import { afterEach, describe, expect, it } from "vitest";

import { checkEnforcementCoverage } from "../../../src/cli/doctor-enforcement-coverage.js";
import {
  ALL_GUARDS,
  buildFleet,
  type Fleet,
} from "../../helpers/enforcement-census-fixtures.js";

let fleet: Fleet | null = null;

afterEach(() => {
  fleet?.cleanup();
  fleet = null;
});

describe("doctor enforcement coverage", () => {
  it("warns that a checkout resolves NO guard, and says it is not staleness", async () => {
    fleet = buildFleet([{ name: "bare" }]);
    const check = await checkEnforcementCoverage(fleet.checkoutPath("bare"));

    expect(check.status).toBe("warn");
    expect(check.detail).toContain("resolves NO Lisa enforcement guard");
    expect(check.detail).toContain("Not a stale guard — none");
    expect(check.detail).toContain("npx @codyswann/lisa apply");
  });

  it("warns about a copy that cannot be dated rather than calling it current", async () => {
    fleet = buildFleet([{ name: "undated", pluginGuards: ALL_GUARDS }]);
    const check = await checkEnforcementCoverage(fleet.checkoutPath("undated"));

    expect(check.status).toBe("warn");
    expect(check.detail).toContain("cannot be shown current");
  });

  it("warns when the installed Lisa is behind what the project declares", async () => {
    fleet = buildFleet([
      {
        name: "drifted",
        hostGuards: ALL_GUARDS,
        receiptVersion: "99.0.0",
        declared: "^4.23.20",
        installed: "3.23.0",
      },
    ]);
    const check = await checkEnforcementCoverage(fleet.checkoutPath("drifted"));

    expect(check.status).toBe("warn");
    expect(check.detail).toContain("about a version nobody is running");
  });

  it("names the guards a partial checkout resolves nothing for", async () => {
    fleet = buildFleet([
      {
        name: "partial",
        hostGuards: ALL_GUARDS.slice(0, 2),
        receiptVersion: "99.0.0",
      },
    ]);
    const check = await checkEnforcementCoverage(fleet.checkoutPath("partial"));

    expect(check.status).toBe("warn");
    expect(check.detail).toContain("2 of 6 guards resolve");
  });

  it("passes a checkout that resolves every guard from a current, receipted copy", async () => {
    fleet = buildFleet([
      { name: "clean", hostGuards: ALL_GUARDS, receiptVersion: "99.0.0" },
    ]);
    const check = await checkEnforcementCoverage(fleet.checkoutPath("clean"));

    expect(check.status).toBe("ok");
    expect(check.detail).toContain("All 6 guards resolve");
  });

  it("never fails, so a checkout mid-upgrade cannot redden doctor", async () => {
    fleet = buildFleet([{ name: "bare" }]);
    const check = await checkEnforcementCoverage(fleet.checkoutPath("bare"));

    expect(check.status).not.toBe("fail");
  });

  it("reports that it could not look rather than reporting coverage", async () => {
    const check = await checkEnforcementCoverage("/nonexistent/checkout");

    expect(check.status).toBe("warn");
    expect(check.detail).toContain("Could not look");
    expect(check.detail).toContain("not the same as being covered");
  });

  it("points at the fleet census for the question it cannot answer alone", async () => {
    fleet = buildFleet([{ name: "bare" }]);
    const check = await checkEnforcementCoverage(fleet.checkoutPath("bare"));

    expect(check.detail).toContain("lisa-enforcement-census.mjs");
  });
});
