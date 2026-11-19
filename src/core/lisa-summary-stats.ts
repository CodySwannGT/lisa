/**
 * @file lisa-summary-stats.ts
 * @description Per-mode statistics and detail sections of the apply summary. One layer of the `Lisa` orchestrator; each layer
 * extends the one below it so the apply pipeline reads as one class while no
 * single module carries the whole pipeline.
 * @module core
 */
import pc from "picocolors";
import { APPLY_RECEIPT_DISPLAY_PATH } from "./apply-receipt.js";
import { LisaState } from "./lisa-state.js";

/**
 * Per-mode statistics and detail sections of the apply summary.
 */
export abstract class LisaSummaryStats extends LisaState {
  /**
   * Print summary header with mode
   */
  protected printSummaryHeader(): void {
    console.log("");
    console.log(pc.green(this.separator));

    if (this.config.validateOnly) {
      console.log(pc.green("    Lisa Validation Complete"));
    } else if (this.config.dryRun) {
      console.log(pc.green("    Lisa Dry Run Complete"));
    } else {
      console.log(pc.green("    Lisa Installation Complete!"));
    }

    console.log(pc.green(this.separator));
    console.log("");
  }

  /**
   * Print a single stat line with color
   * @param label - Stat label
   * @param value - Stat value
   * @param color - Color function from picocolors
   * @param suffix - Optional suffix after the count
   */
  protected printStatLine(
    label: string,
    value: number,
    color: (s: string) => string,
    suffix = ""
  ): void {
    const suffixText = suffix ? ` ${suffix}` : "";
    console.log(
      `  ${color(label)} ${String(value).padStart(3)} files${suffixText}`
    );
  }

  /**
   * Print summary statistics for validate mode
   */
  protected printValidateStats(): void {
    const { copied, skipped, overwritten, appended, merged, deleted, ignored } =
      this.counters;
    this.printStatLine("Compatible files:   ", copied, pc.green);
    this.printStatLine("Already present:    ", skipped, pc.blue);
    this.printStatLine("Would conflict:     ", overwritten, pc.yellow);
    this.printStatLine("Would append:       ", appended, pc.blue);
    this.printStatLine("Would merge:        ", merged, pc.green);
    this.printStatLine("Would delete:       ", deleted, pc.red);
    if (ignored > 0) {
      this.printStatLine(
        "Ignored:            ",
        ignored,
        pc.magenta,
        this.lisaignoreSuffix
      );
    }
  }

  /**
   * Print summary statistics for dry-run mode
   */
  protected printDryRunStats(): void {
    const { copied, skipped, overwritten, appended, merged, deleted, ignored } =
      this.counters;
    this.printStatLine("Would copy:     ", copied, pc.green);
    this.printStatLine(
      "Would skip:     ",
      skipped,
      pc.blue,
      "(identical or create-only)"
    );
    this.printStatLine("Would prompt:   ", overwritten, pc.yellow, "(differ)");
    this.printStatLine(
      "Out of date:    ",
      this.counters.stale,
      pc.yellow,
      "(managed templates changed; would NOT be updated)"
    );
    this.printStatLine(
      "Would append:   ",
      appended,
      pc.blue,
      "(copy-contents)"
    );
    this.printStatLine("Would merge:    ", merged, pc.green, "(JSON)");
    this.printStatLine("Would delete:   ", deleted, pc.red);
    if (ignored > 0) {
      this.printStatLine(
        "Would ignore:   ",
        ignored,
        pc.magenta,
        this.lisaignoreSuffix
      );
    }
    this.printStaleDetail();
    this.printHostAheadDetail();
    this.printShadowedDetail();
    this.printDeletionDetail();
  }

  /**
   * Print summary statistics for apply mode
   */
  protected printApplyStats(): void {
    const { copied, skipped, overwritten, appended, merged, deleted, ignored } =
      this.counters;
    this.printStatLine("Copied:     ", copied, pc.green);
    this.printStatLine(
      "Skipped:    ",
      skipped,
      pc.blue,
      "(identical or create-only)"
    );
    // Not every overwrite is a human saying yes: Lisa's own artifacts refresh
    // on any apply, which is how a released guard fix reaches installed
    // projects. Saying "user approved" here would misreport that as consent
    // nobody gave.
    this.printStatLine(
      "Overwritten:",
      overwritten,
      pc.yellow,
      "(approved or Lisa-owned)"
    );
    this.printStatLine(
      "Out of date:",
      this.counters.stale,
      pc.yellow,
      "(managed templates changed; NOT updated)"
    );
    this.printStatLine("Appended:   ", appended, pc.blue, "(copy-contents)");
    this.printStatLine("Merged:     ", merged, pc.green, "(JSON merged)");
    this.printStatLine("Deleted:    ", deleted, pc.red);
    if (ignored > 0) {
      this.printStatLine(
        "Ignored:    ",
        ignored,
        pc.magenta,
        this.lisaignoreSuffix
      );
    }
    this.printStaleDetail();
    this.printHostAheadDetail();
    this.printShadowedDetail();
    this.printDeletionDetail();
  }

