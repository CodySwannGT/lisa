/**
 * Contract tests for the generated automation workflow.
 *
 * A generated workflow is easy to get subtly wrong in ways that only show up
 * unattended: a cancelling concurrency group that orphans an accepted remote
 * task, a schedule that goes live before the path was ever proven, or a
 * rotation write-back that is skipped precisely when the dispatch failed.
 * @module tests/unit/secrets/automation-workflow
 */
import { describe, expect, it } from "vitest";

import { renderWorkflow } from "../../../plugins/src/base/skills/lisa-setup-automations/scripts/generate-workflow.mjs";

/** A fully declared loop, targeting a provisioned surface. */
const LOOP = {
  scheduler: "github-actions",
  schedule: "17 * * * *",
  executionEnv: "codex-cloud",
  repository: "org/repo",
  enabled: true,
};

describe("trigger emission", () => {
  it("emits the cron only once the loop is enabled", () => {
    const yaml = renderWorkflow("intake", LOOP);
    expect(yaml).toContain("\n  schedule:\n");
    expect(yaml).toContain("- cron: '17 * * * *'");
  });

  it("withholds the cron while the loop is disabled", () => {
    // A recurring trigger goes live only after the exact production path has
    // been proven once for one real item.
    const yaml = renderWorkflow("intake", { ...LOOP, enabled: false });
    expect(yaml).not.toContain("\n  schedule:\n");
    expect(yaml).toContain("workflow_dispatch:");
  });

  it("keeps the intended cron visible in a comment while disabled", () => {
    const yaml = renderWorkflow("intake", { ...LOOP, enabled: false });
    expect(yaml).toContain("# real item. Enabling adds:  - cron: '17 * * * *'");
  });

  it("always offers manual dispatch, enabled or not", () => {
    expect(renderWorkflow("intake", LOOP)).toContain("workflow_dispatch:");
  });
});

describe("safety properties", () => {
  it("never cancels a dispatch in progress", () => {
    // Cancelling can kill a dispatch after the remote accepted a task but
    // before its identifier was recorded — irreversible work with nothing to
    // reconcile against, where a retry duplicates it.
    expect(renderWorkflow("intake", LOOP)).toContain(
      "cancel-in-progress: false"
    );
  });

  it("scopes the concurrency group to the loop", () => {
    expect(renderWorkflow("intake", LOOP)).toContain("group: lisa-intake");
  });

  it("requests read-only repository permissions", () => {
    expect(renderWorkflow("intake", LOOP)).toContain("contents: read");
  });

  it("guards on the repository so a fork inherits no live clock", () => {
    expect(renderWorkflow("intake", LOOP)).toContain(
      "if: github.repository == 'org/repo'"
    );
  });

  it("checks the bootstrap credential before installing anything", () => {
    const yaml = renderWorkflow("intake", LOOP);
    const assertAt = yaml.indexOf("BWS_ACCESS_TOKEN is not configured");
    const installAt = yaml.indexOf("Prepare the toolchain and secrets");
    expect(assertAt).toBeGreaterThan(-1);
    expect(assertAt).toBeLessThan(installAt);
  });

  it("persists credential rotation even when the dispatch failed", () => {
    // The dispatcher authenticates with a credential that rotates on use, so
    // skipping the write-back on failure is what strands it.
    const yaml = renderWorkflow("intake", LOOP);
    expect(yaml).toMatch(
      /Persist any credential rotation[\s\S]*?if: \$\{\{ always\(\) \}\}/
    );
  });

  it("tells the surface which lane it is running in", () => {
    expect(renderWorkflow("intake", LOOP)).toContain(
      "LISA_SECRETS_SURFACE: github-actions"
    );
  });
});

describe("declaration validation", () => {
  it("refuses a loop with no schedule", () => {
    const { schedule, ...noSchedule } = LOOP;
    expect(() => renderWorkflow("intake", noSchedule)).toThrow(/no schedule/i);
  });

  it("refuses to target a surface that was never provisioned", () => {
    const { repository, ...noRepo } = LOOP;
    expect(() => renderWorkflow("intake", noRepo)).toThrow(
      /setup:remote-env codex-cloud/
    );
  });

  it("defaults the dispatched skill to the loop name", () => {
    expect(renderWorkflow("intake", LOOP)).toContain("--skill lisa-intake");
  });

  it("honours an explicit skill override", () => {
    const yaml = renderWorkflow("intake", {
      ...LOOP,
      skill: "lisa-repair-intake",
    });
    expect(yaml).toContain("--skill lisa-repair-intake");
  });
});
