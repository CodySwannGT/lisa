/**
 * Tests for the `skip_jobs` migration section.
 *
 * The emitter computed this table from the first day and the renderer showed
 * none of it — the same "computed, then discarded" shape as the command chip,
 * the provenance line and the merge verdict. It is also the closest v1 gets to
 * an action a reader can take: the report never writes a declaration, but it
 * hands over the exact line to paste.
 * @module tests/unit/cli/gate-report-skip-jobs-render
 */
import { describe, expect, it } from "vitest";

import { renderGateReportFragment } from "../../../src/cli/gate-report-fragment.js";
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

describe("the skip_jobs migration, which the renderer used to discard", () => {
  it("hands over the declaration that replaces each token", async () => {
    const html = renderGateReportFragment(
      await reportForwarding(["lint", "not_a_real_token"]),
      "a fixture project"
    );
    expect(html).toContain("switches off by name");
    expect(html).toContain(">lint<");
    expect(html).toContain(">replaceable<");
    // A token this workflow has never had is a finding, not a blank: it
    // switches nothing off and the project may well believe otherwise.
    expect(html).toContain(">not_a_real_token<");
    expect(html).toContain(">unknown<");
  });

  it("says a project forwards none rather than rendering an empty table", async () => {
    const html = renderGateReportFragment(
      await reportForwarding([]),
      "a fixture project"
    );
    expect(html).toContain("forwards no <code>skip_jobs</code> tokens");
  });
});
