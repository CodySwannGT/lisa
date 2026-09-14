import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readProjectConfig } from "../../../src/core/project-config.js";
import { runConfigSync } from "../../../src/sync/config-sync.js";
import { readJson, writeJson } from "../../../src/utils/index.js";

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(tmpdir(), "lisa-starter-config-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const configPath = (): string => path.join(projectRoot, ".lisa.config.json");
const templates = [
  {
    repo: "example/app-template",
    ref: "main",
    lastSync: { sha: "abc123", at: "2026-09-01" },
  },
  {
    repo: "example/infra-template",
    ref: "v2",
    lastSync: { sha: "def456", at: "2026-09-02" },
    paths: ["infra/**"],
  },
];
const defaults = {
  strategy: "pull-request",
  auto: false,
  upstreamProposals: false,
  proposalLabel: "starter-upstream-proposal",
};

describe("starter configuration", () => {
  it("reads independent template entries through project config resolution", async () => {
    await writeJson(configPath(), { starter: { templates } });
    expect(await readProjectConfig(projectRoot)).toMatchObject({
      starter: { templates },
    });
  });

  it("populates sync defaults with provenance without stamping a template", async () => {
    await writeJson(configPath(), { starter: { templates } });
    await runConfigSync(projectRoot);
    expect(await readJson(configPath())).toMatchObject({
      starter: { templates, sync: defaults },
      _lisaSync: { populated: { "starter.sync": defaults } },
    });
    expect((await runConfigSync(projectRoot)).actions).toEqual([]);
  });

  it("preserves human sync values and local template overlays", async () => {
    const sync = {
      ...defaults,
      strategy: "direct-when-clean",
      auto: true,
      proposalLabel: "review-proposal",
    };
    await writeJson(configPath(), { starter: { templates, sync } });
    await writeJson(path.join(projectRoot, ".lisa.config.local.json"), {
      starter: { templates: [] },
    });
    await runConfigSync(projectRoot);
    expect(await readJson(configPath())).toMatchObject({
      starter: { templates, sync },
    });
  });

  it.each([
    null,
    [],
    "invalid parent",
    { templates: "not-an-array" },
    { templates: [{ repo: "example/template", ref: "main" }] },
    { templates: [{ ...templates[0], paths: [42] }] },
    { sync: { strategy: "overwrite" } },
    { sync: { auto: "false" } },
    { sync: { upstreamProposals: "true" } },
  ])("rejects malformed starter data before persisting sync", async starter => {
    await writeJson(configPath(), { starter });
    await expect(readProjectConfig(projectRoot)).rejects.toThrow(/starter/);
    await expect(runConfigSync(projectRoot)).rejects.toThrow(/starter/);
    expect(await readJson(configPath())).toEqual({ starter });
  });

  it("preserves malformed local starter containers and the committed file", async () => {
    const localPath = path.join(projectRoot, ".lisa.config.local.json");
    await writeJson(configPath(), { starter: { templates } });
    await writeJson(localPath, { starter: [{ repo: "preserve-this-entry" }] });
    await expect(runConfigSync(projectRoot)).rejects.toThrow(/starter/);
    expect(await readJson(configPath())).toEqual({ starter: { templates } });
    expect(await readJson(localPath)).toEqual({
      starter: [{ repo: "preserve-this-entry" }],
    });
  });
});
