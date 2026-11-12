/** Universal adapter distribution and complete support-file accounting. */
import * as fs from "fs-extra";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installHooks,
  listInstalledPluginFiles,
} from "../../../src/opencode/hooks-installer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

describe("OpenCode host-name guard distribution (#4540)", () => {
  let temporary: string;
  let project: string;
  let lisaDir: string;

  beforeEach(async () => {
    temporary = await createTempDir();
    project = path.join(temporary, "project");
    lisaDir = path.join(temporary, "lisa");
    await Promise.all([fs.ensureDir(project), fs.ensureDir(lisaDir)]);
  });

  afterEach(async () => {
    await cleanupTempDir(temporary);
  });

  it("ships the universal host-name adapter through the real installer", async () => {
    await installHooks(process.cwd(), project, [], []);
    expect(await listInstalledPluginFiles(project)).toContain(
      "lisa-block-host-name-leak.ts"
    );
  });

  it("reports pluginCount equal to the emitted file count", async () => {
    const result = await installHooks(lisaDir, project, ["typescript"], []);
    const files = await listInstalledPluginFiles(project);
    expect(result.pluginCount).toBe(files.length);
    // Four existing support files, the three Rails engine modules, and the
    // host-name wrapper/classifier/context helper are managed alongside plugins.
    // The unused heredoc parser left the list in CodySwannGT/lisa#4810.
    expect(result.managedFiles).toHaveLength(files.length + 10);
  });
});
