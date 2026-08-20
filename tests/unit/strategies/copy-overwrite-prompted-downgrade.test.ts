/**
 * An operator-invoked `lisa apply` must not downgrade a Lisa-owned guard either.
 *
 * The provenance check that decides whether a host's copy is behind Lisa's or
 * ahead of it (#2436, `classifyHostCopy`) was wired into exactly one of the two
 * ways a managed file gets replaced: the unattended postinstall path, reached
 * when `skipGitCheck` is set. Every other route to the same overwrite — the
 * interactive prompt, `--yes`, and any non-TTY run, which `createPrompter`
 * answers with `AutoAcceptPrompter` returning "yes" without asking anyone —
 * took the branch above it and replaced the file without ever classifying it.
 *
 * So the guard against silently downgrading a guard could be walked around by
 * running the command the normal way. That is #2577: `lisa apply` replacing a
 * stronger `block-no-verify.sh` with a weaker upstream one, reporting success.
 *
 * These assertions use the REAL shipped guard as the host's copy, because the
 * property under test is about the file the ticket is about. The packaged copy
 * stands in for the upstream that predates the `GIT_CONFIG_KEY_<n>` hardening:
 * the declaration loses that token and the check that implements it is removed.
 * Built by stripping the shipped bytes rather than by reading an older revision
 * out of git, which returns nothing under CI's shallow clone. It is a
 * comparison fixture, never executed — what has to stay executable is the
 * host's copy, which is the real file.
 * @module tests/unit/strategies/copy-overwrite-prompted-downgrade
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";

import type { LisaConfig } from "../../../src/core/config.js";
import { CopyOverwriteStrategy } from "../../../src/strategies/copy-overwrite.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

/** Where the guard installs in a host project. */
const GUARD = "scripts/lisa-hooks/block-no-verify.sh";

/** The tree the shipped guard is authored in. */
const GUARD_SOURCE = `all/copy-overwrite/${GUARD}`;

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/** The capability token an upstream copy predating the hardening lacks. */
const CAPABILITY = "git-config-key";

/** The action a preserved Lisa-owned copy is reported under. */
const HOST_AHEAD = "host-ahead";

/** The check that implements it, and the only place this text appears. */
const HARDENED_VECTOR = "git_config_key_";

