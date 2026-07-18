import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createEnabledPluginsProbe,
  type MarketplacePlugin,
} from "../../../src/cli/ui-enabled-plugins.js";
import { runProbe } from "../../../src/cli/ui-cmd.js";

/** Holder for per-test temp resources. */
interface TestResources {
  dir: string;
  home: string;
}

const resources: TestResources = { dir: "", home: "" };
const ENABLED_PLUGINS_PROBE_ID = "enabled-plugins";
const BASE_GOVERNANCE = "Base governance";

beforeEach(async () => {
  resources.dir = await mkdtemp(path.join(tmpdir(), "lisa-enabled-plugins-"));
  resources.home = await mkdtemp(
    path.join(tmpdir(), "lisa-enabled-plugins-home-")
  );
});

afterEach(async () => {
  await rm(resources.dir, { recursive: true, force: true });
  await rm(resources.home, { recursive: true, force: true });
});

/**
 * Write a project `.claude/settings.json`.
 * @param settings - Settings object to serialize
 */
async function writeSettings(settings: unknown): Promise<void> {
  await mkdir(path.join(resources.dir, ".claude"), { recursive: true });
  await writeFile(
    path.join(resources.dir, ".claude", "settings.json"),
    `${JSON.stringify(settings, null, 2)}\n`,
    "utf8"
  );
}

/**
 * Seed a marketplace under the fake home directory.
 * @param marketplaceName - Marketplace name used in `plugin@marketplace` ids
 * @param plugins - Marketplace plugin entries
 */
async function seedMarketplace(
  marketplaceName: string,
  plugins: readonly MarketplacePlugin[]
): Promise<void> {
  const installLocation = path.join(
    resources.home,
    ".claude",
    "plugins",
    "marketplaces",
    marketplaceName
  );
  await mkdir(path.join(installLocation, ".claude-plugin"), {
    recursive: true,
  });
  await writeFile(
    path.join(installLocation, ".claude-plugin", "marketplace.json"),
    `${JSON.stringify({ name: marketplaceName, plugins }, null, 2)}\n`,
    "utf8"
  );
  const knownPath = path.join(
    resources.home,
    ".claude",
    "plugins",
    "known_marketplaces.json"
  );
  await mkdir(path.dirname(knownPath), { recursive: true });
  let known: Record<string, { installLocation: string }> = {};
  try {
    const existing = await readFile(knownPath, "utf8");
    known = JSON.parse(existing) as Record<string, { installLocation: string }>;
  } catch {
    known = {};
  }
  known[marketplaceName] = { installLocation };
  await writeFile(knownPath, `${JSON.stringify(known, null, 2)}\n`, "utf8");
}

describe("createEnabledPluginsProbe", () => {
  it("registers with the enabled-plugins id and a bounded timeout", () => {
    const probe = createEnabledPluginsProbe(resources.dir, {
      homedir: () => resources.home,
    });

    expect(probe.id).toBe(ENABLED_PLUGINS_PROBE_ID);
    expect(Number.isFinite(probe.timeoutMs)).toBe(true);
    expect(probe.timeoutMs).toBeGreaterThan(0);
  });

  it("returns settingsPresent:false and empty plugins when settings.json is absent", async () => {
    await seedMarketplace("lisa", [
      { name: "lisa", description: BASE_GOVERNANCE },
    ]);

    const result = await runProbe(
      createEnabledPluginsProbe(resources.dir, {
        homedir: () => resources.home,
      })
    );

    expect(result).toEqual({
      state: "value",
      value: { settingsPresent: false, plugins: [] },
    });
  });

  it("lists enabled plugins exactly and distinguishes available-not-enabled", async () => {
    await seedMarketplace("lisa", [
      { name: "lisa", description: BASE_GOVERNANCE },
      { name: "lisa-nestjs", description: "NestJS skills" },
      { name: "lisa-wiki", description: "LLM wiki" },
    ]);
    await writeSettings({
      enabledPlugins: {
        "lisa@lisa": true,
        "lisa-wiki@lisa": false,
      },
    });

    const result = await runProbe(
      createEnabledPluginsProbe(resources.dir, {
        homedir: () => resources.home,
      })
    );

    expect(result.state).toBe("value");
    if (result.state !== "value") {
      throw new Error("expected value");
    }
    expect(result.value.settingsPresent).toBe(true);
    expect(result.value.plugins).toEqual([
      {
        id: "lisa@lisa",
        status: "enabled",
        description: BASE_GOVERNANCE,
      },
      {
        id: "lisa-nestjs@lisa",
        status: "available",
        description: "NestJS skills",
      },
      {
        id: "lisa-wiki@lisa",
        status: "available",
        description: "LLM wiki",
      },
    ]);
  });

  it("includes enabled plugins absent from the marketplace catalog", async () => {
    await seedMarketplace("lisa", [
      { name: "lisa", description: BASE_GOVERNANCE },
    ]);
    await writeSettings({
      enabledPlugins: {
        "lisa@lisa": true,
        "custom@elsewhere": true,
      },
    });

    const result = await runProbe(
      createEnabledPluginsProbe(resources.dir, {
        homedir: () => resources.home,
      })
    );

    expect(result.state).toBe("value");
    if (result.state !== "value") {
      throw new Error("expected value");
    }
    expect(result.value.plugins).toEqual(
      expect.arrayContaining([
        {
          id: "custom@elsewhere",
          status: "enabled",
          description: "",
        },
      ])
    );
  });

  it("degrades to unknown when settings.json is unparseable", async () => {
    await mkdir(path.join(resources.dir, ".claude"), { recursive: true });
    await writeFile(
      path.join(resources.dir, ".claude", "settings.json"),
      "{ not json\n",
      "utf8"
    );

    const result = await runProbe(
      createEnabledPluginsProbe(resources.dir, {
        homedir: () => resources.home,
      })
    );

    expect(result.state).toBe("unknown");
    if (result.state === "unknown") {
      expect(result.reason).toBe("unparseable-settings");
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("degrades to unknown when enabledPlugins is not an object map", async () => {
    await writeSettings({ enabledPlugins: ["lisa@lisa"] });

    const result = await runProbe(
      createEnabledPluginsProbe(resources.dir, {
        homedir: () => resources.home,
      })
    );

    expect(result.state).toBe("unknown");
    if (result.state === "unknown") {
      expect(result.reason).toBe("invalid-enabled-plugins");
      expect(result.message).toContain("enabledPlugins");
    }
  });
});
