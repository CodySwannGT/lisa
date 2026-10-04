/** Positive package identity supports materialized-store link migration. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { installHookCompatibility } from "../../../src/codex/hooks-installer.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

let host: string;
beforeEach(async () => {
  host = await createTempDir();
});
afterEach(async () => cleanupTempDir(host));

it.each(["source", "compiled"])(
  "recognizes genuine package-store links and survives replacement in %s runtime",
  async runtime => {
    const root = process.cwd();
    const filename = "block-no-verify.sh";
    const store = path.join(host, "package-store");
    const installed = path.join(host, "node_modules/@codyswann/lisa");
    const source = path.join(store, "dist/codex/scripts", filename);
    const script = path.join(host, ".codex/hooks/lisa", filename);
    await fs.copy(
      path.join(root, "package.json"),
      path.join(store, "package.json")
    );
    await fs.copy(path.join(root, "src/codex/scripts", filename), source);
    await fs.ensureDir(path.dirname(installed));
    await fs.symlink(store, installed);
    await fs.ensureDir(path.dirname(script));
    await fs.symlink(source, script);
    if (runtime === "source") {
      expect(await installHookCompatibility(root, host, [], [])).toContain(
        "hooks/lisa/block-no-verify.sh"
      );
    } else {
      const compiled = boundedSpawnSync({
        command: process.execPath,
        args: [
          "--input-type=module",
          "--eval",
          'import { installHookCompatibility } from "./dist/codex/hooks-installer.js"; await installHookCompatibility(process.cwd(), process.argv[1], [], []);',
          host,
        ],
        cwd: root,
        label: "compiled package source ownership",
      });
      expect(compiled.status, compiled.stderr).toBe(0);
    }
    await fs.remove(installed);
    await fs.remove(store);
    const result = boundedSpawnSync({
      command: "bash",
      args: [script],
      cwd: host,
      label: "package replacement guard",
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "git push --no-verify" },
      }),
    });
    expect((await fs.lstat(script)).isFile()).toBe(true);
    expect(result.status).toBe(0);
    expect(
      JSON.parse(result.stdout).hookSpecificOutput.permissionDecision
    ).toBe("deny");
  }
);
