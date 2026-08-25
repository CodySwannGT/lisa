import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as fse from "fs-extra";
import { getPackageVersion } from "../cli/version.js";
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

/** Keep an installed nightly E2E caller on the same immutable Lisa release. */
export class EnsureNightlyE2EWorkflowPinsMigration implements Migration {
  readonly name = "ensure-nightly-e2e-workflow-pins";
  readonly description =
    "Align nightly E2E reusable-workflow pins with installed Lisa";

  /**
   * Create the migration.
   *
   * @param readLisaVersion - Version reader, injectable for deterministic tests
   */
  constructor(
    private readonly readLisaVersion: VersionReader = getPackageVersion
  ) {}

  /**
   * Decide whether an Expo caller still points at another Lisa release.
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
   * Update only Lisa's literal semver caller pins and their matching comment.
   *
   * A host that deliberately uses a branch, SHA, or different workflow path is
   * left untouched because Lisa cannot infer that host's release policy.
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
   * Update a supported caller without touching host-selected non-semver refs.
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
    const reusable = file.replace(/\.yml$/, "");
    const pinPattern = new RegExp(
      `(uses:\\s*CodySwannGT/lisa/\\.github/workflows/${reusable}\\.yml@)v\\d+\\.\\d+\\.\\d+`,
      "g"
    );
    const pinUpdated = source.replace(pinPattern, `$1v${lisaVersion}`);
    const pinChanged = pinUpdated !== source;

    if (file === "nightly-e2e-health.yml" && pinChanged) {
      const commentUpdated = pinUpdated.replace(
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

    return pinUpdated;
  }
}
