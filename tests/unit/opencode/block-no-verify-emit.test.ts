/**
 * What the OpenCode emit ships for `block-no-verify` (CodySwannGT/lisa#3078).
 *
 * The behavior of the guard is pinned in `block-no-verify-plugin.test.ts`, which
 * runs it. This file pins DELIVERY, which is the half that fails silently: the
 * adapter resolves its policy script through `import.meta.dir`, so an adapter
 * shipped without the script beside it throws on every bash call and reads as a
 * broken agent rather than as a missing guard.
 *
 * Kept out of `hooks-installer.test.ts` only because that file is at its
 * max-lines budget.
 * @module tests/unit/opencode/block-no-verify-emit
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OPENCODE_PLUGIN_SUBDIR,
  installHooks,
  listInstalledPluginFiles,
} from "../../../src/opencode/hooks-installer.js";
import { OPENCODE_CONFIG_DIR } from "../../../src/opencode/manifest.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const ADAPTER = "lisa-block-no-verify.ts";
const POLICY_SCRIPT = "block-no-verify.sh";

describe("the OpenCode block-no-verify emit", () => {
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

  /**
   * The host directory OpenCode discovers project plugins in.
   * @returns Absolute path to `.opencode/plugin/`.
   */
  const pluginDir = (): string =>
    path.join(destDir, OPENCODE_CONFIG_DIR, OPENCODE_PLUGIN_SUBDIR);

  it("ships the adapter", async () => {
    await installHooks(lisaDir, destDir, [], []);

    expect(await listInstalledPluginFiles(destDir)).toContain(ADAPTER);
  });

  it("ships real adapter source, not an empty stub", async () => {
    await installHooks(lisaDir, destDir, [], []);
    const body = await fs.readFile(path.join(pluginDir(), ADAPTER), "utf8");

    expect(body).toContain("export const LisaBlockNoVerify");
  });

  it("ships the canonical policy script beside the adapter", async () => {
    await installHooks(lisaDir, destDir, [], []);

    expect(await fs.pathExists(path.join(pluginDir(), POLICY_SCRIPT))).toBe(
      true
    );
  });

  it("ships the same policy script the other agents run", async () => {
    // Byte-identical to the canonical source, so OpenCode cannot drift into a
    // weaker guard than Claude, Codex, Cursor and Copilot enforce.
    await installHooks(lisaDir, destDir, [], []);
    const canonical = await fs.readFile(
      path.join(
        process.cwd(),
        "plugins",
        "src",
        "base",
        "hooks",
        POLICY_SCRIPT
      ),
      "utf8"
    );
    const shipped = await fs.readFile(
      path.join(pluginDir(), POLICY_SCRIPT),
      "utf8"
    );

    expect(shipped).toBe(canonical);
  });

  it("ships to every stack, not only the one that has other guards", async () => {
    // Bypassing git's hooks is not a typescript concern, so the catalog entry is
    // universal. A stack-gated guard here would leave rails hosts unguarded.
    await installHooks(lisaDir, destDir, ["rails"], []);

    expect(await listInstalledPluginFiles(destDir)).toContain(ADAPTER);
  });
});
