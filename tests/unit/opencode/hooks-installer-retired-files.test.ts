/**
 * OpenCode cleanup of the removed safety-net hook (CodySwannGT/lisa#4803).
 *
 * Earlier releases copied `lisa-parity-safety-net.ts` and its support script
 * `parity-safety-net.sh` into `.opencode/plugin/` and recorded both in the
 * OpenCode ownership manifest. Neither ships any more, so an apply must remove
 * the copies Lisa recorded writing — and only those, since a support file has
 * no `lisa-` prefix to mark it as Lisa's.
 * @module tests/unit/opencode/hooks-installer-retired-files
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  OPENCODE_PLUGIN_SUBDIR,
  installHooks,
} from "../../../src/opencode/hooks-installer.js";
import { OPENCODE_CONFIG_DIR } from "../../../src/opencode/manifest.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const RETIRED_PLUGIN = "lisa-parity-safety-net.ts";
const RETIRED_SUPPORT = "parity-safety-net.sh";
const RETIRED_PARSER = "parity-safety-net-heredoc.py";
const HOST_AUTHORED = "# host-authored\n";

describe("opencode/hooks-installer retired safety-net files", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await Promise.all([fs.ensureDir(lisaDir), fs.ensureDir(destDir)]);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("prunes the removed safety-net plugin and its recorded support copy", async () => {
    const pluginDir = path.join(
      destDir,
      OPENCODE_CONFIG_DIR,
      OPENCODE_PLUGIN_SUBDIR
    );
    await fs.ensureDir(pluginDir);
    for (const name of [RETIRED_PLUGIN, RETIRED_SUPPORT])
      await fs.writeFile(path.join(pluginDir, name), "// old copy\n");

    const result = await installHooks(
      lisaDir,
      destDir,
      ["typescript"],
      [RETIRED_PLUGIN, RETIRED_SUPPORT].map(name =>
        path.join(OPENCODE_PLUGIN_SUBDIR, name)
      )
    );

    expect(result.deleted).toEqual([RETIRED_PLUGIN, RETIRED_SUPPORT]);
    for (const name of [RETIRED_PLUGIN, RETIRED_SUPPORT])
      expect(await fs.pathExists(path.join(pluginDir, name))).toBe(false);
    expect(result.managedFiles.join("\n")).not.toContain(RETIRED_SUPPORT);
  });

  it("prunes the recorded heredoc parser copy, which OpenCode never used", async () => {
    // CodySwannGT/lisa#4810: only block-instruction-file-edits.sh calls the
    // parser, and OpenCode does not ship that guard.
    const pluginDir = path.join(
      destDir,
      OPENCODE_CONFIG_DIR,
      OPENCODE_PLUGIN_SUBDIR
    );
    await fs.ensureDir(pluginDir);
    await fs.writeFile(path.join(pluginDir, RETIRED_PARSER), "# old copy\n");

    const result = await installHooks(
      lisaDir,
      destDir,
      ["typescript"],
      [path.join(OPENCODE_PLUGIN_SUBDIR, RETIRED_PARSER)]
    );

    expect(result.deleted).toEqual([RETIRED_PARSER]);
    expect(await fs.pathExists(path.join(pluginDir, RETIRED_PARSER))).toBe(
      false
    );
    expect(result.managedFiles.join("\n")).not.toContain(RETIRED_PARSER);
  });

  it("keeps a host's own heredoc parser file Lisa never recorded writing", async () => {
    const pluginDir = path.join(
      destDir,
      OPENCODE_CONFIG_DIR,
      OPENCODE_PLUGIN_SUBDIR
    );
    await fs.ensureDir(pluginDir);
    const hostCopy = path.join(pluginDir, RETIRED_PARSER);
    await fs.writeFile(hostCopy, HOST_AUTHORED);

    await installHooks(lisaDir, destDir, ["typescript"], []);

    expect(await fs.readFile(hostCopy, "utf8")).toBe(HOST_AUTHORED);
  });

  it("keeps a same-named support file Lisa never recorded writing", async () => {
    const pluginDir = path.join(
      destDir,
      OPENCODE_CONFIG_DIR,
      OPENCODE_PLUGIN_SUBDIR
    );
    await fs.ensureDir(pluginDir);
    const hostCopy = path.join(pluginDir, RETIRED_SUPPORT);
    await fs.writeFile(hostCopy, HOST_AUTHORED);

    await installHooks(lisaDir, destDir, ["typescript"], []);

    expect(await fs.readFile(hostCopy, "utf8")).toBe(HOST_AUTHORED);
  });
});
