/** Controlled Yarn reports validate completeness per severity, not live registry state. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateAuditReport } from "../../../src/core/audit.js";

const GHSA = "GHSA-aaaa-bbbb-cccc";
const roots: string[] = [];
/** Severity categories whose missing material must block the audit. */
type Severity = "high" | "critical";

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * Evaluate a controlled stream whose supplied advisories all have legacy exclusions.
 * @param counts - Provider occurrence counts by governed severity
 * @param material - Severities with actual advisory detail in the stream
 * @returns The actual canonical exclusion verdict
 */
function evaluate(
  counts: Record<Severity, number>,
  material: readonly Severity[]
) {
  const root = mkdtempSync(join(tmpdir(), "lisa-audit-completeness-"));
  const lines = [
    ...material.map(severity => ({
      type: "auditAdvisory",
      data: {
        advisory: { severity, github_advisory_id: GHSA, module_name: "zod" },
      },
    })),
    { type: "auditSummary", data: { vulnerabilities: counts } },
  ];
  roots.push(root);
  writeFileSync(
    join(root, "audit.ignore.local.json"),
    JSON.stringify({ exclusions: [{ id: GHSA }] })
  );
  return evaluateAuditReport(
    root,
    "yarn",
    lines.map(line => JSON.stringify(line)).join("\n")
  );
}

describe("Yarn report completeness before applying exclusions", () => {
  it.each(["high", "critical"] as const)(
    "does not let an excluded opposite severity hide missing %s material",
    missing => {
      const provided = missing === "high" ? "critical" : "high";
      expect(() => evaluate({ high: 1, critical: 1 }, [provided])).toThrow(
        `without concrete advisory data for ${missing}`
      );
    }
  );

  it.each(["high", "critical"] as const)(
    "accepts a complete single-%s report under the same legacy exclusion",
    severity => {
      const counts = {
        high: severity === "high" ? 1 : 0,
        critical: severity === "critical" ? 1 : 0,
      };
      expect(evaluate(counts, [severity]).passed).toBe(true);
    }
  );

  it("accepts an excluded report with concrete material at both positive severities", () => {
    expect(
      evaluate({ high: 1, critical: 1 }, ["high", "critical"]).passed
    ).toBe(true);
  });

  it("does not mistake occurrence counts for the number of advisory records", () => {
    expect(evaluate({ high: 2, critical: 0 }, ["high"]).passed).toBe(true);
  });
});
