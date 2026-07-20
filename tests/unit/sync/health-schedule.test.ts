import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runConfigSync } from "../../../src/sync/config-sync.js";
import { SYNC_REGISTRY } from "../../../src/sync/registry.js";
import { readJson, writeJson } from "../../../src/utils/index.js";

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(tmpdir(), "lisa-health-sync-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const configPath = (): string => path.join(projectRoot, ".lisa.config.json");

describe("health.schedule sync contract", () => {
  it("registers only health.schedule and validates its closed vocabulary", () => {
    const healthEntries = SYNC_REGISTRY.filter(entry =>
      entry.key.startsWith("health.")
    );

    expect(healthEntries.map(entry => entry.key)).toEqual(["health.schedule"]);
    expect(healthEntries[0]?.defaultValue).toBe("off");
    expect(healthEntries[0]?.validate?.("daily")).toBe("daily");
    expect(() => healthEntries[0]?.validate?.("hourly")).toThrow(
      /health\.schedule/
    );
  });

  it("populates off with literal provenance and is idempotent", async () => {
    const first = await runConfigSync(projectRoot);
    const config = await readJson<Record<string, unknown>>(configPath());

    expect(config.health).toEqual({ schedule: "off" });
    expect(config._lisaSync).toMatchObject({
      populated: { "health.schedule": "off" },
    });
    expect(first.actions).toContainEqual(
      expect.objectContaining({
        key: "health.schedule",
        kind: "populated-default",
      })
    );
    expect((await runConfigSync(projectRoot)).actions).toEqual([]);
  });

  it.each(["daily", "weekly"])(
    "preserves human value %s without provenance",
    async schedule => {
      await writeJson(configPath(), { health: { schedule } });
      await runConfigSync(projectRoot);
      const config = await readJson<Record<string, unknown>>(configPath());

      expect(config.health).toEqual({ schedule });
      expect(
        (config._lisaSync as { populated: Record<string, unknown> }).populated[
          "health.schedule"
        ]
      ).toBeUndefined();
    }
  );

  it("rejects invalid committed and local values without rewriting either file", async () => {
    const localPath = path.join(projectRoot, ".lisa.config.local.json");
    await writeJson(configPath(), { health: { schedule: "hourly" } });
    await expect(runConfigSync(projectRoot)).rejects.toThrow(
      /health\.schedule/
    );
    expect(await readJson(configPath())).toEqual({
      health: { schedule: "hourly" },
    });

    await writeJson(configPath(), {});
    await writeJson(localPath, { health: { schedule: "monthly" } });
    await expect(runConfigSync(projectRoot)).rejects.toThrow(
      /health\.schedule/
    );
    expect(await readJson(localPath)).toEqual({
      health: { schedule: "monthly" },
    });
  });

  it("never places runtime state in committed or local config", async () => {
    await runConfigSync(projectRoot);
    const serialized = JSON.stringify(await readJson(configPath()));
    expect(serialized).not.toContain("latest.json");
    expect(serialized).not.toContain("completedAt");
  });
});
