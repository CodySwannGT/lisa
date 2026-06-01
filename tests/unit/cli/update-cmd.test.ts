import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectPackageManager,
  getUpdateCommand,
  runUpdate,
} from "../../../src/cli/update-cmd.js";

let tempDir: string | undefined;

/**
 * Resolve the temporary directory for one update-command test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await mkdtemp(path.join(os.tmpdir(), "lisa-update-cmd-"));
  return tempDir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("detectPackageManager", () => {
  it("uses npm_config_user_agent before lockfiles", () => {
    expect(
      detectPackageManager({
        cwd: "/tmp",
        env: { npm_config_user_agent: "pnpm/10.0.0 npm/? node/22" },
      })
    ).toBe("pnpm");
  });

  it("detects bun from bun.lockb", async () => {
    const cwd = await getTempDir();
    await writeFile(path.join(cwd, "bun.lockb"), "");

    expect(detectPackageManager({ cwd, env: {} })).toBe("bun");
  });
});

describe("getUpdateCommand", () => {
  it("defaults to npm global install", () => {
    expect(getUpdateCommand("npm")).toEqual({
      command: "npm",
      args: ["install", "-g", "@codyswann/lisa@latest"],
    });
  });
});

describe("runUpdate", () => {
  it("prints the command and does not spawn without --yes", async () => {
    const write = vi.fn();
    const spawn = vi.fn();

    await expect(
      runUpdate({ yes: false }, { cwd: "/tmp", env: {}, spawn, write })
    ).resolves.toBe(0);

    expect(write).toHaveBeenCalledWith("npm install -g @codyswann/lisa@latest");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("spawns the update command with inherited stdio when --yes is set", async () => {
    const child = new EventEmitter();
    const spawn = vi.fn(() => child);
    const promise = runUpdate(
      { yes: true },
      { cwd: "/tmp", env: {}, spawn: spawn as never, write: vi.fn() }
    );

    child.emit("exit", 7);

    await expect(promise).resolves.toBe(7);
    expect(spawn).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", "@codyswann/lisa@latest"],
      { stdio: "inherit" }
    );
  });
});
