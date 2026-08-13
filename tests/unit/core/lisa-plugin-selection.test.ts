/** Project-scoped Lisa plugin selection regression coverage. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  projectPluginFilter,
  selectProjectLisaPlugins,
} from "../../../src/core/lisa-plugin-selection.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** Optional project config file that drives standalone plugin selection. */
const CONFIG_FILE = ".lisa.config.json";

/** Selection when nothing but the universal base plugin applies. */
const BASE_ONLY = ["lisa"];

describe("core/lisa-plugin-selection", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(projectDir);
  });

  it("selects base plus detected stacks and excludes unrelated stacks", async () => {
    const selected = await selectProjectLisaPlugins(projectDir, [
      "typescript",
      "expo",
    ]);

    expect([...selected]).toEqual(["lisa", "lisa-typescript", "lisa-expo"]);
    const includes = projectPluginFilter(selected);
    expect(includes("lisa-rails")).toBe(false);
    expect(includes("lisa-harper-fabric")).toBe(false);
    expect(includes("lisa-expo-cursor")).toBe(false);
  });

  it("selects standalone plugins only from explicit project state", async () => {
    await fs.writeJson(path.join(projectDir, CONFIG_FILE), {
      openclaw: { defaultPlatform: "telegram" },
      wiki: { source: { path: "wiki" } },
    });

    const selected = await selectProjectLisaPlugins(projectDir, []);
    expect([...selected]).toEqual(["lisa", "lisa-openclaw", "lisa-wiki"]);
  });

  it("degrades to no configured plugins when the config is absent or unreadable", async () => {
    // Absent is the common case and must never throw.
    expect([...(await selectProjectLisaPlugins(projectDir, []))]).toEqual(
      BASE_ONLY
    );

    await fs.outputFile(path.join(projectDir, CONFIG_FILE), "{ not json\n");
    expect([...(await selectProjectLisaPlugins(projectDir, []))]).toEqual(
      BASE_ONLY
    );
  });

  it("survives a config whose JSON parses to something that is not an object", async () => {
    // `null` parses cleanly, so the reader's error handling never engaged, and
    // the value flowed downstream to `config[key]` and threw there — outside
    // the guard that was believed to make a malformed optional file non-fatal.
    await fs.outputFile(path.join(projectDir, CONFIG_FILE), "null\n");
    expect([...(await selectProjectLisaPlugins(projectDir, []))]).toEqual(
      BASE_ONLY
    );

    await fs.outputFile(path.join(projectDir, CONFIG_FILE), "[]\n");
    expect([...(await selectProjectLisaPlugins(projectDir, []))]).toEqual(
      BASE_ONLY
    );
  });

  it("detects an existing local wiki without requiring config", async () => {
    await fs.outputFile(
      path.join(projectDir, "wiki", "lisa-wiki.config.json"),
      "{}\n"
    );

    const selected = await selectProjectLisaPlugins(projectDir, []);
    expect(selected.has("lisa-wiki")).toBe(true);
  });
});
