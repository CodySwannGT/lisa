import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BOOTSTRAP_SKIP_NOTICE } from "../../../src/core/bootstrap-environment.js";
import { runApply } from "../../../src/cli/apply.js";

const PROJECT_CONFIG = ".lisa.config.json";

describe("runApply bootstrap guard", () => {
  const originalCi = process.env.CI;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (originalCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCi;
    }
  });

  it.each(["lifecycle", "environment", "flag", "bun-install"])(
    "skips an old host install invocation declared by %s before reading config",
    async declaration => {
      vi.stubEnv("LISA_BOOTSTRAP", "1");
      vi.stubEnv("LISA_POSTINSTALL", declaration === "environment" ? "1" : "");
      vi.stubEnv(
        "npm_config_user_agent",
        declaration === "bun-install" ? "bun/1.3.11 npm/? node/v24.3.0" : ""
      );
      vi.stubEnv(
        "npm_lifecycle_event",
        declaration === "lifecycle" ? "postinstall" : ""
      );
      const projectDir = await mkdtemp(join(tmpdir(), "lisa-install-guard-"));
      try {
        const configPath = join(projectDir, PROJECT_CONFIG);
        await writeFile(configPath, "{not-json");
        const log = vi
          .spyOn(console, "log")
          .mockImplementation(() => undefined);
        await runApply(projectDir, {
          yes: true,
          skipGitCheck: true,
          postinstallSafe: declaration === "flag",
        });
        expect(log).toHaveBeenCalledWith(expect.stringContaining("lisa apply"));
        expect(await readFile(configPath, "utf8")).toBe("{not-json");
        expect(await readdir(projectDir)).toEqual([PROJECT_CONFIG]);
      } finally {
        await rm(projectDir, { recursive: true, force: true });
      }
    }
  );

  it("exits successfully without writing in a build context", async () => {
    process.env.CI = "1";
    const projectDir = await mkdtemp(join(tmpdir(), "lisa-apply-guard-"));
    const packageJson = join(projectDir, "package.json");
    await writeFile(packageJson, '{"name":"guard-fixture"}\n', "utf8");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runApply(projectDir, { yes: true, skipGitCheck: true });

    expect(log).toHaveBeenCalledWith(BOOTSTRAP_SKIP_NOTICE);
    await expect(readFile(packageJson, "utf8")).resolves.toBe(
      '{"name":"guard-fixture"}\n'
    );
    await expect(
      readFile(join(projectDir, PROJECT_CONFIG), "utf8")
    ).rejects.toThrow();
  });

  it("skips before parsing project config in a build context", async () => {
    process.env.CI = "1";
    const projectDir = await mkdtemp(join(tmpdir(), "lisa-apply-guard-"));
    const configPath = join(projectDir, PROJECT_CONFIG);
    await writeFile(configPath, "{not-json", "utf8");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      runApply(projectDir, { yes: true, skipGitCheck: true })
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(BOOTSTRAP_SKIP_NOTICE);
    await expect(readFile(configPath, "utf8")).resolves.toBe("{not-json");
  });
});
