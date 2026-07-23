/**
 * Registration wiring for the project-learnings union merge driver.
 *
 * The `.gitattributes` half of the driver is committed and ships with Lisa, but
 * git deliberately refuses to read the driver COMMAND from a repository, so it
 * has to be written into machine-local config. This migration is that wiring:
 * it runs on every `lisa apply`, including against Lisa's own repository.
 */
import * as fs from "fs-extra";
import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectType } from "../../../src/core/config.js";
import { LEARNINGS_MERGE_DRIVER_NAME } from "../../../src/core/learnings-merge-driver.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { EnsureLearningsMergeDriverMigration } from "../../../src/migrations/ensure-learnings-merge-driver.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";

/**
 * Resolve git to an absolute executable path by scanning `PATH`.
 * @returns Absolute path to the git executable
 */
function resolveGit(): string {
  const found = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(directory => directory !== "")
    .map(directory => path.join(directory, "git"))
    .find(candidate => {
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  if (found === undefined) {
    throw new Error("git executable not found on PATH");
  }
  return found;
}

const GIT = resolveGit();

/**
 * Environment without the outer repository's git hook state, which would
 * otherwise redirect fixture commands back at the real repository.
 * @returns Environment safe for fixture git commands
 */
function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) {
      delete env[key];
    }
  }
  return env;
}

const CONFIG_FILE = ".lisa.config.json";

describe("EnsureLearningsMergeDriverMigration", () => {
  const migration = new EnsureLearningsMergeDriverMigration();
  let tempDir: string;
  let projectDir: string;

  /**
   * Read the registered driver command from the fixture's local git config.
   * @returns Configured driver command, or undefined when unset
   */
  function registeredDriver(): string | undefined {
    try {
      return execFileSync(
        GIT,
        [
          "config",
          "--local",
          "--get",
          `merge.${LEARNINGS_MERGE_DRIVER_NAME}.driver`,
        ],
        {
          cwd: projectDir,
          env: cleanGitEnv(),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }
      ).trim();
    } catch {
      return undefined;
    }
  }

  const ctx = (dryRun = false): MigrationContext => ({
    projectDir,
    lisaDir: path.join(tempDir, "lisa"),
    detectedTypes: ["typescript"] as ProjectType[],
    dryRun,
    logger: new SilentLogger(),
  });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "lisa-merge-driver-mig-")
    );
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(projectDir);
    await fs.ensureDir(path.join(tempDir, "lisa"));
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  /** Initialize the fixture project as a git repository. */
  function initRepo(): void {
    execFileSync(GIT, ["init"], {
      cwd: projectDir,
      env: cleanGitEnv(),
      stdio: "ignore",
    });
  }

  it("registers the driver in a git repository", async () => {
    initRepo();
    const result = await migration.apply(ctx());
    expect(result.action).toBe("applied");
    expect(registeredDriver()).toMatch(/merge-learnings/);
  });

  it("registers a command carrying git's placeholders", async () => {
    initRepo();
    await migration.apply(ctx());
    const command = registeredDriver() ?? "";
    for (const placeholder of ["%O", "%A", "%B"]) {
      expect(command).toContain(placeholder);
    }
  });

  it("is idempotent once registered", async () => {
    initRepo();
    await migration.apply(ctx());
    const first = registeredDriver();
    const second = await migration.apply(ctx());
    expect(second.action).toBe("noop");
    expect(registeredDriver()).toBe(first);
  });

  it("does not register when the host opted out", async () => {
    initRepo();
    await fs.writeJson(path.join(projectDir, CONFIG_FILE), {
      learnings: { mergeDriver: false },
    });
    const result = await migration.apply(ctx());
    expect(result.action).toBe("noop");
    expect(registeredDriver()).toBeUndefined();
  });

  it("does not apply when the host opted out", async () => {
    initRepo();
    await fs.writeJson(path.join(projectDir, CONFIG_FILE), {
      learnings: { mergeDriver: false },
    });
    expect(await migration.applies(ctx())).toBe(false);
  });

  it("does not apply outside a git repository", async () => {
    expect(await migration.applies(ctx())).toBe(false);
  });

  it("registers nothing outside a git repository", async () => {
    const result = await migration.apply(ctx());
    expect(result.action).toBe("noop");
    expect(registeredDriver()).toBeUndefined();
  });

  it("writes nothing during a dry run", async () => {
    initRepo();
    const result = await migration.apply(ctx(true));
    expect(result.action).toBe("applied");
    expect(registeredDriver()).toBeUndefined();
  });
});
