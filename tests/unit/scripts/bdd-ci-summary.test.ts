/** Actual CLI coverage summaries must describe the same run that sets its exit. */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { codes, healthyProject, makeProject, runGate } from "./bdd/support.js";
import { cli, makeHistory } from "./bdd/projection-merge-support.js";

const GATE_SCRIPT = "check-bdd-coverage.mjs";
const SUMMARY_WRITE_ERROR = "ci-summary-write";
const SUMMARY_NAME = "ci-summary.md";

describe("BDD CI aggregate summary", () => {
  it("reports calculated totals from a genuinely successful native gate run", () => {
    const { root, base } = makeHistory(false);
    const summary = path.join(root, ".git", SUMMARY_NAME);
    const run = cli(root, base, GATE_SCRIPT, ["--json"], {
      GITHUB_STEP_SUMMARY: summary,
    });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout).status).toBe("completed");
    const body = fs.readFileSync(summary, "utf8");
    expect(body).toContain("completed");
    expect(body).toContain("10/10 (100.0%)");
    expect(body).toContain("10 mapped tests exist");
    expect(body).toContain("No execution evidence was supplied");
  });

  it("publishes genuine totals even when the original gate run fails", () => {
    const root = healthyProject();
    const summary = path.join(root, SUMMARY_NAME);
    const run = runGate(root, { GITHUB_STEP_SUMMARY: summary });
    expect(run.status).toBe(1);
    expect(codes(run)).toContain("baseline");
    expect(fs.existsSync(summary)).toBe(true);
    const body = fs.readFileSync(summary, "utf8");
    expect(body).toContain("1/1 (100.0%)");
    expect(body).toContain("No execution evidence was supplied");
    expect(body).toContain("baseline");
    expect(body).toContain("failed");
  });

  it("reports unavailable totals for malformed input instead of inventing zeros", () => {
    const root = makeProject({ map: "{not-json" });
    const summary = path.join(root, SUMMARY_NAME);
    const run = runGate(root, { GITHUB_STEP_SUMMARY: summary });
    expect(run.status).toBe(1);
    expect(codes(run)).toContain("config-malformed");
    expect(fs.existsSync(summary)).toBe(true);
    const body = fs.readFileSync(summary, "utf8");
    expect(body).toContain("Global totals unavailable");
    expect(body).toContain("config-malformed");
    expect(body).not.toContain("0/0");
  });

  it("keeps the original failure and reports a summary write error", () => {
    const root = healthyProject();
    const run = runGate(root, { GITHUB_STEP_SUMMARY: root });
    expect(run.status).toBe(1);
    expect(codes(run)).toContain("baseline");
    expect(codes(run)).toContain(SUMMARY_WRITE_ERROR);
    expect(run.stderr).toContain(SUMMARY_WRITE_ERROR);
  });

  it("fails a successful gate when its native summary cannot be written", () => {
    const { root, base } = makeHistory(false);
    const run = cli(root, base, GATE_SCRIPT, ["--json"], {
      GITHUB_STEP_SUMMARY: root,
    });
    expect(run.status).toBe(1);
    const envelope = JSON.parse(run.stdout);
    expect(envelope.status).toBe("failed");
    expect(
      envelope.findings.map((item: { code: string }) => item.code)
    ).toEqual([SUMMARY_WRITE_ERROR]);
  });
});
