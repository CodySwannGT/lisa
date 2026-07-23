import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());
const execMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  exec: execMock,
  execFile: execFileMock,
}));

vi.mock("node:util", async importOriginal => {
  const actual = await importOriginal<typeof import("node:util")>();
  return {
    ...actual,
    promisify: (fn: unknown) =>
      fn === execMock
        ? async (cmd: string) => {
            const result = execMock(cmd);
            if (result instanceof Error) throw result;
            return { stdout: "", stderr: "" };
          }
        : async (file: string, args: readonly string[]) => {
            const result = execFileMock(file, args);
            if (result instanceof Error) throw result;
            return { stdout: "", stderr: "" };
          },
  };
});

const { installSonarIntegrations } =
  await import("../../../src/sonar/sonar-installer.js");

const tempDirectories: string[] = [];

/**
 * Create a Lisa project fixture with the given config JSON.
 * @param config - `.lisa.config.json` contents
 * @returns Temporary project path
 */
async function fixture(config: unknown): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lisa-sonar-inst-"));
  tempDirectories.push(directory);
  await writeFile(
    path.join(directory, ".lisa.config.json"),
    `${JSON.stringify(config)}\n`
  );
  return directory;
}

afterEach(async () => {
  execMock.mockReset();
  execFileMock.mockReset();
  await Promise.all(
    tempDirectories
      .splice(0)
      .map(directory => rm(directory, { force: true, recursive: true }))
  );
});

describe("installSonarIntegrations", () => {
  it("is a no-op when the provider is not enabled", async () => {
    const result = await installSonarIntegrations(await fixture({}), [
      "claude",
    ]);
    expect(result.enabled).toBe(false);
    expect(result.attempted).toBe(false);
    expect(execMock).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("does not attempt integrate when the sonar CLI is absent", async () => {
    execMock.mockReturnValue(new Error("not found"));
    const result = await installSonarIntegrations(
      await fixture({ verification: { sonar: { enabled: true } } }),
      ["claude", "codex"]
    );
    expect(result.enabled).toBe(true);
    expect(result.attempted).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("integrates each supplied vendor agent when enabled and CLI present", async () => {
    execMock.mockReturnValue(undefined);
    execFileMock.mockReturnValue(undefined);
    const result = await installSonarIntegrations(
      await fixture({ verification: { sonar: { enabled: true } } }),
      ["claude", "antigravity"]
    );
    expect(result.attempted).toBe(true);
    expect(result.integrated).toEqual(["claude", "antigravity"]);
    expect(result.failed).toEqual([]);
    expect(execFileMock).toHaveBeenCalledWith("sonar", [
      "integrate",
      "antigravity",
      "--non-interactive",
    ]);
  });

  it("records per-agent failures without throwing", async () => {
    execMock.mockReturnValue(undefined);
    execFileMock.mockImplementation((_file: string, args: readonly string[]) =>
      args[1] === "codex" ? new Error("integrate failed") : undefined
    );
    const result = await installSonarIntegrations(
      await fixture({ verification: { sonar: { enabled: true } } }),
      ["claude", "codex"]
    );
    expect(result.integrated).toEqual(["claude"]);
    expect(result.failed).toEqual(["codex"]);
  });
});
