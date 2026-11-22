/**
 * @file lisa-summary.ts
 * @description Header, summary, and post-apply notices Lisa prints to the operator. One layer of the `Lisa` orchestrator; each layer
 * extends the one below it so the apply pipeline reads as one class while no
 * single module carries the whole pipeline.
 * @module core
 */
import * as path from "node:path";
import pc from "picocolors";
import { LisaSummaryStats } from "./lisa-summary-stats.js";

/**
 * Header, summary, and post-apply notices Lisa prints to the operator.
 */
export abstract class LisaSummary extends LisaSummaryStats {
  /**
   * Print header banner
   */
  protected printHeader(): void {
    const { logger } = this.deps;

    console.log("");
    console.log(pc.blue(this.separator));

    if (this.config.validateOnly) {
      console.log(pc.blue("    Lisa Project Bootstrapper (VALIDATE)"));
    } else if (this.config.dryRun) {
      console.log(pc.blue("    Lisa Project Bootstrapper (DRY RUN)"));
    } else {
      console.log(pc.blue("    Lisa Project Bootstrapper"));
    }

    console.log(pc.blue(this.separator));
    console.log("");

    if (this.config.validateOnly) {
      logger.info("Validate mode - checking project compatibility");
    } else if (this.config.dryRun) {
      logger.warn("Dry run mode - no changes will be made");
    }

    logger.info(`Lisa directory: ${this.config.lisaDir}`);
    logger.info(`Destination:    ${this.config.destDir}`);
    console.log("");
  }

  /**
   * Print summary statistics
   */
  protected printSummaryStats(): void {
    if (this.config.validateOnly) {
      this.printValidateStats();
    } else if (this.config.dryRun) {
      this.printDryRunStats();
    } else {
      this.printApplyStats();
    }

    const { migrationsApplied } = this.counters;
    if (migrationsApplied > 0) {
      this.printStatLine("Migrations: ", migrationsApplied, pc.cyan, "applied");
    }
  }

  /**
   * Print project types
   */
  protected printProjectTypes(): void {
    console.log("");

    const allAndDetected =
      this.detectedTypes.length > 0
        ? `all ${this.detectedTypes.join(" ")}`
        : "all";

    console.log(`Project types: ${pc.green(allAndDetected)}`);

    console.log("");
  }

  /**
   * Print validation result
   */
  protected printValidationResult(): void {
    if (!this.config.validateOnly) return;

    const { logger } = this.deps;
    const { overwritten } = this.counters;

    if (overwritten > 0) {
      logger.warn(
        `Validation found ${overwritten} file(s) that would conflict`
      );
      console.log("Run without --validate to apply changes interactively");
    } else {
      logger.success("Project is compatible with Lisa configurations");
    }
  }

  /**
   * Print summary
   */
  protected printSummary(): void {
    this.printSummaryHeader();
    this.printSummaryStats();
    this.printProjectTypes();
    this.printValidationResult();
  }

  /**
   * Print migration notices when the project's ci.yml or deploy.yml still reference
   * local quality/release workflows instead of the canonical Lisa repo versions.
   * Printed after the update summary so users see it as a post-update action item.
   * @param projectDir - The destination project directory to inspect
   */
  protected async printMigrationNotices(projectDir: string): Promise<void> {
    const ciPath = path.join(projectDir, ".github", "workflows", "ci.yml");
    const deployPath = path.join(
      projectDir,
      ".github",
      "workflows",
      "deploy.yml"
    );

    const [ciContent, deployContent] = await Promise.all([
      this.tryReadFile(ciPath),
      this.tryReadFile(deployPath),
    ]);

    const isRailsProject = this.detectedTypes.includes("rails");

    const notices = [
      ciContent?.includes("uses: ./.github/workflows/quality.yml") &&
      !isRailsProject
        ? "  .github/workflows/ci.yml — change:\n    uses: ./.github/workflows/quality.yml\n    → uses: CodySwannGT/lisa/.github/workflows/quality.yml@main"
        : null,
      ciContent?.includes("uses: ./.github/workflows/quality.yml") &&
      isRailsProject
        ? "  .github/workflows/ci.yml — change:\n    uses: ./.github/workflows/quality.yml\n    → uses: CodySwannGT/lisa/.github/workflows/quality-rails.yml@main"
        : null,
      deployContent?.includes("uses: ./.github/workflows/release.yml") &&
      !isRailsProject
        ? "  .github/workflows/deploy.yml — change:\n    uses: ./.github/workflows/release.yml\n    → uses: CodySwannGT/lisa/.github/workflows/release.yml@main"
        : null,
      deployContent?.includes("uses: ./.github/workflows/release.yml") &&
      isRailsProject
        ? "  .github/workflows/deploy.yml — change:\n    uses: ./.github/workflows/release.yml\n    → uses: CodySwannGT/lisa/.github/workflows/release-rails.yml@main"
        : null,
    ].filter((n): n is string => n !== null);

    if (notices.length === 0) {
      return;
    }

    console.log("");
    console.log(
      pc.yellow(
        "⚠️  Action required: Update your CI/Deploy workflows to call the Lisa repo directly."
      )
    );
    console.log("");
    console.log(notices.join("\n\n"));
    console.log("");
    console.log(
      "  Write `@main` as shown. The next `lisa apply` rewrites it to the commit"
    );
    console.log(
      "  your installed Lisa's version tag names and keeps it there, so this is a"
    );
    console.log(
      "  one-time edit and the ref is maintained for you from then on. Until that"
    );
    console.log(
      "  apply runs, `lisa doctor` will correctly report the ref as still mutable."
    );
    console.log("");
  }
}
