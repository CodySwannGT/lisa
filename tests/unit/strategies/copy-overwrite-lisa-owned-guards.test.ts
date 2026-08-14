/**
 * A version bump has to deliver a fixed enforcement guard.
 *
 * How installed projects take an upgrade is `npm update @codyswann/lisa`, whose
 * postinstall runs a non-interactive apply. That apply cannot prompt, so it used
 * to leave every differing managed file alone — including Lisa's own guard
 * scripts. The visible consequence was that the fail-open fixes in #2374 never
 * reached the fleet: a downstream project had to delete `scripts/lisa-hooks/*`
 * by hand so the create path would recreate them.
 *
 * Being conservative is right for files a project customises. It is wrong for
 * files Lisa owns outright — nobody edits `scripts/lisa-hooks/block-no-verify.sh`
 * downstream, and a stale copy of it is a hole in the enforcement. These tests
 * pin both halves of that line.
 * @module tests/unit/strategies/copy-overwrite-lisa-owned-guards
 */
import * as fs from "fs-extra";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";

import { CopyOverwriteStrategy } from "../../../src/strategies/copy-overwrite.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

const GUARD = "scripts/lisa-hooks/block-no-verify.sh";
const FALLBACK = "scripts/lisa-enforcement-fallback.sh";
const HOST_CONFIG = "tsconfig.json";
const FAIL_OPEN_GUARD = "#!/usr/bin/env bash\n# fails open\n";
const FIXED_GUARD = "#!/usr/bin/env bash\n# closed\n";

describe("CopyOverwriteStrategy: Lisa-owned artifacts on a version bump", () => {
  let strategy: CopyOverwriteStrategy;
  let tempDir: string;
  let srcDir: string;
  let destDir: string;

  beforeEach(async () => {
    strategy = new CopyOverwriteStrategy();
    tempDir = await createTempDir();
    srcDir = path.join(tempDir, "src");
    destDir = path.join(tempDir, "dest");
    await fs.ensureDir(srcDir);
    await fs.ensureDir(destDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Build the context a postinstall apply runs with: non-interactive, and with
   * no `--refresh-templates` opt-in, because a version bump passes none.
   *
   * The ledger states that `FAIL_OPEN_GUARD` really is a set of bytes Lisa once
   * published, which is what a project sitting on an old release actually has.
   * Without it these fixtures would be content Lisa never shipped — indisputably
   * a downstream edit — and refresh would correctly preserve them, so every
   * assertion below would be exercising the downgrade-protection path while
   * claiming to test the upgrade path.
   * @param overrides - Configuration overrides
   * @returns Strategy context representing a postinstall apply
   */
  function versionBumpContext(
    overrides: Partial<LisaConfig> = {}
  ): StrategyContext {
    const config: LisaConfig = {
      lisaDir: srcDir,
      destDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: true,
      harness: "claude",
      ...overrides,
    };
    const shipped = createHash("sha256")
      .update(Buffer.from(FAIL_OPEN_GUARD))
      .digest("hex");
    return {
      config,
      backupFile: async () => {},
      promptOverwrite: async () => true,
      hashLedger: { [GUARD]: [shipped], [FALLBACK]: [shipped] },
    };
  }

  /**
   * Stage a differing managed file inside the temp project.
   * @param rel - Repo-relative path to stage
   * @param srcContent - Content of the packaged template
   * @param destContent - Content already installed in the project
   * @returns Absolute source and destination paths
   */
  async function stage(
    rel: string,
    srcContent: string,
    destContent: string
  ): Promise<{ srcFile: string; destFile: string }> {
    const srcFile = path.join(srcDir, rel);
    const destFile = path.join(destDir, rel);
    await fs.ensureDir(path.dirname(srcFile));
    await fs.ensureDir(path.dirname(destFile));
    await fs.writeFile(srcFile, srcContent);
    await fs.writeFile(destFile, destContent);
    return { srcFile, destFile };
  }

  it("delivers a fixed guard to an already-installed project", async () => {
    const { srcFile, destFile } = await stage(
      GUARD,
      FIXED_GUARD,
      FAIL_OPEN_GUARD
    );

    const result = await strategy.apply(
      srcFile,
      destFile,
      GUARD,
      versionBumpContext()
    );

    expect(result.action).toBe("overwritten");
    expect(await fs.readFile(destFile, "utf-8")).toBe(FIXED_GUARD);
  });

  it("delivers the enforcement fallback dispatcher too", async () => {
    const { srcFile, destFile } = await stage(
      FALLBACK,
      FIXED_GUARD,
      FAIL_OPEN_GUARD
    );

    const result = await strategy.apply(
      srcFile,
      destFile,
      FALLBACK,
      versionBumpContext()
    );

    expect(result.action).toBe("overwritten");
    expect(await fs.readFile(destFile, "utf-8")).toBe(FIXED_GUARD);
  });

  it("backs the previous guard up before replacing it", async () => {
    const { srcFile, destFile } = await stage(
      GUARD,
      FIXED_GUARD,
      FAIL_OPEN_GUARD
    );
    let backedUp: string | null = null;

    await strategy.apply(srcFile, destFile, GUARD, {
      ...versionBumpContext(),
      backupFile: async (target: string) => {
        backedUp = target;
      },
    });

    expect(backedUp).toBe(destFile);
  });

  it("still leaves host-owned managed config alone", async () => {
    // The conservative default is what stops an upgrade quietly replacing a
    // tsconfig.json a project has customised. Delivering guards must not cost
    // a project that protection.
    const { srcFile, destFile } = await stage(
      HOST_CONFIG,
      '{"strict":true}',
      "{}"
    );

    const result = await strategy.apply(
      srcFile,
      destFile,
      HOST_CONFIG,
      versionBumpContext()
    );

    expect(result.action).toBe("stale");
    expect(await fs.readFile(destFile, "utf-8")).toBe("{}");
  });

  it("writes nothing during a dry run", async () => {
    const { srcFile, destFile } = await stage(
      GUARD,
      FIXED_GUARD,
      FAIL_OPEN_GUARD
    );

    const result = await strategy.apply(
      srcFile,
      destFile,
      GUARD,
      versionBumpContext({ dryRun: true })
    );

    expect(result.action).toBe("overwritten");
    expect(await fs.readFile(destFile, "utf-8")).toBe(FAIL_OPEN_GUARD);
  });

  it("leaves an identical guard untouched", async () => {
    const { srcFile, destFile } = await stage(GUARD, FIXED_GUARD, FIXED_GUARD);

    const result = await strategy.apply(
      srcFile,
      destFile,
      GUARD,
      versionBumpContext()
    );

    expect(result.action).toBe("skipped");
  });
});
