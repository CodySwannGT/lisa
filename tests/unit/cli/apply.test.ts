import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BOOTSTRAP_SKIP_NOTICE } from "../../../src/core/bootstrap-environment.js";
import { runApply } from "../../../src/cli/apply.js";

describe("runApply bootstrap guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("exits successfully without writing in a build context", async () => {
    vi.stubEnv("CI", "1");
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
      readFile(join(projectDir, ".lisa.config.json"), "utf8")
    ).rejects.toThrow();
  });

  it("skips before parsing project config in a build context", async () => {
    vi.stubEnv("CI", "1");
    const projectDir = await mkdtemp(join(tmpdir(), "lisa-apply-guard-"));
    const configPath = join(projectDir, ".lisa.config.json");
    await writeFile(configPath, "{not-json", "utf8");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      runApply(projectDir, { yes: true, skipGitCheck: true })
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(BOOTSTRAP_SKIP_NOTICE);
    await expect(readFile(configPath, "utf8")).resolves.toBe("{not-json");
  });
});
