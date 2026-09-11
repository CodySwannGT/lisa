/** Bundle transfer saves one export and must never suppress either check. */
import { githubCondition } from "../helpers/github-expression.js";
import { describe, expect, it } from "vitest";

import { jobOf, loadWorkflow } from "../helpers/workflow-test-utils.js";

const quality = loadWorkflow(".github/workflows/quality.yml");
const zap = loadWorkflow(".github/workflows/zap-baseline-expo.yml");
const producer = jobOf(quality, "performance_budget").steps ?? [];
const consumer = Object.values(zap.jobs).flatMap(job => job.steps ?? []);

describe("shared quality web export", () => {
  it("is opt-in for both workflows", () => {
    expect(quality.on?.workflow_call?.inputs?.publish_web_export?.default).toBe(
      false
    );
    expect(
      zap.on?.workflow_call?.inputs?.reuse_quality_web_export?.default
    ).toBe(false);
  });

  it("uses the same artifact from this run and attempt only", () => {
    const upload = producer.find(
      step => step.name === "📦 Share the web export with downstream checks"
    );
    const download = consumer.find(step => step.id === "shared_export");
    const expected =
      "quality-web-export-${{ github.run_id }}-${{ github.run_attempt }}";
    expect(upload?.with?.name).toBe(expected);
    expect(upload?.uses).toBe("actions/upload-artifact@v7");
    expect(upload?.run).toBeUndefined();
    expect(upload?.with?.["include-hidden-files"]).toBe(true);
    expect(download?.with?.name).toBe(expected);
    expect(download?.with?.path).toBe("dist");
    expect(download?.with).not.toHaveProperty("run-id");
    expect(upload?.if).toBe(
      "inputs.publish_web_export && steps.performance_web_export.outcome == 'success'"
    );
    expect(upload).toHaveProperty("continue-on-error", true);
    expect(download).toHaveProperty("continue-on-error", true);
  });

  it.each([
    ["success", false],
    ["failure", true],
    ["skipped", true],
    ["", true],
  ])("download %s means rebuilding is %s", (outcome, rebuild) => {
    const build = consumer.find(step => step.name === "Build web export");
    expect(
      githubCondition(build?.if ?? "false", {
        steps: { shared_export: { outcome } },
      })
    ).toBe(rebuild);
    expect(build?.run).toBe("npx expo export --platform web");
  });

  it("still runs ZAP after bundle reuse", () => {
    const scan = consumer.find(step => step.name === "Run ZAP baseline scan");
    expect(scan?.uses).toContain("zaproxy/action-baseline@");
    expect(scan?.if).toBeUndefined();
  });
});
