/**
 * Nothing in the report may reach the browser as markup.
 *
 * Its own file because the payload is deliberately hostile in every field the
 * renderer touches, and every section the report gains adds fields to it. Kept
 * beside the preview test rather than inside it so neither has to be trimmed
 * to stay within a line budget — trimming this one would mean dropping a field
 * from the hostile payload, which is exactly how an escaping hole ships.
 * @module tests/unit/cli/gate-report-preview-escaping
 */
import { describe, expect, it } from "vitest";

import { renderGateReportPreview } from "../../../src/cli/gate-report-preview.js";
import type { GateReport } from "../../../src/cli/gate-report-types.js";

describe("renderGateReportPreview", () => {
  it("escapes text that would otherwise break out of the markup", () => {
    const hostile = {
      version: 2,
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
      declarationDrift: {
        templates: {
          state: "verified",
          value: {
            surface: "ruleset-templates",
            entries: [
              {
                context: '<svg onload="y()">',
                verdict: "enforced-undeclared",
                remedy: "declare-the-gate",
                gateId: "<i>gate</i>",
                declaration: "not-declared",
                rulesets: ["quality checks"],
                sources: ["typescript/github-rulesets/quality-checks.json"],
                detail: "<b>detail</b>",
              },
            ],
            counts: {
              matched: 0,
              "declared-not-enforced": 0,
              "enforced-declared-optional": 0,
              "enforced-declared-off": 0,
              "enforced-undeclared": 1,
              "enforced-not-lisa-owned": 0,
              "enforced-awaited-elsewhere": 0,
            },
            contradictions: 0,
            gaps: 1,
          },
        },
        live: {
          state: "unknown",
          reason: "<img src=z onerror=y>",
          message: "m",
        },
      },
      requiredContexts: {
        state: "unknown",
        reason: "<svg onload=z>",
        message: "m",
      },
      agentHooks: { state: "verified", value: [] },
      facadeSource: { present: false, files: [] },
      upstream: [],
      projectIsUpstream: false,
      summary: {
        gateCount: 0,
        momentCount: 1,
        governedBySettings: 0,
        declaredOffOnly: 0,
        notDeclared: 0,
        legalCells: 0,
        buckets: { A: 0, B: 0, C: 0, D: 0 },
        bucketUnknown: 0,
        bucketUnknownUpstream: 0,
        declaredWithoutCommand: 0,
        provedAnyway: 0,
      },
    } as unknown as GateReport;
    const html = renderGateReportPreview(hostile, "<b>label</b>");
    expect(html).not.toContain("<script>x()</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<img src=z");
    expect(html).not.toContain('<svg onload="y()">');
    expect(html).not.toContain("<b>detail</b>");
    expect(html).not.toContain("<svg onload=z>");
    expect(html).toContain("&lt;b&gt;label&lt;/b&gt;");
  });
});
