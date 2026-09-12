/** Caching must reuse downloads without bypassing installation or gate policy. */
import { describe, expect, it } from "vitest";

import { jobOf, loadWorkflow } from "../helpers/workflow-test-utils.js";

const workflow = loadWorkflow(".github/workflows/quality.yml");
const savingCacheAction = "actions/cache@v5";
const installingJobs = Object.entries(workflow.jobs).filter(([, job]) =>
  job.steps?.some(step => step.name?.includes("Install dependencies"))
);

describe("quality package download caching", () => {
  it("covers dependency installs and has one unconditional cache publisher", () => {
    expect(installingJobs.length).toBeGreaterThan(0);
    expect(jobOf(workflow, "lisa_identity").if).toBeUndefined();
    const publishers = installingJobs.filter(([, job]) =>
      job.steps?.some(
        step =>
          step.name === "💾 Restore package downloads" &&
          step.uses === savingCacheAction
      )
    );
    expect(publishers.map(([id]) => id)).toEqual(["lisa_identity"]);
  });

  it("still saves build outputs when build caching is enabled", () => {
    const buildCache = Object.values(workflow.jobs)
      .flatMap(job => job.steps ?? [])
      .find(step => step.id === "build_cache");
    expect(buildCache?.uses).toBe(savingCacheAction);
  });

  it("has an explicit opt-out", () => {
    expect(
      workflow.on?.workflow_call?.inputs?.cache_dependencies
    ).toMatchObject({
      type: "boolean",
      default: true,
    });
  });

  it.each(installingJobs)(
    "%s still installs after restoring downloads",
    (id, job) => {
      const steps = job.steps ?? [];
      const installIndex = steps.findIndex(step =>
        step.name?.includes("Install dependencies")
      );
      const install = steps[installIndex];
      const cache = steps[installIndex - 1];
      if (!install || !cache)
        throw new Error("Install or preceding cache step is missing");
      expect(cache.uses).toBe(
        id === "lisa_identity" ? savingCacheAction : "actions/cache/restore@v5"
      );
      expect(cache.if).toBe(
        install.if
          ? `inputs.cache_dependencies && (${install.if})`
          : "inputs.cache_dependencies"
      );
      expect(cache.with?.path).toContain("~/.bun/install/cache");
      expect(cache.with?.path).not.toContain("node_modules");
      expect(cache.with?.key).toContain("runner.os");
      expect(cache.with?.key).toContain("runner.arch");
      expect(cache.with?.key).toContain("inputs.package_manager");
      expect(cache.with?.key).toContain("inputs.node_version");
      expect(cache.with?.key).toContain("hashFiles(");
      expect(install.run).toMatch(/install|ci/);
      expect(install.if ?? "").not.toContain("cache-hit");
      expect(install.run).not.toContain("cache-hit");
    }
  );
});
