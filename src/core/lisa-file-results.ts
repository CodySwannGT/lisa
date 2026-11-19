/**
 * @file lisa-file-results.ts
 * @description Counting and reporting the outcome of each template file operation. One layer of the `Lisa` orchestrator; each layer
 * extends the one below it so the apply pipeline reads as one class while no
 * single module carries the whole pipeline.
 * @module core
 */
import type { FileOperationResult } from "./config.js";
import { LisaSummary } from "./lisa-summary.js";

/**
 * Counting and reporting the outcome of each template file operation.
 */
export abstract class LisaFileResults extends LisaSummary {
  /**
   * Update counters based on operation result
   * @param result Operation result to count
   */
  protected updateCounters(result: FileOperationResult): void {
    switch (result.action) {
      case "copied":
      case "created":
        this.counters.copied++;
        break;
      case "skipped":
        this.counters.skipped++;
        break;
      case "stale":
        this.counters.stale++;
        this.stalePaths.push(result.relativePath);
        break;
      case "host-ahead":
        this.counters.hostAhead++;
        this.hostAheadNotes.push(
          result.note ?? `${result.relativePath}: kept your copy.`
        );
        break;
      case "shadowed":
        this.counters.shadowed++;
        this.shadowedNotes.push(
          result.note ??
            `${result.relativePath}: not written — it would outrank your own config.`
        );
        break;
      case "overwritten":
        this.counters.overwritten++;
        break;
      case "appended":
        this.counters.appended++;
        break;
      case "merged":
        this.counters.merged++;
        break;
    }
  }

  /**
   * Log a message using appropriate logger method
   * @param dryMsg Message for dry run mode
   * @param successMsg Message for success mode
   */
  protected logMessage(dryMsg: string, successMsg: string): void {
    const { logger } = this.deps;
    this.config.dryRun ? logger.dry(dryMsg) : logger.success(successMsg);
  }

  /**
   * Log operation result
   * @param result Result to log
   */
  protected logResult(result: FileOperationResult): void {
    switch (result.action) {
      case "copied":
        this.logMessage(
          `Would copy: ${result.relativePath}`,
          `Copied: ${result.relativePath}`
        );
        this.logNote(result);
        break;
      case "created":
        this.logMessage(
          `Would create: ${result.relativePath}`,
          `Created: ${result.relativePath}`
        );
        break;
      case "skipped":
        // Silent about the file itself — nothing changed, and naming every
        // untouched path would bury the run. But a note attached to a skipped
        // result is not about the write: it is what the apply FOUND, such as a
        // governed gate the project's own script no longer invokes. That
        // condition persists across applies and reaches this branch on every
        // one of them, so dropping it here is how a finding becomes permanently
        // invisible.
        this.logNote(result);
        break;
      case "stale":
        this.deps.logger.warn(
          this.config.dryRun
            ? `Out of date, would not be updated: ${result.relativePath}`
            : `Out of date, not updated: ${result.relativePath}`
        );
        break;
      case "host-ahead":
        this.deps.logger.warn(
          this.config.dryRun
            ? `Would keep your copy: ${result.relativePath}`
            : `Kept your copy: ${result.relativePath}`
        );
        break;
      case "shadowed":
        // Warn, not info: the file is absent by design, and an operator who
        // later wonders why the template never arrived needs this line to have
        // been visible at the time.
        this.deps.logger.warn(
          this.config.dryRun
            ? `Would not write, your own config takes precedence: ${result.relativePath}`
            : `Not written, your own config takes precedence: ${result.relativePath}`
        );
        this.logNote(result);
        break;
      case "overwritten":
        this.logMessage(
          `Would prompt to overwrite: ${result.relativePath}`,
          `Overwritten: ${result.relativePath}`
        );
        break;
      case "appended": {
        const msg = `Appended ${result.linesAdded} lines to: ${result.relativePath}`;
        this.logMessage(`Would ${msg}`, msg);
        break;
      }
      case "merged":
        this.logMessage(
          `Would merge: ${result.relativePath}`,
          `Merged: ${result.relativePath}`
        );
        if (result.note !== undefined) {
          this.logNote(result);
        }
        break;
    }
  }

  /**
   * Log an optional operation note.
   * @param result Operation result that may carry an operator-readable note
   */
  protected logNote(result: FileOperationResult): void {
    if (result.note !== undefined) {
      this.deps.logger.info(result.note);
    }
  }

  /**
   * Emit a "would skip"/"skipped" log line in a single place so all the skip
   * branches in `shouldProcessFile` stay symmetric.
   * @param dryReason - Reason text for dry-run mode
   * @param relativePath - Path being skipped
   * @param applyMessage - Message to log when not in dry-run mode
   */
  protected logSkip(
    dryReason: string,
    relativePath: string,
    applyMessage: string
  ): void {
    const { logger } = this.deps;
    if (this.config.dryRun) {
      logger.dry(`Would skip (${dryReason}): ${relativePath}`);
    } else {
      logger.info(`${applyMessage}: ${relativePath}`);
    }
  }

  /**
   * Show diff between two files
   * @param sourcePath Source file path
   * @param destPath Destination file path
   */
  protected async showDiff(
    sourcePath: string,
    destPath: string
  ): Promise<void> {
    const { spawn } = await import("node:child_process");

    return new Promise(resolve => {
      console.log("--- Differences ---");
      const diff = spawn("diff", [destPath, sourcePath], { stdio: "inherit" });
      diff.on("close", () => {
        console.log("-------------------");
        resolve();
      });
    });
  }

  /**
   * Handle overwrite prompt for conflicting files
   * @param relativePath Relative path of the file
   * @param sourcePath Source file path
   * @param destPath Destination file path
   * @returns True if user approves overwrite
   */
  protected async handleOverwritePrompt(
    relativePath: string,
    sourcePath: string,
    destPath: string
  ): Promise<boolean> {
    const { logger, prompter } = this.deps;

    const decision = await prompter.promptOverwrite(relativePath);

    if (decision === "diff") {
      // Show diff and re-prompt
      await this.showDiff(sourcePath, destPath);
      return this.handleOverwritePrompt(relativePath, sourcePath, destPath);
    }

    if (decision === "yes") {
      logger.info(
        `Auto-accepting overwrite (non-interactive): ${relativePath}`
      );
      return true;
    }

    return false;
  }
}
