/**
 * Tests for the gate-report fragment and the document that wraps it.
 *
 * The report is a viewing surface, not a control — but it is the surface an
 * operator would trust, so the properties worth pinning are the ones where the
 * display layer could re-introduce a collapse the payload was built to
 * prevent. An `unknown` must not acquire a pass's styling, a `not-declared`
 * must not acquire an `off`'s, the header must not add the unknown band into a
 * classified total, and — the fourth outcome the three-state design never
 * sanctioned — no legal row may render silence where a verdict belongs.
 * @module tests/unit/cli/gate-report-preview
 */
import { describe, expect, it } from "vitest";

import {
  commandCell,
  representativeCell,
} from "../../../src/cli/gate-report-rows.js";
import { renderGateReportFragment } from "../../../src/cli/gate-report-fragment.js";
import { renderGateReportPreview } from "../../../src/cli/gate-report-preview.js";
import { REGISTRY } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { buildGateReport } from "../../../src/cli/gate-report.js";
import type {
  GateReport,
  GateReportRow,
} from "../../../src/cli/gate-report-types.js";

import {
  homeFor,
  makeProject,
  shippedPrePush,
  TYPE_CORRECTNESS,
  TYPECHECK,
  TYPECHECK_SCRIPT,
  type FixtureSpec,
} from "./gate-report-fixtures.js";

/**
 * How many gates the registry ships.
 *
 * Derived, never typed. A literal here has to be edited every time the registry
 * grows, and the edit is indistinguishable from the report genuinely dropping a
 * gate — the assertion would be updated to match the bug.
 */
const GATE_COUNT = Object.keys(REGISTRY).length;

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
 * Every gate row of the first table, as markup.
 * @param html - The rendered document
 * @returns One string per row
 */
function allRows(html: string): string[] {
  const body = html.split("<tbody>")[1]?.split("</tbody>")[0] ?? "";
  return body.split("<tr>").filter(candidate => candidate.includes("lgr-gid"));
}

/**
 * The command column of one rendered row.
 * @param row - The row markup
 * @returns The third table cell, which is the command column
 */
function commandColumn(row: string): string {
  return row.split("</td>")[2] ?? "";
}

/**
 * Render a report for a fixture project.
 * @param options - Fixture inputs
 * @returns The report and its rendered page
 */
async function renderFor(
  options: FixtureSpec
): Promise<{ report: GateReport; html: string }> {
  const projectRoot = await makeProject(options);
  const report = await buildGateReport({
    projectRoot,
    offline: true,
    homedir: () => homeFor(projectRoot),
  });
  return { report, html: renderGateReportPreview(report, "a fixture project") };
}

