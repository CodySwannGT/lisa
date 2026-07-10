/** Project-scoped Lisa plugin selection regression coverage. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  projectPluginFilter,
  selectProjectLisaPlugins,
} from "../../../src/core/lisa-plugin-selection.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

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
    await fs.writeJson(path.join(projectDir, ".lisa.config.json"), {
      openclaw: { defaultPlatform: "telegram" },
      wiki: { source: { path: "wiki" } },
    });

    const selected = await selectProjectLisaPlugins(projectDir, []);
    expect([...selected]).toEqual(["lisa", "lisa-openclaw", "lisa-wiki"]);
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
