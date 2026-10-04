/** Ordinary subprocess success, failure and deadline cleanup observations. */
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPluginCommand } from "../../../src/core/plugin-command.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

describe("plugin command lifecycle", () => {
  let root: string;
  beforeEach(async () => {
    root = await createTempDir();
    const bin = path.join(root, "bin");
    await mkdir(bin);
    const executable = path.join(bin, "claude");
    const fixture = path.resolve(
      "tests/helpers/__fixtures__/plugin-registration-cli.mjs"
    );
    await writeFile(
      executable,
      `#!/bin/sh\nexec '${process.execPath}' '${fixture}' "$@"\n`
    );
    await chmod(executable, 0o700);
    vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH ?? ""}`);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTempDir(root);
  });

  it("closes input and observes a successful command", async () => {
    await expect(
      runPluginCommand(["success"], { cwd: root, timeoutMs: 2000 })
    ).resolves.toEqual({ stdout: "input-closed\n" });
  });
  it("reports an actual nonzero exit", async () => {
    await expect(
      runPluginCommand(["failure"], { cwd: root, timeoutMs: 2000 })
    ).rejects.toThrow("exited 7");
  });
  it("refuses an exhausted operation budget before starting another command", async () => {
    await expect(
      runPluginCommand(["success"], { cwd: root, timeoutMs: 0 })
    ).rejects.toThrow("operation deadline reached");
    await expect(
      readFile(path.join(root, "calls.jsonl"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("terminates its ordinary waiting command and its inherited subprocess", async () => {
    const receipt = path.join(root, "processes.json");
    await expect(
      runPluginCommand(["wait", receipt], { cwd: root, timeoutMs: 500 })
    ).rejects.toThrow("timed out");
    const ids = JSON.parse(await readFile(receipt, "utf8")) as {
      parent: number;
      child: number;
    };
    await expect
      .poll(() => {
        return [ids.parent, ids.child].every(pid => {
          try {
            process.kill(pid, 0);
            return false;
          } catch {
            return true;
          }
        });
      })
      .toBe(true);
  });
});