  /**
   * Name the out-of-date managed files and say how to update them.
   *
   * A bare count is not enough to act on. An operator taking an upgrade needs
   * to see WHICH managed files the release changed and did not deliver —
   * particularly the enforcement guards, where the gap is a security control
   * that stayed on its old version while the release notes said otherwise.
   */
  protected printStaleDetail(): void {
    if (this.counters.stale === 0) return;
    const { logger } = this.deps;

    logger.warn(
      this.config.dryRun
        ? `${this.counters.stale} managed file(s) changed upstream and would be left as-is:`
        : `${this.counters.stale} managed file(s) changed upstream but were left as-is:`
    );
    for (const relativePath of this.stalePaths) {
      logger.warn(`  ${relativePath}`);
    }
    logger.info(
      "A non-interactive apply will not replace a file your project may have customised."
    );
    logger.info(
      "To take upstream's version of one, name it: `lisa apply . --refresh-templates=<path>`."
    );
    logger.info(
      "Name them ONE AT A TIME. Bare `--refresh-templates` is repo-wide and reverts every deliberate fork at once."
    );
    logger.info(
      "To keep yours instead, add the path to .lisaignore. Either way, decide — an unread file stops receiving upstream fixes, security fixes included."
    );
  }

  /**
   * Report Lisa-owned artifacts this apply chose not to replace.
   *
   * Reported as good news, not as a warning about the project: keeping a guard
   * that is stronger than Lisa's is the correct outcome, and phrasing it as a
   * problem would push an operator to "fix" it by discarding their own
   * hardening — the exact loss the check exists to prevent.
   */
  protected printHostAheadDetail(): void {
    if (this.counters.hostAhead === 0) return;
    const { logger } = this.deps;

    logger.info(
      `${this.counters.hostAhead} Lisa-owned file(s) look stronger in your project than in Lisa, so your version was kept:`
    );
    for (const note of this.hostAheadNotes) {
      logger.info(`  ${note}`);
    }
    logger.info(
      "Nothing is broken. Lisa only replaces one of its own files when it can prove your copy came from an older Lisa."
    );
  }

  /**
   * Name every template this apply declined to write to avoid outranking the
   * project's own configuration.
   *
   * Reported as good news for the same reason as {@link printHostAheadDetail}:
   * the project's config surviving is the correct outcome. But it is stated at
   * all because the *absence* of a file is invisible — a template that never
   * arrives looks identical to one that was never shipped, and this is the only
   * moment anything can say which happened (CodySwannGT/lisa#3501).
   */
  protected printShadowedDetail(): void {
    if (this.counters.shadowed === 0) return;
    const { logger } = this.deps;

    logger.info(
      `${this.counters.shadowed} template(s) were not written because this project already configures those tools itself:`
    );
    for (const note of this.shadowedNotes) {
      logger.info(`  ${note}`);
    }
    logger.info(
      "Nothing is broken. Lisa's file would have taken precedence over yours, so yours was left in charge."
    );
  }

  /**
   * Name every path this apply removed, and every workflow it declined to.
   *
   * Deliberately unconditional on the removals, and deliberately wider than the
   * ownership gate. Lisa is entitled to retire its own artifacts, and it still
   * says so out loud, because the cost of an unannounced removal is not
   * proportional to whether it was justified: a workflow that no longer exists
   * cannot fail, so its absence produces no red check anywhere and reads
   * exactly like a healthy repo (CodySwannGT/lisa#3656). The same is true, more
   * quietly, of a deleted `.claude/skills/<name>` directory or a root-level
   * `eslint-plugin-*` tree. Reviewing the upgrade diff has to be enough to
   * notice, and that only works if the install told somebody.
   */
  protected printDeletionDetail(): void {
    if (this.deletionNotices.length === 0) return;
    const { logger } = this.deps;

    logger.warn("Files this run removed, and workflows it declined to remove:");
    for (const notice of this.deletionNotices) {
      logger.warn(`  ${notice}`);
    }
    logger.info(
      `The removals are also recorded in ${APPLY_RECEIPT_DISPLAY_PATH}, because install output does not survive: package managers hide postinstall stdout and the reconciliation trampoline runs detached with stdio "ignore".`
    );
    logger.info(
      "A removed workflow takes its checks with it and cannot fail afterwards, so its absence looks exactly like a healthy repo. If any removed file was yours, restore it from git and add its path to .lisaignore — that is checked before every deletion, workflow or not."
    );
  }
}
