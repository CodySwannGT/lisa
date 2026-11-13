import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  knowledgePluginFor,
  validateKnowledgeBackend,
} from "../../../src/core/knowledge-role.js";
import { runConfigSync } from "../../../src/sync/config-sync.js";
import { SYNC_REGISTRY } from "../../../src/sync/registry.js";
import { readJson, writeJson } from "../../../src/utils/index.js";

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(tmpdir(), "lisa-knowledge-sync-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const configPath = (): string => path.join(projectRoot, ".lisa.config.json");

describe("knowledge role", () => {
  it("registers a required role with the llm-wiki default and a closed vocabulary", () => {
    const entry = SYNC_REGISTRY.find(setting => setting.key === "knowledge");

    expect(entry?.defaultValue).toBe("llm-wiki");
    expect(entry?.validate?.("llm-wiki")).toBe("llm-wiki");
    expect(() => entry?.validate?.("confluence")).toThrow(/knowledge/);
  });

  it("populates llm-wiki with provenance and is idempotent", async () => {
    await runConfigSync(projectRoot);
    const config = await readJson<Record<string, unknown>>(configPath());

    expect(config.knowledge).toBe("llm-wiki");
    expect(config._lisaSync).toMatchObject({
      populated: { knowledge: "llm-wiki" },
    });
    expect((await runConfigSync(projectRoot)).actions).toEqual([]);
  });

  it("rejects an unknown backend without rewriting the config", async () => {
    await writeJson(configPath(), { knowledge: "notion" });

    await expect(runConfigSync(projectRoot)).rejects.toThrow(/knowledge/);
    expect(await readJson(configPath())).toEqual({ knowledge: "notion" });
  });

  it("maps the backend to its plugin, reading an absent value as the default", () => {
    expect(knowledgePluginFor(undefined)).toBe("lisa-wiki");
    expect(knowledgePluginFor("llm-wiki")).toBe("lisa-wiki");
    expect(knowledgePluginFor("notion")).toBeUndefined();
    expect(knowledgePluginFor(42)).toBeUndefined();
    expect(() => validateKnowledgeBackend(42)).toThrow(/knowledge/);
  });
});
