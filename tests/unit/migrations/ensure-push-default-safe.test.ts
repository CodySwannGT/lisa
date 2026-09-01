/**
 * Disarming `push.default` where it inherits a push's destination.
 *
 * `upstream` and `tracking` resolve a push's destination from the branch's
 * upstream rather than from the branch named, so a working branch created from
 * the default branch pushes straight to it (CodySwannGT/lisa#3495). This
 * migration rewrites exactly those two values and leaves every other one alone.
 * @module tests/unit/migrations/ensure-push-default-safe
 */
import * as fs from "fs-extra";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { EnsurePushDefaultSafeMigration } from "../../../src/migrations/ensure-push-default-safe.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import {
  boundedExecFileSync,
  ChildFailure,
} from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";

const GIT = resolveGit();

/** The git config key under test. */
const PUSH_DEFAULT = "push.default";

/**
 * Environment without the outer repository's git hook state, which would
 * otherwise redirect fixture commands back at the real repository.
 * @returns Environment safe for fixture git commands
 */
function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  return env;
}

describe("EnsurePushDefaultSafeMigration", () => {
  const migration = new EnsurePushDefaultSafeMigration();
  let tempDir: string;
  let projectDir: string;

  /**
   * Run a git command in the fixture.
   * @param args - Git arguments
   * @returns Trimmed stdout
   */
  function git(...args: readonly string[]): string {
    return boundedExecFileSync({
      label: `git ${args[0]}`,
      command: GIT,
      args: [...args],
      cwd: projectDir,
      env: cleanGitEnv(),
    }).trim();
  }

  /**
   * The fixture's EFFECTIVE `push.default`, or undefined when unset.
   *
   * Only git's "no such key" answer becomes `undefined`. Swallowing every
   * failure would let the unset case pass over a fixture that was never a
   * repository, a config that could not be read, or a missing git — three
   * broken environments reported as the one clean result this suite is trying
   * to distinguish them from.
   * @returns The configured value, or undefined when the key is genuinely unset
   * @throws When git failed for any reason other than a missing key
   */
  function effectivePushDefault(): string | undefined {
    try {
      return git("config", "--get", PUSH_DEFAULT);
    } catch (error) {
      // `git config --get` exits 1, and only 1, for a key that is not set.
      // The bounded helper spells the child's exit code `exitCode`, because
      // `status` on a thrown Error means an HTTP code to this repository's
      // structural rules.
      if (error instanceof ChildFailure && error.exitCode === 1) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * A migration context pointed at the fixture.
   * @param dryRun - Whether to describe rather than write
   * @returns The context
   */
  function context(dryRun = false): MigrationContext {
    return {
      projectDir,
      lisaDir: projectDir,
      detectedTypes: [] as readonly ProjectType[],
      dryRun,
      logger: new SilentLogger(),
    };
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-push-default-"));
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(projectDir);
    git("init", "--quiet", "--initial-branch", "main");
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  it.each(["upstream", "tracking"])(
    "rewrites push.default=%s to simple",
    async value => {
      git("config", "--local", PUSH_DEFAULT, value);

      expect(await migration.applies(context())).toBe(true);
      const result = await migration.apply(context());

      expect(result.action).toBe("applied");
      expect(effectivePushDefault()).toBe("simple");
    }
  );

  it.each(["simple", "current", "matching", "nothing"])(
    "leaves push.default=%s exactly as the host set it",
    async value => {
      git("config", "--local", PUSH_DEFAULT, value);

      expect(await migration.applies(context())).toBe(false);
      const result = await migration.apply(context());

      expect(result.action).toBe("noop");
      expect(effectivePushDefault()).toBe(value);
    }
  );

  it("does nothing when push.default is unset", async () => {
    expect(await migration.applies(context())).toBe(false);

    const result = await migration.apply(context());

    expect(result.action).toBe("noop");
    expect(effectivePushDefault()).toBeUndefined();
  });

  it("writes nothing on a dry run", async () => {
    git("config", "--local", PUSH_DEFAULT, "upstream");

    const result = await migration.apply(context(true));

    expect(result.action).toBe("applied");
    expect(effectivePushDefault()).toBe("upstream");
  });

  it("is idempotent", async () => {
    git("config", "--local", PUSH_DEFAULT, "upstream");
    await migration.apply(context());

    expect(await migration.applies(context())).toBe(false);
    expect(effectivePushDefault()).toBe("simple");
  });

  it("disarms a value that lives in worktree config, not just local config", async () => {
    // With `extensions.worktreeConfig` on, `config.worktree` outranks `config`,
    // so a `--local` write lands, exits zero, and changes nothing the pusher
    // will experience. A migration that trusted its own exit code would report
    // success over a trap that was still armed — the same shape as the defect
    // this whole change exists to fix.
    git("config", "--local", "extensions.worktreeConfig", "true");
    git("config", "--worktree", PUSH_DEFAULT, "upstream");
    expect(effectivePushDefault()).toBe("upstream");

    expect(await migration.applies(context())).toBe(true);
    const result = await migration.apply(context());

    expect(result.action).toBe("applied");
    expect(effectivePushDefault()).toBe("simple");
  });

  it("does nothing outside a git working tree", async () => {
    const notARepo = path.join(tempDir, "plain");
    await fs.ensureDir(notARepo);
    const ctx: MigrationContext = { ...context(), projectDir: notARepo };

    expect(await migration.applies(ctx)).toBe(false);
    expect((await migration.apply(ctx)).action).toBe("noop");
  });
});
