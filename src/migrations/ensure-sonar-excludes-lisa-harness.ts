import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as fse from "fs-extra";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const SONAR_FILE = "sonar-project.properties";
const EXCLUSIONS_KEY = "sonar.exclusions";

/**
 * Glob patterns for the Lisa-generated multi-agent harness directories.
 *
 * `lisa apply` commits the full Codex/OpenCode/Copilot harness (hundreds of
 * generated .md/.toml/.sh/.py/.ts files) so marketplace-less agents work
 * in-repo. They are generated scaffolding, not project source, and must not be
 * analyzed by SonarCloud — otherwise the quality gate trips on generated code.
 */
const HARNESS_GLOBS: readonly string[] = [
  ".codex/**",
  ".opencode/**",
  ".agents/**",
];

/**
 * Parsed view of the project's `sonar.exclusions` line.
 */
interface SonarExclusionsState {
  /** Full file text, or null when sonar-project.properties does not exist. */
  readonly text: string | null;
  /** The exact `sonar.exclusions=...` line, or null when absent. */
  readonly line: string | null;
  /** Harness globs not yet present in the exclusions. */
  readonly missing: readonly string[];
}

/**
 * Migration: ensure the Lisa-generated harness directories are listed in
 * `sonar.exclusions` of `sonar-project.properties`.
 *
 * Only runs when the project actually ships a `sonar-project.properties`
 * (SonarCloud-using repos). Idempotent — appends only the harness globs that
 * are missing, preserving every existing exclusion. Single-line exclusions are
 * the supported (and Lisa-emitted) shape; a backslash-continued value is left
 * untouched to avoid corrupting a multi-line property.
 *
 * Mirrors the host-config reconciliation pattern of the other `ensure-*`
 * migrations. Uses node:fs/promises for the raw read/write because fs-extra's
 * fs-passthrough methods are undefined in the bundled dist.
 */
export class EnsureSonarExcludesLisaHarnessMigration implements Migration {
  readonly name = "ensure-sonar-excludes-lisa-harness";
  readonly description =
    "Add the Lisa-generated harness dirs (.codex/.opencode/.agents) to sonar.exclusions";

  /**
   * Read and parse the current sonar.exclusions state for the project.
   * @param projectDir - The destination project directory
   * @returns The file text, the matched exclusions line, and any missing globs
   */
  private async readState(projectDir: string): Promise<SonarExclusionsState> {
    const file = path.join(projectDir, SONAR_FILE);
    if (!(await fse.pathExists(file))) {
      return { text: null, line: null, missing: [] };
    }
    const text = await readFile(file, "utf8");
    const line =
      text
        .split("\n")
        .find(l => l.replace(/\s/g, "").startsWith(`${EXCLUSIONS_KEY}=`)) ??
      null;
    // A backslash-continued value spans multiple physical lines; leave it be.
    if (line !== null && line.trimEnd().endsWith("\\")) {
      return { text, line, missing: [] };
    }
    const current = line
      ? line
          .slice(line.indexOf("=") + 1)
          .split(",")
          .map(g => g.trim())
          .filter(Boolean)
      : [];
    const missing = HARNESS_GLOBS.filter(g => !current.includes(g));
    return { text, line, missing };
  }

  /**
   * Applies when a sonar-project.properties exists and is missing at least one
   * harness glob.
   * @param ctx - Migration context
   * @returns True when there is work to do
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    const { text, missing } = await this.readState(ctx.projectDir);
    return text !== null && missing.length > 0;
  }

  /**
   * Append the missing harness globs to sonar.exclusions (creating the line if
   * absent), preserving all existing exclusions.
   * @param ctx - Migration context
   * @returns Result describing the action taken
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const file = path.join(ctx.projectDir, SONAR_FILE);
    const { text, line, missing } = await this.readState(ctx.projectDir);
    if (text === null || missing.length === 0) {
      return { name: this.name, action: "noop" };
    }

    const base = text === "" || text.endsWith("\n") ? text : `${text}\n`;
    const updated =
      line === null
        ? `${base}${EXCLUSIONS_KEY}=${missing.join(",")}\n`
        : text.replace(
            line,
            `${line.trimEnd()}${line.trimEnd().endsWith("=") ? "" : ","}${missing.join(",")}`
          );

    const message = `Added ${missing.length} harness glob(s) to ${EXCLUSIONS_KEY} (${missing.join(", ")})`;
    if (ctx.dryRun) {
      ctx.logger.dry(`Would update ${EXCLUSIONS_KEY}: ${missing.join(", ")}`);
      return {
        name: this.name,
        action: "applied",
        changedFiles: [SONAR_FILE],
        message,
      };
    }

    await writeFile(file, updated);
    ctx.logger.success(message);
    return {
      name: this.name,
      action: "applied",
      changedFiles: [SONAR_FILE],
      message,
    };
  }
}
