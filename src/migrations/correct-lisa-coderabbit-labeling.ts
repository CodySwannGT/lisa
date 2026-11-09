/**
 * Turn CodeRabbit's label auto-apply off in the `.coderabbit.yml` Lisa itself
 * wrote into hosts, while the bytes prove nobody has edited it.
 *
 * From 2026-02-11 to 2026-03-01 Lisa shipped `all/copy-overwrite/.coderabbit.yml`,
 * which ends with `auto_apply_labels: true` and has no `labeling_instructions`
 * allowlist, so the bot may apply any label — Lisa's `status:` lifecycle labels
 * included. When the template was retired, `.coderabbit.yml` went onto
 * `deletions.json`'s `keep` list, so no host copy was ever deleted or
 * corrected; a downstream host watched the bot re-add `status:ready` to
 * claimed issues within minutes of each claim (CodySwannGT/lisa#4633).
 *
 * Why rewrite rather than delete: deleting the file hands control to the
 * CodeRabbit organisation's settings, which may auto-apply labels too. The
 * rewrite flips the one setting and adds a comment saying why and how to opt
 * back in with an allowlist; every other byte stays.
 *
 * Why only a proven-unedited copy: a copy whose sha256 matches no version Lisa
 * shipped may hold the host's own work (the same proof
 * `core/retire-unmodified` uses, CRLF normalised). Those are left alone and the
 * `lisa doctor` check `CodeRabbit kept off Lisa's lifecycle labels?` reports
 * them instead.
 *
 * The file is a reviewed, checked-in declaration, so an install
 * (`postinstallSafe`) declines and reports rather than writing.
 * @module migrations/correct-lisa-coderabbit-labeling
 */
import { writeFile } from "node:fs/promises";
import * as path from "node:path";

import { SHIPPED_CODERABBIT_CONFIG_DIGESTS } from "../core/coderabbit-labeling.js";
import {
  isShippedVersion,
  readRegularFile,
  type RegularFileProof,
  stillProved,
} from "../core/retire-unmodified.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

/** The only file name Lisa ever shipped this config under. */
const CONFIG_FILE = ".coderabbit.yml";

/** The setting the shipped template turns on. */
const AUTO_APPLY_ON = /^( *)auto_apply_labels: true$/mu;

/** Comment placed above the corrected setting, one entry per line. */
const EXPLANATION: readonly string[] = [
  "Lisa turned this off (CodySwannGT/lisa#4633). With no allowlist CodeRabbit",
  "may apply any label, including Lisa's status: lifecycle labels,",
  "human-needed, and the type: and points: labels Lisa's issue writer sets.",
  "To keep auto-labelling, set this to true and add labeling_instructions",
  "listing only the labels the bot may apply.",
];

/** A planned correction. */
interface PlannedCorrection {
  readonly absolute: string;
  readonly source: string;
  /** The bytes and inode the "unedited" proof was computed over. */
  readonly proof: RegularFileProof;
}

/**
 * Re-checks, immediately before the write, that a path still holds exactly
 * the file a proof was computed over.
 */
export type ProofRecheck = (
  filePath: string,
  proof: RegularFileProof
) => Promise<boolean>;

/**
 * Rewrite the template's auto-apply line with the comment above it, keeping
 * the file's own line endings.
 * @param text - The shipped template's text
 * @returns The corrected text, or null when the line is not where expected
 */
function correct(text: string): string | null {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lf = text.replaceAll("\r\n", "\n");
  const match = AUTO_APPLY_ON.exec(lf);
  if (match === null) return null;
  const indent = match[1] ?? "";
  const replacement = [
    ...EXPLANATION.map(line => `${indent}# ${line}`),
    `${indent}auto_apply_labels: false`,
  ].join("\n");
  return lf.replace(AUTO_APPLY_ON, replacement).replaceAll("\n", eol);
}

/** Correct an unedited Lisa-written CodeRabbit config. */
export class CorrectLisaCoderabbitLabelingMigration implements Migration {
  readonly name = "correct-lisa-coderabbit-labeling";
  readonly description =
    "Turn off CodeRabbit label auto-apply in the unedited .coderabbit.yml Lisa shipped";

  /**
   * Build the migration.
   * @param recheck - Proof re-check run just before writing; injectable so a
   *   test can stand in for a file edited between the proof and the write
   */
  constructor(private readonly recheck: ProofRecheck = stillProved) {}

  /**
   * Applies when the host still holds the unedited template.
   * @param ctx - Migration context
   * @returns True when there is a copy to correct
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    return (await this.plan(ctx)) !== null;
  }

  /**
   * Correct the copy, or describe the correction under dry-run, or decline an
   * install.
   * @param ctx - Migration context
   * @returns Applied, skipped, or no-op result
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const planned = await this.plan(ctx);
    if (planned === null) return { name: this.name, action: "noop" };
    if (ctx.postinstallSafe === true) {
      const message =
        `Left ${CONFIG_FILE} unchanged: an install must not rewrite a ` +
        "checked-in file. It is the unedited CodeRabbit config Lisa shipped, " +
        "which lets the bot apply Lisa's lifecycle labels; run " +
        "`npx @codyswann/lisa@latest .` to turn its label auto-apply off.";
      ctx.logger.warn(message);
      return { name: this.name, action: "skipped", changedFiles: [], message };
    }
    const changedFiles = [CONFIG_FILE];
    const message = `Turned off CodeRabbit label auto-apply in ${CONFIG_FILE}, the unedited copy Lisa wrote`;
    if (ctx.dryRun) {
      ctx.logger.dry(`Would update ${CONFIG_FILE}`);
      return { name: this.name, action: "applied", changedFiles, message };
    }
    // The proof is about the bytes read when planning. A file edited or
    // swapped since then may now hold the host's work, so it is left alone.
    if (!(await this.recheck(planned.absolute, planned.proof))) {
      const changed = `Left ${CONFIG_FILE} unchanged: it changed after Lisa proved it unedited, so it may now hold this project's own work`;
      ctx.logger.warn(changed);
      return { name: this.name, action: "noop", message: changed };
    }
    await writeFile(planned.absolute, planned.source);
    ctx.logger.success(message);
    return { name: this.name, action: "applied", changedFiles, message };
  }

  /**
   * Work out the correction, if the host's copy is provably Lisa's.
   * @param ctx - Migration context
   * @returns The planned correction, or null when there is nothing to correct
   */
  private async plan(ctx: MigrationContext): Promise<PlannedCorrection | null> {
    const absolute = path.join(ctx.projectDir, CONFIG_FILE);
    const proof = await readRegularFile(absolute);
    if (proof === null) return null;
    if (!isShippedVersion(proof.bytes, SHIPPED_CODERABBIT_CONFIG_DIGESTS)) {
      return null;
    }
    const source = correct(proof.bytes.toString("utf8"));
    return source === null ? null : { absolute, source, proof };
  }
}
