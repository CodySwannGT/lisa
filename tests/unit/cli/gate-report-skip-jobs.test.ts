/**
 * Tests for the `skip_jobs` migration rows in the gate report.
 *
 * `lisa doctor --json` carries these rows. They are the closest the report
 * gets to an action a reader can take: it never writes a declaration, but it
 * hands over the exact gate that replaces each forwarded token. These cases
 * used to assert on the console's HTML; they now assert on the report data
 * that `lisa doctor` emits.
 * @module tests/unit/cli/gate-report-skip-jobs
 */
import { describe, expect, it } from "vitest";

import { buildGateReport } from "../../../src/cli/gate-report.js";
import type { GateReport } from "../../../src/cli/gate-report-types.js";

import { homeFor, makeProject } from "./gate-report-fixtures.js";

/**
 * Build a report whose forwarded `skip_jobs` tokens are the given ones.
 * @param tokens - The tokens the project's own caller forwards
 * @returns The report
 */
async function reportForwarding(
  tokens: readonly string[]
): Promise<GateReport> {
  const projectRoot = await makeProject({ config: {} });
  return await buildGateReport({
    projectRoot,
    offline: true,
    homedir: () => homeFor(projectRoot),
    readSkipJobTokens: async () => tokens,
  });
}

describe("the skip_jobs migration rows", () => {
  it("resolves a known token to the gate that replaces it", async () => {
    const report = await reportForwarding(["lint", "not_a_real_token"]);

    expect(report.skipJobs.state).toBe("verified");
    if (report.skipJobs.state !== "verified") return;
    const byToken = new Map(report.skipJobs.value.map(row => [row.token, row]));
    expect(byToken.get("lint")).toMatchObject({ status: "replaceable" });
    expect(byToken.get("lint")?.gate).toBeTruthy();
    // A token this workflow has never had is a finding, not a blank: it
    // switches nothing off and the project may well believe otherwise.
    expect(byToken.get("not_a_real_token")).toMatchObject({
      status: "unknown",
    });
  });

  it("reports an empty list, not an absence, when a project forwards none", async () => {
    const report = await reportForwarding([]);

    expect(report.skipJobs).toEqual({ state: "verified", value: [] });
  });

  it("says why there are no rows when the reader cannot find a quality caller", async () => {
    const projectRoot = await makeProject({ config: {} });
    const report = await buildGateReport({
      projectRoot,
      offline: true,
      homedir: () => homeFor(projectRoot),
      readSkipJobTokens: async () => {
        throw new Error("no ci.yml");
      },
    });

    expect(report.skipJobs).toMatchObject({
      state: "not-applicable",
      reason: "no-quality-caller",
    });
  });
});
