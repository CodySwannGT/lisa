/**
 * Tests for the standalone gate-report preview page.
 *
 * The page is a viewing surface, not a control — but it is the surface an
 * operator would trust, so the one property worth pinning is that the display
 * layer cannot re-introduce the collapse the payload was built to prevent. An
 * `unknown` must not acquire a pass's styling, a `not-declared` must not
 * acquire an `off`'s, and the header must not add the unknown band into a
 * classified total.
 * @module tests/unit/cli/gate-report-preview
 */
import { describe, expect, it } from "vitest";

import { renderGateReportPreview } from "../../../src/cli/gate-report-preview.js";
import { buildGateReport } from "../../../src/cli/gate-report.js";
import type { GateReport } from "../../../src/cli/gate-report-types.js";

import {
  makeProject,
  shippedPrePush,
  TYPE_CORRECTNESS,
  TYPECHECK,
  TYPECHECK_SCRIPT,
} from "./gate-report-fixtures.js";

/**
 * The one table row for a gate, extracted from the rendered page.
 * @param html - The rendered document
 * @param gateId - Registry gate id
 * @returns That gate's row markup
 */
function rowFor(html: string, gateId: string): string {
  const body = html.split("<tbody>")[1]?.split("</tbody>")[0] ?? "";
  const row = body
    .split("<tr>")
    .find(candidate => candidate.includes(`>${gateId}<`));
  if (row === undefined) throw new Error(`no rendered row for ${gateId}`);
  return row;
}

/**
 * Render a report for a fixture project.
 * @param options - Fixture inputs
 * @param options.config - The settings file body
 * @param options.scripts - package.json scripts
 * @param options.hooks - Hook files
 * @returns The report and its rendered page
 */
async function renderFor(options: {
  config?: unknown;
  scripts?: Record<string, string>;
  hooks?: Record<string, string>;
}): Promise<{ report: GateReport; html: string }> {
  const projectRoot = await makeProject(options);
  const report = await buildGateReport({ projectRoot, offline: true });
  return { report, html: renderGateReportPreview(report, "a fixture project") };
}

describe("the preview page", () => {
  it("renders one row per registry gate", async () => {
    const { html } = await renderFor({ config: {} });
    const body = html.split("<tbody>")[1]?.split("</tbody>")[0] ?? "";
    expect(body.split("<tr>").length - 1).toBe(34);
  });

  it("draws an unknown cell in its own style and never as a bucket letter", async () => {
    const { html } = await renderFor({ config: {} });
    const row = rowFor(html, TYPE_CORRECTNESS);
    expect(row).toContain(">not checked here<");
    expect(row).not.toContain('class="chip b-A"');
    expect(row).not.toContain('class="chip b-D"');
  });

  it("keeps declared-off visually distinct from never-declared", async () => {
    const { html } = await renderFor({
      config: { gates: { "test-node-suites": { push: "off" } } },
    });
    const off = rowFor(html, "test-node-suites");
    expect(off).toContain('class="state off"');
    // `type-correctness` is legal at push and this fixture never mentions it,
    // so it is the never-declared case at a moment that actually has a column.
    const undeclared = rowFor(html, TYPE_CORRECTNESS);
    expect(undeclared).toContain('class="state undeclared"');
    expect(undeclared).not.toContain('class="state off"');
  });

  it("states the unknown band separately from the classified total", async () => {
    const { report, html } = await renderFor({
      config: { gates: { [TYPE_CORRECTNESS]: { push: "required" } } },
      hooks: { "pre-push": shippedPrePush([TYPE_CORRECTNESS]) },
      scripts: { [TYPECHECK]: TYPECHECK_SCRIPT },
    });
    const classified =
      report.summary.buckets.A +
      report.summary.buckets.B +
      report.summary.buckets.C +
      report.summary.buckets.D;
    expect(html).toContain(
      `<strong>${String(classified)} of ${String(report.summary.legalCells)}</strong>`
    );
    expect(html).toContain(
      `<strong>${String(report.summary.bucketUnknown)}</strong>`
    );
    expect(classified + report.summary.bucketUnknown).toBe(
      report.summary.legalCells
    );
  });

  it("says branch protection was not read rather than showing an empty list", async () => {
    const { html } = await renderFor({ config: {} });
    expect(html).toContain("Branch protection was not read this run");
    expect(html).toContain("offline");
    expect(html).not.toContain("Required, not declared");
  });

  it("marks a declared gate with no script rather than leaving it blank", async () => {
    const { html } = await renderFor({
      config: { gates: { [TYPE_CORRECTNESS]: { push: "required" } } },
      scripts: {},
    });
    expect(rowFor(html, TYPE_CORRECTNESS)).toContain(">no such script<");
  });

  it("labels every cloud job cell as not checkable rather than as wired", async () => {
    const { html } = await renderFor({ config: {} });
    const row = rowFor(html, "dependency-vulnerability");
    expect(row).toContain("npm_security_scan");
    expect(row).toContain("reads the declaration: not checkable here");
  });

  it("escapes text that would otherwise break out of the markup", () => {
    const hostile = {
      version: 1,
      registrySource: { state: "verified", value: "lisa-package" },
      runner: { state: "verified", value: 'npm run"><script>x()</script>' },
      runnerSource: "declared",
      momentAxis: ["push"],
      declarationProblems: [],
      gates: [],
      skipJobs: { state: "verified", value: [] },
      ruleset: {
        state: "unknown",
        reason: "<img src=x onerror=y>",
        message: "m",
      },
      summary: {
        gateCount: 0,
        momentCount: 1,
        governedBySettings: 0,
        declaredOffOnly: 0,
        notDeclared: 0,
        legalCells: 0,
        buckets: { A: 0, B: 0, C: 0, D: 0 },
        bucketUnknown: 0,
        declaredWithoutCommand: 0,
        provedAnyway: 0,
      },
    } as unknown as GateReport;
    const html = renderGateReportPreview(hostile, "<b>label</b>");
    expect(html).not.toContain("<script>x()</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;b&gt;label&lt;/b&gt;");
  });

  it("is deterministic for an unchanged report", async () => {
    const projectRoot = await makeProject({ config: {} });
    const report = await buildGateReport({ projectRoot, offline: true });
    expect(renderGateReportPreview(report, "x")).toBe(
      renderGateReportPreview(report, "x")
    );
  });
});
