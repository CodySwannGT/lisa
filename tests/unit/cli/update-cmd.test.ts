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

const LISA_PACKAGE = "@codyswann/lisa";

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

  it("detects bun from the current text lockfile", async () => {
    const cwd = await getTempDir();
    await writeFile(path.join(cwd, "bun.lock"), "");

    expect(detectPackageManager({ cwd, env: {} })).toBe("bun");
  });
});

describe("getUpdateCommand", () => {
  it.each([
    ["bun", "bun", ["update", LISA_PACKAGE]],
    ["pnpm", "pnpm", ["update", LISA_PACKAGE]],
    ["yarn", "yarn", ["up", LISA_PACKAGE]],
    ["npm", "npm", ["update", LISA_PACKAGE]],
  ])("uses a project-local %s update", (manager, command, args) => {
    expect(getUpdateCommand(manager)).toEqual({ command, args });
  });

  it("defaults unknown package managers to a local npm update", () => {
    expect(getUpdateCommand("unknown")).toEqual({
      command: "npm",
      args: ["update", LISA_PACKAGE],
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

    expect(write).toHaveBeenCalledWith("npm update @codyswann/lisa");
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
    expect(spawn).toHaveBeenCalledWith("npm", ["update", "@codyswann/lisa"], {
      stdio: "inherit",
    });
  });
});
