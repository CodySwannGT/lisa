/** OpenCode must install the same guard bytes as the dispatcher channel. */
import * as fs from "fs-extra";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installHooks } from "../../../src/opencode/hooks-installer.js";
import { resolveSupportFile } from "../../../src/opencode/support-file-resolver.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const REPO_ROOT = process.cwd();
const HOST_HOOKS = "all/copy-overwrite/scripts/lisa-hooks";
const RAW_HOOKS = "plugins/src/base/hooks";
const GENERATED_HOOKS = "plugins/lisa/hooks";
const STAGING_SCRIPT = "scripts/copy-opencode-plugin-templates.mjs";
const TASK_ADAPTER = "task-readiness-guard.mjs";
const shippedDirectory = (filename: string): string =>
  filename === TASK_ADAPTER ? GENERATED_HOOKS : HOST_HOOKS;
const SUPPORT_FILES = [
  "task-readiness-guard.sh",
  TASK_ADAPTER,
  "discharge-work-item-gates.sh",
  "block-managed-file-edits.sh",
  "block-no-verify.sh",
  "parity-safety-net.sh",
  "parity-safety-net-heredoc.py",
  "guard-dedupe.bash",
];

describe("OpenCode installed support-file parity", () => {
  let temporary: string;

  beforeEach(async () => {
    temporary = await createTempDir();
  });
  afterEach(async () => {
    await cleanupTempDir(temporary);
  });

  it("installs dispatcher-identical support files through the real installer", async () => {
    await installHooks(REPO_ROOT, temporary, [], []);
    for (const filename of SUPPORT_FILES) {
      const installed = await fs.readFile(
        path.join(temporary, ".opencode/plugin", filename)
      );
      expect(installed, filename).toEqual(
        await fs.readFile(
          path.join(REPO_ROOT, shippedDirectory(filename), filename)
        )
      );
    }
  });

  it("stages fresh raw guards with banners even when generated plugins are stale", async () => {
    for (const script of [
      STAGING_SCRIPT,
      "scripts/materialize-copy-overwrite.mjs",
      "scripts/lib",
    ]) {
      await fs.copy(path.join(REPO_ROOT, script), path.join(temporary, script));
    }
    await fs.ensureDir(path.join(temporary, "src/opencode/plugin-templates"));
    for (const filename of SUPPORT_FILES) {
      const raw = await fs.readFile(path.join(REPO_ROOT, RAW_HOOKS, filename));
      await fs.outputFile(
        path.join(temporary, RAW_HOOKS, filename),
        `${raw.toString()}\n# fresh source\n`
      );
      await fs.outputFile(
        path.join(temporary, GENERATED_HOOKS, filename),
        "# stale generated code\n"
      );
    }

    const result = boundedSpawnSync({
      label: "stage OpenCode support files in isolated package",
      command: process.execPath,
      args: [path.join(temporary, STAGING_SCRIPT)],
      cwd: temporary,
    });
    expect(result.status, result.stderr).toBe(0);
    const moduleUrl = pathToFileURL(
      path.join(temporary, "dist/opencode/hooks-installer.js")
    ).href;
    for (const filename of SUPPORT_FILES) {
      const bundled = await fs.readFile(
        resolveSupportFile(moduleUrl, filename),
        "utf8"
      );
      const host = await fs.readFile(
        path.join(REPO_ROOT, shippedDirectory(filename), filename),
        "utf8"
      );
      const banner =
        filename === TASK_ADAPTER
          ? "// This file is managed by Lisa and IS replaced on each `lisa` run.\n// Do not edit directly — durable changes belong upstream in Lisa.\n\n"
          : "";
      expect(bundled, filename).toBe(`${banner}${host}\n# fresh source\n`);
    }
  });
});