describe("lisa apply on a repo carrying the current guard (#2577)", () => {
  let strategy: CopyOverwriteStrategy;
  let tempDir: string;
  let srcFile: string;
  let destFile: string;
  let prompted: number;
  let hostGuard: string;
  let olderUpstreamGuard: string;

  beforeEach(async () => {
    strategy = new CopyOverwriteStrategy();
    tempDir = await createTempDir();
    prompted = 0;
    srcFile = path.join(tempDir, "src", GUARD);
    destFile = path.join(tempDir, "dest", GUARD);
    await fs.ensureDir(path.dirname(srcFile));
    await fs.ensureDir(path.dirname(destFile));

    hostGuard = await fs.readFile(path.join(REPO_ROOT, GUARD_SOURCE), "utf8");
    olderUpstreamGuard = hostGuard
      .split("\n")
      .filter(
        line =>
          !line.toLowerCase().includes(HARDENED_VECTOR) &&
          !line.includes("key_match")
      )
      .join("\n")
      .replace(`, ${CAPABILITY}`, "");

    await fs.writeFile(destFile, hostGuard);
    await fs.writeFile(srcFile, olderUpstreamGuard);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * The context an operator-invoked `lisa apply` runs with.
   *
   * `skipGitCheck` is false — that flag is the postinstall's, not the
   * command's — and `promptOverwrite` answers "yes" the way
   * `AutoAcceptPrompter` does under `--yes` or on any non-TTY stdin.
   * @param overrides - Config fields this case varies
   * @returns Strategy context for a prompted apply
   */
  function promptedApplyContext(
    overrides: Partial<LisaConfig> = {}
  ): StrategyContext {
    const config: LisaConfig = {
      lisaDir: path.dirname(srcFile),
      destDir: path.dirname(destFile),
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: false,
      harness: "claude",
      ...overrides,
    };
    return {
      config,
      backupFile: async () => {},
      promptOverwrite: async () => {
        prompted += 1;
        return true;
      },
    };
  }

  it("keeps the hardening instead of reverting to a weaker upstream copy", async () => {
    const result = await strategy.apply(
      srcFile,
      destFile,
      GUARD,
      promptedApplyContext()
    );

    expect(result.action).toBe(HOST_AHEAD);
    expect(await fs.readFile(destFile, "utf8")).toBe(hostGuard);
  });

  it("leaves the named bypass vector still guarded on disk", async () => {
    await strategy.apply(srcFile, destFile, GUARD, promptedApplyContext());

    expect(await fs.readFile(destFile, "utf8")).toContain(HARDENED_VECTOR);
  });

  it("names what would have been lost rather than reporting a plain success", async () => {
    const result = await strategy.apply(
      srcFile,
      destFile,
      GUARD,
      promptedApplyContext()
    );

    expect(result.note).toContain(CAPABILITY);
  });

  it("never asks a question whose only safe answer is no", async () => {
    await strategy.apply(srcFile, destFile, GUARD, promptedApplyContext());

    expect(prompted).toBe(0);
  });

  it("does not claim a dry run would overwrite a copy it must keep", async () => {
    const result = await strategy.apply(
      srcFile,
      destFile,
      GUARD,
      promptedApplyContext({ dryRun: true })
    );

    expect(result.action).toBe(HOST_AHEAD);
  });

  it("keeps a copy it could not read rather than replacing it unclassified", async () => {
    // `preserveIfHostAhead` returned `undefined` when either side could not be
    // read, and `undefined` is this path's word for "nothing to preserve" — so
    // the apply carried straight on and overwrote it. `filesIdentical` swallows
    // its own read errors and answers "differs", so an unreadable Lisa-owned
    // guard reached that branch on every apply.
    //
    // Unreadability is staged with a chmod, which is how it happens in the
    // field. The first assertion is not decoration: a process that CAN still
    // read the file has not staged the condition, and this must go red rather
    // than pass having tested nothing.
    await fs.chmod(destFile, 0o000);
    await expect(fs.readFile(destFile, "utf8")).rejects.toThrow();

    const result = await strategy.apply(
      srcFile,
      destFile,
      GUARD,
      promptedApplyContext()
    );

    expect(result.action).toBe(HOST_AHEAD);
  });

  it("says which side it could not read instead of inventing a verdict", async () => {
    await fs.chmod(destFile, 0o000);
    await expect(fs.readFile(destFile, "utf8")).rejects.toThrow();

    const result = await strategy.apply(
      srcFile,
      destFile,
      GUARD,
      promptedApplyContext()
    );

    expect(result.note).toContain("could not read your project's copy");
  });

  it("keeps the host copy when Lisa's own packaged copy is the unreadable one", async () => {
    // The symmetric case, staged as a directory so it holds regardless of which
    // user the suite runs as. Either way `readFile` rejects, which is the only
    // thing the branch under test looks at.
    await fs.remove(srcFile);
    await fs.ensureDir(srcFile);

    const result = await strategy.apply(
      srcFile,
      destFile,
      GUARD,
      promptedApplyContext()
    );

    expect(result.action).toBe(HOST_AHEAD);
    expect(await fs.readFile(destFile, "utf8")).toBe(hostGuard);
  });

  it("still hands over Lisa's copy when the operator asked for it by name", async () => {
    // The exit the refusal tells them to take. Refusing on every path and then
    // ignoring the one flag that means "take upstream's version" would leave an
    // operator with a file Lisa will never update and a remediation line that
    // does nothing — this fix's own failure mode, so it is pinned here.
    const result = await strategy.apply(
      srcFile,
      destFile,
      GUARD,
      promptedApplyContext({
        refreshTemplates: { mode: "paths", paths: ["scripts/lisa-hooks"] },
      })
    );

    expect(result.action).toBe("overwritten");
    expect(await fs.readFile(destFile, "utf8")).toBe(olderUpstreamGuard);
  });
});
