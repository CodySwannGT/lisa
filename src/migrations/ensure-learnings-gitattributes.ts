import * as fse from "fs-extra";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { isLearningsMergeDriverEnabled } from "../core/learnings-merge-driver-config.js";
import { renderLearningsGitattributesBlock } from "../core/learnings-merge-driver.js";
import {
  readProjectConfig,
  resolveProjectLearningsFile,
} from "../core/project-config.js";
import { mergeCopyContents } from "../strategies/copy-contents.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const GITATTRIBUTES = ".gitattributes";

/**
 * Migration: bind the project's ACTUAL learnings ledger to the union merge
 * driver in `.gitattributes`.
 *
 * The copy-contents template ships the default `.lisa/PROJECT_LEARNINGS.md`
 * path, which is correct for most projects but silently wrong for any project
 * that relocates its ledger via the validated `learnings.file` override in
 * `.lisa.config.json`. A `.gitattributes` pointing at a path the project does
 * not use leaves the ledger on git's default text merge — the exact corruption
 * this campaign exists to remove — with nothing to indicate it.
 *
 * Running after the copy strategies, this resolves the ledger path through the
 * executable config resolver (never hardcoded) and rewrites the Lisa-managed
 * block. It uses the same guardrail-marker merge the template does, so every
 * host-authored attribute (LFS, linguist, eol) outside the block is preserved,
 * and it converges to the same content as the template whenever the project
 * uses the default path.
 */
export class EnsureLearningsGitattributesMigration implements Migration {
  readonly name = "ensure-learnings-gitattributes";
  readonly description =
    "Bind the project's configured learnings ledger path to the union merge driver in .gitattributes";

  /**
   * Applies whenever the managed block does not already match the resolved
   * ledger path.
   * @param ctx - Migration context
   * @returns True when there is work to do
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    const { current, next } = await this.resolveContent(ctx);
    return current !== next;
  }

  /**
   * Rewrite the Lisa-managed `.gitattributes` block for the resolved ledger.
   * @param ctx - Migration context
   * @returns Result describing the action taken
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const { current, next } = await this.resolveContent(ctx);
    if (current === next) {
      return { name: this.name, action: "noop" };
    }
    const message = `Bound the learnings ledger to the union merge driver in ${GITATTRIBUTES}`;
    if (ctx.dryRun) {
      ctx.logger.dry(`Would update ${GITATTRIBUTES} for the learnings ledger`);
      return {
        name: this.name,
        action: "applied",
        changedFiles: [GITATTRIBUTES],
        message,
      };
    }
    await writeFile(path.join(ctx.projectDir, GITATTRIBUTES), next, "utf8");
    ctx.logger.success(message);
    return {
      name: this.name,
      action: "applied",
      changedFiles: [GITATTRIBUTES],
      message,
    };
  }

  /**
   * Compute the current and intended `.gitattributes` contents.
   * @param ctx - Migration context
   * @returns Existing content and the content this migration would write
   */
  private async resolveContent(
    ctx: MigrationContext
  ): Promise<{ readonly current: string; readonly next: string }> {
    const target = path.join(ctx.projectDir, GITATTRIBUTES);
    const current = (await fse.pathExists(target))
      ? await readFile(target, "utf8")
      : "";
    // Honour the same opt-out as the driver registration: shipping an
    // attribute that binds the ledger to a driver the host declined would be
    // inert at best and confusing at worst.
    if (!(await isLearningsMergeDriverEnabled(ctx.projectDir))) {
      return { current, next: current };
    }
    const config = await readProjectConfig(ctx.projectDir);
    const block = renderLearningsGitattributesBlock(
      resolveProjectLearningsFile(config)
    );
    return {
      current,
      next: current === "" ? block : mergeCopyContents(block, current),
    };
  }
}