describe("the gate report page", () => {
  it("renders one row per registry gate", async () => {
    const { html } = await renderFor({ config: {} });
    expect(allRows(html)).toHaveLength(GATE_COUNT);
  });

  it("draws an unknown cell in its own style and never as a bucket letter", async () => {
    const { html } = await renderFor({ config: {} });
    const row = rowFor(html, TYPE_CORRECTNESS);
    expect(row).toContain(">not checked here<");
    expect(row).not.toContain('class="lgr-chip lgr-b-A"');
  });

  it("keeps declared-off visually distinct from never-declared", async () => {
    const { html } = await renderFor({
      config: { gates: { "test-node-suites": { push: "off" } } },
    });
    const off = rowFor(html, "test-node-suites");
    expect(off).toContain('class="lgr-state lgr-off"');
    // `type-correctness` is legal at push and this fixture never mentions it,
    // so it is the never-declared case at a moment that actually has a column.
    const undeclared = rowFor(html, TYPE_CORRECTNESS);
    expect(undeclared).toContain('class="lgr-state lgr-undeclared"');
    expect(undeclared).not.toContain('class="lgr-state lgr-off"');
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

  it("refuses the cloud-job wiring question in a project with no workflow", async () => {
    const { html } = await renderFor({ config: {} });
    const row = rowFor(html, "dependency-vulnerability");
    expect(row).toContain("npm_security_scan");
    expect(row).toContain("reads the declaration:");
    expect(row).toContain("which this project does not have");
    expect(row).toContain(">not checked here<");
  });

  it("is deterministic for an unchanged report", async () => {
    const projectRoot = await makeProject({ config: {} });
    const report = await buildGateReport({
      projectRoot,
      offline: true,
      homedir: () => homeFor(projectRoot),
    });
    expect(renderGateReportPreview(report, "x")).toBe(
      renderGateReportPreview(report, "x")
    );
  });
});

describe("the command column, which may never fall silent", () => {
  it("renders a chip on every legal row", async () => {
    const { html } = await renderFor({
      config: {
        gates: {
          [TYPE_CORRECTNESS]: { push: "required" },
          "code-review": {
            "pull-request": { level: "required", await: "CodeRabbit" },
          },
        },
      },
      scripts: { [TYPECHECK]: TYPECHECK_SCRIPT },
    });
    for (const row of allRows(html)) {
      expect(commandColumn(row)).toContain("lgr-chip");
    }
  });

  it("says an awaited gate has no task rather than showing nothing", async () => {
    const { html } = await renderFor({
      config: {
        gates: {
          "code-review": {
            "pull-request": { level: "required", await: "CodeRabbit" },
          },
        },
      },
    });
    expect(commandColumn(rowFor(html, "code-review"))).toContain(
      ">no task here<"
    );
  });

  it("says why rather than emitting nothing when a row has no cell to show", () => {
    const orphan = {
      id: "off-axis",
      label: "off axis",
      summary: "",
      legalMoments: ["pre-deploy"],
      defaultTask: "some:task",
      taskAt: {},
      projectTask: null,
      mayRewrite: false,
      costly: false,
      interceptor: null,
      qualityJob: null,
      moments: [],
      merge: { state: "verified", value: { verdict: "no", context: null } },
    } as unknown as GateReportRow;
    expect(representativeCell(orphan)).toBeUndefined();
    expect(commandCell(orphan)).toContain("lgr-chip");
    expect(commandCell(orphan)).toContain("no column here");
  });
});

describe("command provenance, which decides who fixes it", () => {
  it("writes a project override as `here:`", async () => {
    const { html } = await renderFor({
      config: {
        gates: { [TYPE_CORRECTNESS]: { run: "tsc:strict", push: "required" } },
      },
    });
    const column = commandColumn(rowFor(html, TYPE_CORRECTNESS));
    expect(column).toContain("here:");
    expect(column).toContain("tsc:strict");
    expect(column).not.toContain("everyone:");
  });

  it("writes a registry swap as `everyone:`", async () => {
    const { report, html } = await renderFor({
      config: { gates: { traceability: { push: "required" } } },
    });
    const swapped = report.gates.find(row => row.id === "traceability");
    expect(Object.keys(swapped?.taskAt ?? {}).length).toBeGreaterThan(0);
    expect(commandColumn(rowFor(html, "traceability"))).toContain("everyone:");
  });

  it("adds no override line when Lisa's default is what runs", async () => {
    const { html } = await renderFor({
      config: { gates: { [TYPE_CORRECTNESS]: { push: "required" } } },
    });
    const column = commandColumn(rowFor(html, TYPE_CORRECTNESS));
    expect(column).not.toContain("here:");
    expect(column).not.toContain("everyone:");
  });
});

describe("the fragment, which is a tab and not a page", () => {
  it("carries no document wrapper", async () => {
    const projectRoot = await makeProject({ config: {} });
    const report = await buildGateReport({
      projectRoot,
      offline: true,
      homedir: () => homeFor(projectRoot),
    });
    const fragment = renderGateReportFragment(report, "a fixture project");
    expect(fragment).not.toContain("<!doctype");
    expect(fragment).not.toContain("<html");
    expect(fragment).not.toContain("<body");
    expect(fragment.startsWith('<div class="lisa-gate-report">')).toBe(true);
  });

  it("scopes every style rule so it cannot reach the console around it", async () => {
    const projectRoot = await makeProject({ config: {} });
    const report = await buildGateReport({
      projectRoot,
      offline: true,
      homedir: () => homeFor(projectRoot),
    });
    const style = renderGateReportFragment(report, "x")
      .split("<style>")[1]
      ?.split("</style>")[0];
    const selectors = (style ?? "")
      .split("}")
      .map(rule => rule.split("{")[0]?.trim() ?? "")
      .filter(selector => selector.length > 0);
    expect(selectors.length).toBeGreaterThan(10);
    for (const selector of selectors) {
      expect(selector.startsWith(".lisa-gate-report")).toBe(true);
    }
  });

  it("is the same renderer the document uses, so the two cannot disagree", async () => {
    const projectRoot = await makeProject({ config: {} });
    const report = await buildGateReport({
      projectRoot,
      offline: true,
      homedir: () => homeFor(projectRoot),
    });
    expect(renderGateReportPreview(report, "p")).toContain(
      renderGateReportFragment(report, "p")
    );
  });
});
