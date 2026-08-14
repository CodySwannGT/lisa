/**
 * The unattended apply must not silently downgrade a guard.
 *
 * This is the path that actually caused the incident: `bun install` in
 * `propswapllc/frontend` ran a non-interactive apply, which regenerated
 * `scripts/lisa-hooks/block-no-verify.sh` from the installed package and reverted
 * hardening the project had added itself. Nobody was prompted, nothing failed,
 * and the only reason it was noticed is that the repo's own tests went red.
 *
 * So these assertions go through `CopyOverwriteStrategy` with a real temp
 * project rather than through the classifier alone — the classifier being right
 * is worth nothing if the strategy does not consult it.
 * @module tests/unit/strategies/copy-overwrite-host-ahead
 */
import * as fs from "fs-extra";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";

import type { LisaConfig } from "../../../src/core/config.js";
import type { HashLedger } from "../../../src/core/lisa-owned-provenance.js";
import { CopyOverwriteStrategy } from "../../../src/strategies/copy-overwrite.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

const GUARD = "scripts/lisa-hooks/block-no-verify.sh";
const HOST_CONFIG = "tsconfig.json";

/** What upstream ships today. */
const LISA_GUARD =
  "#!/usr/bin/env bash\n# lisa-guard-capabilities: no-verify-abbrev\necho lisa\n";

/** A previous Lisa release, still installed in a project that has not upgraded. */
const OLD_LISA_GUARD =
  "#!/usr/bin/env bash\n# lisa-guard-capabilities: no-verify-abbrev\necho old\n";

/** The downstream copy that closed a vector upstream had not. */
const HARDENED_GUARD =
  "#!/usr/bin/env bash\n# lisa-guard-capabilities: no-verify-abbrev, git-config-key\necho hardened\n";

