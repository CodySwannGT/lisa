/**
 * `lisa sync` ships `workItem.estimate` required by default
 * (CodySwannGT/lisa#4954), keeps a project's own valid value, and refuses an
 * invalid one.
 * @module tests/unit/sync/work-item-estimate-sync
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_ESTIMATE_MODELS } from "../../../all/copy-overwrite/scripts/lib/work-item-estimate-config.mjs";
import { runConfigSync } from "../../../src/sync/config-sync.js";
import { SYNC_REGISTRY } from "../../../src/sync/registry.js";
import { readJson, writeJson } from "../../../src/utils/index.js";

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(tmpdir(), "lisa-estimate-sync-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const configPath = (): string => path.join(projectRoot, ".lisa.config.json");

describe("workItem.estimate sync contract", () => {
  it("registers a required-by-default entry with the shipped model list", () => {
    const entry = SYNC_REGISTRY.find(item => item.key === "workItem.estimate");
    expect(entry?.defaultValue).toEqual({
      required: true,
      models: [...DEFAULT_ESTIMATE_MODELS],
    });
    expect(() => entry?.validate?.({ required: "maybe" })).toThrow(/required/);
  });

  it("populates the default into a config that has none", async () => {
    await runConfigSync(projectRoot);
    const config = await readJson<Record<string, unknown>>(configPath());
    expect(config.workItem).toEqual({
      estimate: { required: true, models: [...DEFAULT_ESTIMATE_MODELS] },
    });
  });

  it("keeps a project's own choice to turn it off, filling only missing keys", async () => {
    await writeJson(configPath(), {
      workItem: { verify: "full", estimate: { required: false } },
    });
    await runConfigSync(projectRoot);
    const config = await readJson<Record<string, unknown>>(configPath());
    expect(config.workItem).toEqual({
      verify: "full",
      estimate: { required: false, models: [...DEFAULT_ESTIMATE_MODELS] },
    });
  });

  it("refuses an invalid value without rewriting the file", async () => {
    await writeJson(configPath(), { workItem: { estimate: { models: [] } } });
    await expect(runConfigSync(projectRoot)).rejects.toThrow(/models/);
    expect(await readJson(configPath())).toEqual({
      workItem: { estimate: { models: [] } },
    });
  });
});
