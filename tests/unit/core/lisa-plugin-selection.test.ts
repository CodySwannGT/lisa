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

/** Selection when no stack applies: base plus the default knowledge backend. */
const BASE_ONLY = ["lisa", "lisa-wiki"];

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

    expect([...selected]).toEqual([
      "lisa",
      "lisa-typescript",
      "lisa-expo",
      "lisa-wiki",
    ]);
    const includes = projectPluginFilter(selected);
    expect(includes("lisa-rails")).toBe(false);
    expect(includes("lisa-harper-fabric")).toBe(false);
    expect(includes("lisa-expo-cursor")).toBe(false);
  });

  it("selects the knowledge plugin from the knowledge role and ignores retired keys", async () => {
    await fs.writeJson(path.join(projectDir, CONFIG_FILE), {
      knowledge: "llm-wiki",
      openclaw: { defaultPlatform: "telegram" },
      wiki: { source: { url: "git@example.com:org/wiki.git" } },
    });

    const selected = await selectProjectLisaPlugins(projectDir, []);
    expect([...selected]).toEqual(["lisa", "lisa-wiki"]);
  });

  it("selects no knowledge plugin for an unrecognised backend", async () => {
    await fs.writeJson(path.join(projectDir, CONFIG_FILE), {
      knowledge: "something-else",
    });

    const selected = await selectProjectLisaPlugins(projectDir, []);
    expect([...selected]).toEqual(["lisa"]);
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
});
