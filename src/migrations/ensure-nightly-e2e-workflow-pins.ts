import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as fse from "fs-extra";
import { getPackageVersion } from "../cli/version.js";
import { ensureBodyChangeTrigger } from "../core/nightly-e2e-pull-request-triggers.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const WORKFLOW_DIR = path.join(".github", "workflows");
const WORKFLOW_FILES = [
  "nightly-e2e-health.yml",
  "nightly-e2e-report.yml",
] as const;
const CONTRACT_SCRIPT = path.join("scripts", "check-nightly-e2e-health.mjs");
const CONTRACT_PATTERN =
  /NIGHTLY_E2E_CONTRACT_VERSION\s*=\s*["'](\d+\.\d+\.\d+)["']/;

/** Read the installed Lisa package version. */
type VersionReader = () => string;

/**
 * Keep an installed nightly E2E caller's bypass gate armed against
 * body-evidence deletion, and its explanatory version comments current.
 *
 * This used to rewrite the caller's `uses:` ref as well. It no longer does:
 * `ensure-pinned-reusable-workflow-refs` pins EVERY Lisa reusable caller,
 * these two included, at the commit the installed version's tag names. Two
 * migrations rewriting the same line would each undo the other on every apply
 * — content-stable, endlessly "applied", and pinned at whichever ran last.
 *
 * The remaining job is here rather than in the template because of where the
 * file lives. The caller ships from `create-only` and is marked "this file is YOURS
 * — Lisa will not overwrite it", so a template fix reaches new adoptions only
 * and every already-seeded repository keeps its original trigger list forever.
 * The reusable workflow cannot carry the fix either: it is `on: workflow_call`,
 * and a reusable workflow cannot declare pull-request activity types. This
 * migration is the only surface that reaches the installed base (#3476, #3485).
 */
export class EnsureNightlyE2EWorkflowPinsMigration implements Migration {
  // The name outlived the pin arm. It is kept because it is the identity the
  // migration registry, its tests, and any apply receipt already record — a
  // rename would be a bigger change than the one that emptied it of meaning.
  readonly name = "ensure-nightly-e2e-workflow-pins";
  readonly description =
    "Keep the nightly E2E bypass gate armed against body-evidence deletion and its version comments current";

  /**
   * Create the migration.
   *
   * @param readLisaVersion - Version reader, injectable for deterministic tests
   */
  constructor(
    private readonly readLisaVersion: VersionReader = getPackageVersion
  ) {}

  /**
   * Decide whether an installed Expo caller still needs arming or refreshing.
   *
   * @param ctx - Migration context
   * @returns True when one supported caller needs a safe literal update
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    if (!ctx.detectedTypes.includes("expo")) return false;
    const contractVersion = await this.readContractVersion(ctx.projectDir);
    const lisaVersion = this.readLisaVersion();

    for (const file of WORKFLOW_FILES) {
      const absolute = path.join(ctx.projectDir, WORKFLOW_DIR, file);
      if (!(await fse.pathExists(absolute))) continue;
      const source = await readFile(absolute, "utf8");
      if (
        this.updateSource(source, file, lisaVersion, contractVersion) !== source
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Arm the bypass gate and refresh the caller's explanatory version comments.
   *
   * @param ctx - Migration context
   * @returns Applied or no-op result
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const lisaVersion = this.readLisaVersion();
    const contractVersion = await this.readContractVersion(ctx.projectDir);
    const changedFiles: string[] = [];
    const updates: Array<{ absolute: string; source: string }> = [];

    for (const file of WORKFLOW_FILES) {
      const relative = path.join(WORKFLOW_DIR, file);
      const absolute = path.join(ctx.projectDir, relative);
      if (!(await fse.pathExists(absolute))) continue;
      const before = await readFile(absolute, "utf8");
      const after = this.updateSource(
        before,
        file,
        lisaVersion,
        contractVersion
      );
      if (after === before) continue;
      changedFiles.push(relative);
      updates.push({ absolute, source: after });
    }

    if (changedFiles.length === 0) {
      return { name: this.name, action: "noop" };
    }

    const message = `Aligned nightly E2E callers with Lisa ${lisaVersion}`;
    if (ctx.dryRun) {
      ctx.logger.dry(`Would update ${changedFiles.join(", ")}`);
      return { name: this.name, action: "applied", changedFiles, message };
    }

    for (const update of updates) {
      await writeFile(update.absolute, update.source);
    }
    ctx.logger.success(message);
    return { name: this.name, action: "applied", changedFiles, message };
  }

  /**
   * Read the contract version shipped into the destination project.
   *
   * @param projectDir - Destination project directory
   * @returns Contract version, or null when the guard is absent or diverged
   */
  private async readContractVersion(
    projectDir: string
  ): Promise<string | null> {
    const file = path.join(projectDir, CONTRACT_SCRIPT);
    if (!(await fse.pathExists(file))) return null;
    return CONTRACT_PATTERN.exec(await readFile(file, "utf8"))?.[1] ?? null;
  }

  /**
   * Arm the bypass gate and refresh the caller's explanatory version comments.
   *
   * The `uses:` ref is deliberately not touched here — see the class note.
   *
   * @param source - Workflow source
   * @param file - Supported workflow filename
   * @param lisaVersion - Installed Lisa version
   * @param contractVersion - Guard contract version, when available
   * @returns Updated or original workflow source
   */
  private updateSource(
    source: string,
    file: (typeof WORKFLOW_FILES)[number],
    lisaVersion: string,
    contractVersion: string | null
  ): string {
    if (file !== "nightly-e2e-health.yml") return source;

    // Armed BEFORE the comment edits, and unconditionally. A consumer whose
    // comments are already current has nothing to refresh and would otherwise
    // never receive this, which is the entire installed base a month from now.
    const armed = ensureBodyChangeTrigger(source);
    const commentUpdated = armed.replace(
      /# v\d+\.\d+\.\d+ matches this repo's own installed Lisa/,
      `# v${lisaVersion} matches this repo's own installed Lisa`
    );
    return contractVersion
      ? commentUpdated.replace(
          /# the guard reports contract \d+\.\d+\.\d+ and the reusable asserts its MAJOR/,
          `# the guard reports contract ${contractVersion} and the reusable asserts its MAJOR`
        )
      : commentUpdated;
  }
}
