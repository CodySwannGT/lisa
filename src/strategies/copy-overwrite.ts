import * as fse from "fs-extra";
import { copyFile, readFile } from "node:fs/promises";
import { mayRefreshTemplate } from "../core/config.js";
import type { FileOperationResult } from "../core/config.js";
import { isLisaOwnedTemplate } from "../core/lisa-owned-templates.js";
import {
  classifyHostCopy,
  describePreserved,
  mayRefreshLisaOwned,
} from "../core/lisa-owned-provenance.js";
import type { HashLedger } from "../core/lisa-owned-provenance.js";
import type { ICopyStrategy, StrategyContext } from "./strategy.interface.js";
import { filesIdentical, ensureParentDir } from "../utils/file-operations.js";

/**
 * Copy-overwrite strategy: Replace file if exists (prompts on conflict)
 * - Create new files silently
 * - Skip identical files
 * - Prompt on differences (or auto-accept in yesMode)
 * - Backup before overwriting
 */
export class CopyOverwriteStrategy implements ICopyStrategy {
  readonly name = "copy-overwrite" as const;

  /**
   * Apply copy-overwrite strategy: Create, skip, or prompt to overwrite file
   * @param sourcePath - Source file path
   * @param destPath - Destination file path
   * @param relativePath - Relative path for logging
   * @param context - Strategy context with config and callbacks
   * @returns Result of the copy-overwrite operation
   */
  async apply(
    sourcePath: string,
    destPath: string,
    relativePath: string,
    context: StrategyContext
  ): Promise<FileOperationResult> {
    const { config, backupFile, promptOverwrite } = context;
    const destExists = await fse.pathExists(destPath);

    if (!destExists) {
      if (!config.dryRun) {
        await ensureParentDir(destPath);
        await copyFile(sourcePath, destPath);
      }
      return { relativePath, strategy: this.name, action: "copied" };
    }

    if (await filesIdentical(sourcePath, destPath)) {
      return { relativePath, strategy: this.name, action: "skipped" };
    }

    // A non-interactive apply (postinstall / `--skip-git-check`) cannot prompt,
    // and replacing a file the project may have customised without asking is
    // not a decision this path gets to make. So the file is left alone — but
    // reported as `stale`, never as `skipped`.
    //
    // Reporting it as `skipped` is what made template changes undeliverable in
    // practice: the postinstall bootstrap is how downstream projects take an
    // upgrade, so every changed template landed here, and the summary counted
    // it beside genuinely-identical files under "identical or create-only".
    // A fix to an enforcement guard could ship in a release and reach nobody,
    // with nothing in the output to say so.
    if (config.skipGitCheck) {
      return this.applyNonInteractive(
        sourcePath,
        destPath,
        relativePath,
        context
      );
    }

    if (config.dryRun) {
      return { relativePath, strategy: this.name, action: "overwritten" };
    }

    const shouldOverwrite = await promptOverwrite(
      relativePath,
      sourcePath,
      destPath
    );

    if (shouldOverwrite) {
      await backupFile(destPath);
      await copyFile(sourcePath, destPath);
      return { relativePath, strategy: this.name, action: "overwritten" };
    }

    return { relativePath, strategy: this.name, action: "skipped" };
  }

  /**
   * Resolve a differing managed file on a non-interactive apply.
   *
   * There is no prompt available here, so a file the project may have
   * customised is left alone and reported as `stale` — unless
   * `--refresh-templates` covers it, which is the operator deciding in advance
   * to take upstream's version.
   *
   * Lisa's own artifacts are not in that category and never wait for the flag.
   * A version bump is how the fleet takes an upgrade, and it passes no flags, so
   * gating `scripts/lisa-hooks/*` behind one meant a released security fix
   * reached nobody: the fail-open fixes in #2374 shipped while installed repos
   * kept running the vulnerable guard, until someone deleted the files by hand
   * so the create path would recreate them. Lisa owns those files outright —
   * see `isLisaOwnedTemplate` — so they refresh here, backed up first, and a
   * project that wants to keep its own copy says so in `.lisaignore`.
   *
   * That refresh is unconditional only where Lisa can prove the installed copy
   * is behind. "Differs from mine" is not that proof — it is equally consistent
   * with the host being *ahead*, which is how `acmeorga/frontend` had a guard
   * they had hardened themselves silently replaced by a weaker upstream one. So
   * a Lisa-owned artifact is now classified before it is replaced, and anything
   * short of proof that it is stale leaves the host's copy alone with an
   * explanation. See `classifyHostCopy`.
   * @param sourcePath - Packaged template path
   * @param destPath - Installed file path
   * @param relativePath - Repo-relative path for reporting
   * @param context - Strategy context with config and callbacks
   * @returns Whether the file was refreshed, preserved, or left out of date
   */
  private async applyNonInteractive(
    sourcePath: string,
    destPath: string,
    relativePath: string,
    context: StrategyContext
  ): Promise<FileOperationResult> {
    const { config, backupFile } = context;
    const lisaOwned = isLisaOwnedTemplate(relativePath);

    if (
      !lisaOwned &&
      !mayRefreshTemplate(relativePath, config.refreshTemplates)
    ) {
      return { relativePath, strategy: this.name, action: "stale" };
    }

    if (lisaOwned) {
      const preserved = await this.preserveIfHostAhead(
        sourcePath,
        destPath,
        relativePath,
        context.hashLedger
      );
      if (preserved !== undefined) return preserved;
    }

    // Backed up first: opting in to an overwrite is not opting out of being
    // able to undo it.
    if (!config.dryRun) {
      await backupFile(destPath);
      await copyFile(sourcePath, destPath);
    }
    return { relativePath, strategy: this.name, action: "overwritten" };
  }

  /**
   * Hold back a Lisa-owned refresh that cannot be proved to be an upgrade.
   *
   * Returns a result only when the file is being preserved, so the caller falls
   * through to its normal refresh path in every provably-safe case — a host copy
   * that matches a past Lisa release still gets replaced, which is what keeps
   * genuine drift from accumulating forever.
   *
   * A read failure is not treated as permission to overwrite. If the installed
   * bytes cannot be read they cannot be classified, and a classifier that
   * defaults to "overwrite" when it is confused is the original defect wearing a
   * different hat.
   * @param sourcePath - Packaged template path
   * @param destPath - Installed file path
   * @param relativePath - Repo-relative path for reporting
   * @param ledger - Known-good hashes, defaulting to Lisa's shipping history
   * @returns A `host-ahead` result when the copy is preserved, else undefined
   */
  private async preserveIfHostAhead(
    sourcePath: string,
    destPath: string,
    relativePath: string,
    ledger?: HashLedger
  ): Promise<FileOperationResult | undefined> {
    const [hostBytes, lisaBytes] = await Promise.all([
      readFile(destPath).catch(() => undefined),
      readFile(sourcePath).catch(() => undefined),
    ]);
    if (hostBytes === undefined || lisaBytes === undefined) return undefined;

    const verdict = classifyHostCopy(
      relativePath,
      hostBytes,
      lisaBytes,
      ledger
    );
    if (mayRefreshLisaOwned(verdict)) return undefined;

    return {
      relativePath,
      strategy: this.name,
      action: "host-ahead",
      note: describePreserved(relativePath, verdict),
    };
  }
}