describe("CopyOverwriteStrategy: a host copy that may be ahead", () => {
  let strategy: CopyOverwriteStrategy;
  let tempDir: string;
  let srcDir: string;
  let destDir: string;
  let backedUp: string[];

  beforeEach(async () => {
    strategy = new CopyOverwriteStrategy();
    tempDir = await createTempDir();
    srcDir = path.join(tempDir, "src");
    destDir = path.join(tempDir, "dest");
    backedUp = [];
    await fs.ensureDir(srcDir);
    await fs.ensureDir(destDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * A ledger asserting Lisa really published these contents at the guard path.
   * @param contents - Every published revision of the guard
   * @returns A hash ledger for injection
   */
  function ledgerOf(contents: readonly string[]): HashLedger {
    return {
      [GUARD]: contents.map(content =>
        createHash("sha256").update(Buffer.from(content)).digest("hex")
      ),
    };
  }

  /**
   * The context a postinstall apply runs with: non-interactive, no opt-in flag.
   * @param ledger - Known-good hashes for the guard
   * @returns Strategy context representing an unattended version bump
   */
  function versionBumpContext(ledger: HashLedger): StrategyContext {
    const config: LisaConfig = {
      lisaDir: srcDir,
      destDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: true,
      harness: "claude",
    };
    return {
      config,
      backupFile: async absolutePath => {
        backedUp.push(absolutePath);
      },
      promptOverwrite: async () => true,
      hashLedger: ledger,
    };
  }

  /**
   * Stage the packaged guard and the project's installed copy.
   * @param lisaContent - Contents of the packaged template
   * @param hostContent - Contents already installed in the project
   * @returns Absolute source and destination paths
   */
  async function stage(
    lisaContent: string,
    hostContent: string
  ): Promise<{ srcFile: string; destFile: string }> {
    const srcFile = path.join(srcDir, GUARD);
    const destFile = path.join(destDir, GUARD);
    await fs.ensureDir(path.dirname(srcFile));
    await fs.ensureDir(path.dirname(destFile));
    await fs.writeFile(srcFile, lisaContent);
    await fs.writeFile(destFile, hostContent);
    return { srcFile, destFile };
  }

  it("keeps a hardened guard and reports what upstream would have removed", async () => {
    const { srcFile, destFile } = await stage(LISA_GUARD, HARDENED_GUARD);

    const result = await strategy.apply(
      srcFile,
      destFile,
      GUARD,
      versionBumpContext(ledgerOf([LISA_GUARD, OLD_LISA_GUARD]))
    );

    expect(result.action).toBe("host-ahead");
    expect(result.note).toContain("git-config-key");
    expect(await fs.readFile(destFile, "utf8")).toBe(HARDENED_GUARD);
  });

  it("keeps an undeclared downstream edit rather than guess it is stale", async () => {
    const edited = "#!/usr/bin/env bash\n# hardened by hand, undeclared\n";
    const { srcFile, destFile } = await stage(LISA_GUARD, edited);

    const result = await strategy.apply(
      srcFile,
      destFile,
      GUARD,
      versionBumpContext(ledgerOf([LISA_GUARD, OLD_LISA_GUARD]))
    );

    expect(result.action).toBe("host-ahead");
    expect(await fs.readFile(destFile, "utf8")).toBe(edited);
  });

  it("refreshes a guard whose bytes are a known past Lisa release", async () => {
    // The other direction. Without this, a classifier that preserved everything
    // would pass the assertions above while quietly breaking every upgrade.
    const { srcFile, destFile } = await stage(LISA_GUARD, OLD_LISA_GUARD);

    const result = await strategy.apply(
      srcFile,
      destFile,
      GUARD,
      versionBumpContext(ledgerOf([LISA_GUARD, OLD_LISA_GUARD]))
    );

    expect(result.action).toBe("overwritten");
    expect(await fs.readFile(destFile, "utf8")).toBe(LISA_GUARD);
    expect(backedUp).toContain(destFile);
  });

  it("refreshes once upstream declares everything the host declared", async () => {
    const absorbed =
      "#!/usr/bin/env bash\n# lisa-guard-capabilities: no-verify-abbrev, git-config-key\necho upstream\n";
    const { srcFile, destFile } = await stage(absorbed, HARDENED_GUARD);

    const result = await strategy.apply(
      srcFile,
      destFile,
      GUARD,
      versionBumpContext(ledgerOf([LISA_GUARD]))
    );

    expect(result.action).toBe("overwritten");
    expect(await fs.readFile(destFile, "utf8")).toBe(absorbed);
  });

  it("still refreshes an artifact no ledger entry covers", async () => {
    const unenrolled = "scripts/lisa-hooks/newly-added.sh";
    const srcFile = path.join(srcDir, unenrolled);
    const destFile = path.join(destDir, unenrolled);
    await fs.ensureDir(path.dirname(srcFile));
    await fs.ensureDir(path.dirname(destFile));
    await fs.writeFile(srcFile, "#!/usr/bin/env bash\necho new\n");
    await fs.writeFile(destFile, "#!/usr/bin/env bash\necho older\n");

    const result = await strategy.apply(
      srcFile,
      destFile,
      unenrolled,
      versionBumpContext(ledgerOf([LISA_GUARD]))
    );

    expect(result.action).toBe("overwritten");
  });

  it("leaves a host-owned config on the stale path, not the host-ahead one", async () => {
    // `tsconfig.json` carries no `lisa-` segment, so it never reaches the
    // provenance check and keeps its existing "left alone, reported stale"
    // behaviour.
    const srcFile = path.join(srcDir, HOST_CONFIG);
    const destFile = path.join(destDir, HOST_CONFIG);
    await fs.writeFile(srcFile, '{"strict": true}\n');
    await fs.writeFile(destFile, '{"strict": false}\n');

    const result = await strategy.apply(
      srcFile,
      destFile,
      HOST_CONFIG,
      versionBumpContext(ledgerOf([LISA_GUARD]))
    );

    expect(result.action).toBe("stale");
  });
});
