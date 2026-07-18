/**
 * Cross-surface regression coverage for GitHub umbrella build queues (#1617).
 * @module tests/unit/strategies/github-umbrella-queue-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = (relativePath: string): string =>
  readFileSync(path.resolve("plugins/src/base", relativePath), "utf8");

describe("GitHub umbrella build queue contract (#1617)", () => {
  it("documents the same precedence and identity split across queue consumers", () => {
    const config = source("rules/reference/config-resolution.md");
    const build = source("skills/lisa-github-build-intake/SKILL.md");
    const intake = source("skills/lisa-intake/SKILL.md");
    const repair = source("skills/lisa-repair-intake/SKILL.md");
    const status = source("skills/lisa-queue-status/SKILL.md");

    for (const contract of [config, build, intake, repair, status]) {
      expect(contract).toContain("github.queueRepo");
      expect(contract).toContain("repo:<");
    }
    expect(build).toMatch(
      /explicit `org\/repo` token or GitHub URL always wins/i
    );
    expect(repair).toContain("build_queue=owner/repo");
    expect(repair).toMatch(/bounded split scan/i);
    expect(status).toContain("Identity repo: <owner/repo>");
    expect(status).toContain("Queue repo: <owner/repo>");
  });

  it("keeps setup and automation commands lane-safe", () => {
    const githubSetup = source("skills/lisa-setup-github/SKILL.md");
    const automationSetup = source("skills/lisa-setup-automations/SKILL.md");

    expect(githubSetup).toContain('LABEL_ORG="$QUEUE_ORG"');
    expect(githubSetup).toContain('LABEL_ORG="$ORG"');
    expect(githubSetup).toContain("del(.github.queueRepo)");
    expect(automationSetup).toContain(
      "/lisa:repair-intake acme/frontend intake_mode=both build_queue=acme/planning"
    );
    expect(automationSetup).toContain(
      "/lisa:intake acme/frontend intake_mode=prd"
    );
    expect(automationSetup).toContain(
      "/lisa:intake acme/planning intake_mode=build"
    );
  });
});
