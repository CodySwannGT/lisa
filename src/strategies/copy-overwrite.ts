import * as fse from "fs-extra";
import { copyFile, readFile } from "node:fs/promises";
import { mayRefreshTemplate } from "../core/config.js";
import type { FileOperationResult } from "../core/config.js";
import { isLisaOwnedTemplate } from "../core/lisa-owned-templates.js";
import {
  classifyHostCopy,
  describePreserved,
  describeUnclassifiable,
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

    // Before any branch below decides *how* to replace the file, ask whether
    // replacing it is an upgrade at all.
    //
    // This classification used to live inside `applyNonInteractive`, which is
    // reached only when `skipGitCheck` is set — the postinstall's flag, not the
    // command's. So `lisa apply` typed by an operator, `lisa apply --yes`, and
    // every non-TTY run took the prompt branch instead and replaced the file
    // without ever classifying it. Non-TTY is not the exotic case: it is what
    // every scripted and agent-driven apply gets, and at the time
    // `createPrompter` answered it with `AutoAcceptPrompter`, whose
    // `promptOverwrite` says "yes" without asking anyone. The guard that stops
    // a guard being silently downgraded could be walked around by running the
    // command the normal way (#2577). That prompter mapping is itself fixed in
    // #3026, but this classification stays ahead of every branch regardless:
    // `--yes` still reaches the overwrite, and a downgrade must not ride in on
    // it.
    const preserved = await this.preserveOwnedHostCopy(
      sourcePath,
      destPath,
      relativePath,
      context
    );
    if (preserved !== undefined) return preserved;

    // An apply with nobody to ask cannot prompt, and replacing a file the
    // project may have customised without asking is not a decision this path
    // gets to make. So the file is left alone — but reported as `stale`, never
    // as `skipped`.
    //
    // Reporting it as `skipped` is what made template changes undeliverable in
    // practice: the postinstall bootstrap is how downstream projects take an
    // upgrade, so every changed template landed here, and the summary counted
    // it beside genuinely-identical files under "identical or create-only".
    // A fix to an enforcement guard could ship in a release and reach nobody,
    // with nothing in the output to say so.
    //
    // There are two ways to have nobody to ask, and only the first was
    // recognised. `skipGitCheck` is the postinstall's flag. The second is a
    // plain `lisa apply` in a shell with no TTY — every agent, script, and CI
    // run — where `promptOverwrite` is not a question at all: with no usable
    // stdin the prompter answers without asking anyone. That route fell
    // through to the prompt branch below and replaced host-customised
    // `knip.json`, `eslint.config.ts`, and `tsconfig.json` outright, reporting
    // them as approved. `core/lisa-owned-templates` had already written down
    // the rule this violates — those files "are seeded by Lisa and then edited
    // downstream, so a non-interactive apply must never replace them without
    // being asked" — but "non-interactive" had been read as one flag rather
    // than as the condition it names (#3026).
    //
    // `--yes` is not this case. That flag is the operator deciding in advance,
    // so `context.unattended` is false for it and the overwrite proceeds.
    if (config.skipGitCheck || context.unattended === true) {
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
   * they had hardened themselves silently replaced by a weaker upstream one.
   * That classification now runs in `apply`, before any branch here is chosen,
   * so it covers the prompted routes too — see `preserveOwnedHostCopy`.
   * Anything arriving here is either not Lisa's to judge, or provably behind.
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

    if (
      !isLisaOwnedTemplate(relativePath) &&
      !mayRefreshTemplate(relativePath, config.refreshTemplates)
    ) {
      return { relativePath, strategy: this.name, action: "stale" };
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
   * Hold back a replacement of a Lisa-owned artifact on every route that has
   * one, rather than on the single unattended route.
   *
   * Two conditions still let a replacement through. The file must be one Lisa
   * owns outright — a `tsconfig.json` the project customised is not Lisa's to
   * judge, and keeps its existing prompt-or-stale behaviour. And the operator
   * must not have named it to `--refresh-templates`, which is them saying in
   * advance "take upstream's version of these". That flag is the exit
   * `describePreserved` tells them to use, so it has to actually work; the
   * postinstall passes no flags, so honouring it here changes nothing for the
   * unattended fleet.
   * @param sourcePath - Packaged template path
   * @param destPath - Installed file path
   * @param relativePath - Repo-relative path for reporting
   * @param context - Strategy context with config and ledger
   * @returns A preserved result when the copy is kept, else undefined
   */
  private async preserveOwnedHostCopy(
    sourcePath: string,
    destPath: string,
    relativePath: string,
    context: StrategyContext
  ): Promise<FileOperationResult | undefined> {
    if (!isLisaOwnedTemplate(relativePath)) return undefined;
    if (mayRefreshTemplate(relativePath, context.config.refreshTemplates)) {
      return undefined;
    }
    return this.preserveIfHostAhead(
      sourcePath,
      destPath,
      relativePath,
      context.hashLedger
    );
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
   *
   * That sentence described the intent and not the code until now: an
   * unreadable file returned `undefined`, which is this method's word for
   * "nothing to preserve", and the caller carried straight on to the overwrite.
   * `filesIdentical` swallows its own read errors and answers "differs", so an
   * unreadable Lisa-owned guard reached here on every apply and was replaced
   * without ever being classified. Now it is kept, and the reason is named.
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
    if (hostBytes === undefined || lisaBytes === undefined) {
      return {
        relativePath,
        strategy: this.name,
        action: "host-ahead",
        note: describeUnclassifiable(relativePath, hostBytes === undefined),
      };
    }

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
