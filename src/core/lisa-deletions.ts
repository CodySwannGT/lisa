/**
 * @file lisa-deletions.ts
 * @description Manifest-driven deletions, gated by ownership and announced to the operator. One layer of the `Lisa` orchestrator; each layer
 * extends the one below it so the apply pipeline reads as one class while no
 * single module carries the whole pipeline.
 * @module core
 */
import * as fse from "fs-extra";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import type { DeletionsConfig } from "./config.js";
import {
  basisAuthorisesDeletion,
  resolveDeletionBasis,
} from "./deletion-basis.js";
import { findLocalWorkflowReferences } from "./workflow-reference-guard.js";
import {
  findHostReferences,
  isShippedVersion,
  readRegularFile,
  retiredDigests,
  stillProved,
} from "./retire-unmodified.js";
import {
  classifyWorkflowForDeletion,
  describeRefusal,
  isWorkflowDeletionPath,
} from "./workflow-deletion-ownership.js";
import { LisaTemplates } from "./lisa-templates.js";

/**
 * Manifest-driven deletions, gated by ownership and announced to the operator.
 */
export abstract class LisaDeletions extends LisaTemplates {
  /**
   * Pre-compute the set of paths marked for deletion across "all" and every
   * detected project type. This runs before strategy processing so the copy
   * strategies can skip creating files that are about to be deleted anyway.
   *
   * Motivating case: CDK inherits typescript/create-only, which ships
   * `jest.config.local.ts` + `jest.thresholds.json`. CDK's own `deletions.json`
   * then removes them. Without this gate, Lisa would create them and delete
   * them in the same apply, which causes ENOENT errors for any concurrent
   * file-watcher/linter that observed the briefly-existing files.
   *
   * The `keep` list in a deletions.json (e.g., expo keeps
   * `zap-baseline-expo.yml`) is honored — paths in `keep` are not treated as
   * pending-deletions, so they will still be created by upstream strategies.
   * @returns Promise that resolves once pending deletions have been collected
   */
  protected async loadPendingDeletions(): Promise<void> {
    const pending = new Set<string>();
    for (const type of ["all", ...this.detectedTypes]) {
      const paths = await this.readPendingDeletionsForType(type);
      for (const p of paths) {
        pending.add(path.normalize(p));
      }
    }
    this.pendingDeletions = pending;
  }

  /**
   * Read the set of paths a single type's deletions.json will delete,
   * filtered by the type's `keep` list. Returns an empty array when the file
   * is missing or malformed — a bad file cannot block strategy processing;
   * any validation errors are surfaced later by processDeletions itself.
   * @param type - Project type (e.g., "all", "cdk", "typescript")
   * @returns Array of relative paths marked for deletion
   */
  protected async readPendingDeletionsForType(
    type: string
  ): Promise<readonly string[]> {
    const deletionsPath = path.join(
      this.config.lisaDir,
      type,
      "deletions.json"
    );
    if (!(await fse.pathExists(deletionsPath))) {
      return [];
    }

    try {
      const content = await readFile(deletionsPath, "utf-8");
      const deletions: DeletionsConfig = JSON.parse(content);
      if (!Array.isArray(deletions.paths)) {
        return [];
      }
      const keepSet = new Set(deletions.keep ?? []);
      return deletions.paths.filter(p => !keepSet.has(p));
    } catch {
      return [];
    }
  }

  /**
   * Process deletions from deletions.json files
   */
  protected async processDeletions(): Promise<void> {
    const { logger } = this.deps;

    // Process deletions for "all" and each detected type
    const typesToProcess = ["all", ...this.detectedTypes];

    for (const type of typesToProcess) {
      const deletionsPath = path.join(
        this.config.lisaDir,
        type,
        "deletions.json"
      );

      if (await fse.pathExists(deletionsPath)) {
        logger.info(`Processing deletions for ${type}...`);
        await this.processDeletionsFile(deletionsPath);
      }
    }
  }

  /**
   * Process a single deletions.json file
   * @param deletionsPath - Path to the deletions.json file
   */
  protected async processDeletionsFile(deletionsPath: string): Promise<void> {
    const { logger } = this.deps;

    try {
      const content = await readFile(deletionsPath, "utf-8");
      const deletions: DeletionsConfig = JSON.parse(content);

      if (!Array.isArray(deletions.paths)) {
        logger.warn(`Invalid deletions.json format: paths must be an array`);
        return;
      }

      const keepSet = new Set(deletions.keep ?? []);

      for (const relativePath of deletions.paths) {
        if (keepSet.has(relativePath)) {
          logger.info(`Kept (protected): ${relativePath}`);
          continue;
        }
        // "I cannot tell" is a THIRD answer, and it has to be, or the uncertain
        // case gets silently resolved as one of the other two. A manifest that
        // does not say why a path may go does not authorise removing it: the
        // cheap error is keeping a file, because a path wrongly kept is visible
        // and fixable while a path wrongly deleted is gone from someone else's
        // repository with no undo (CodySwannGT/lisa#3700).
        //
        // This is the runtime fail-safe, and it is deliberately not the same
        // mechanism as the authoring check. That one refuses an unclassified
        // entry at commit time; this one protects a consumer whatever manifest
        // they happen to have, including one authored before either existed.
        const basis = resolveDeletionBasis(deletions, relativePath);
        if (!basisAuthorisesDeletion(basis)) {
          const notice = `Kept (no declared basis): ${relativePath} — the manifest lists this path but does not say why it may be removed, so it was not.`;
          logger.warn(notice);
          // Recorded, not merely logged. This is the fail-closed branch, and on
          // the install path a branch whose only account of itself goes to a
          // hidden stream is indistinguishable from one that never ran
          // (CodySwannGT/lisa#4071).
          this.deletionNotices.push(notice);
          this.counters.skipped++;
          continue;
        }
        await this.processSingleDeletion(
          relativePath,
          deletions.force?.[relativePath],
          retiredDigests(deletions, relativePath)
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to process deletions file: ${message}`);
    }
  }

  /**
   * Process a single deletion path
   * @param relativePath - Relative path to delete
   * @param forcedReason - Why this removal overrides the workflow ownership gate, when it does
   * @param shipped - Digests of every version Lisa shipped, when the manifest retires this path only while unmodified
   */
  protected async processSingleDeletion(
    relativePath: string,
    forcedReason?: string,
    shipped: ReadonlySet<string> | null = null
  ): Promise<void> {
    const { logger } = this.deps;
    const normalizedRelativePath = path.normalize(relativePath);
    if (
      this.projectLearningsTemplateRegistered &&
      normalizedRelativePath === this.projectLearningsFile
    ) {
      logger.info(`Kept (host-owned project learnings): ${relativePath}`);
      this.counters.skipped++;
      return;
    }
    const targetPath = path.join(this.config.destDir, relativePath);

    const resolvedTarget = path.resolve(targetPath);
    const resolvedDest = path.resolve(this.config.destDir);

    // Explicit guard: disallow deleting the project root itself
    if (resolvedTarget === resolvedDest) {
      logger.warn(
        `Skipping deletion of project root directory: ${relativePath || "."}`
      );
      return;
    }

    // Safety check: only allow paths strictly inside destDir
    if (!resolvedTarget.startsWith(resolvedDest + path.sep)) {
      logger.warn(
        `Skipping deletion outside project directory: ${relativePath}`
      );
      return;
    }

    if (this.ignorePatterns.shouldIgnore(relativePath)) {
      logger.info(`Kept ${this.lisaignoreSuffix}: ${relativePath}`);
      this.counters.ignored++;
      return;
    }

    if (!(await fse.pathExists(targetPath))) {
      return;
    }

    const referencing = await findLocalWorkflowReferences(
      this.config.destDir,
      relativePath
    );
    if (referencing.length > 0) {
      logger.warn(
        `Kept (still called locally by ${referencing.join(", ")}): ${relativePath}`
      );
      this.counters.skipped++;
      return;
    }

    await this.deleteIfOwned(targetPath, relativePath, forcedReason, shipped);
  }

  /**
   * Apply the ownership proof a deletion needs, then delete.
   *
   * A path the manifest retires only while unmodified is proved by its bytes
   * (`mayRetireUnmodified`); every other path keeps the workflow ownership
   * gate. A `force` reason outranks both, as it always has.
   * @param targetPath - Absolute path to remove
   * @param relativePath - Repo-relative path, as the manifest spelled it
   * @param forcedReason - Why this removal overrides the ownership gate, when it does
   * @param shipped - Digests of every version Lisa shipped, when retired only while unmodified
   */
  protected async deleteIfOwned(
    targetPath: string,
    relativePath: string,
    forcedReason: string | undefined,
    shipped: ReadonlySet<string> | null
  ): Promise<void> {
    const retiring = forcedReason === undefined && shipped !== null;
    const allowed = retiring
      ? await this.mayRetireUnmodified(targetPath, relativePath, shipped)
      : await this.mayDeleteWorkflow(targetPath, relativePath, forcedReason);
    if (!allowed) return;
    await this.performDeletion(
      targetPath,
      relativePath,
      retiring ? "an unedited copy of a file Lisa retired" : forcedReason
    );
  }

  /**
   * Decide whether a path the manifest retires only while unmodified may go.
   *
   * The proof is the file's own bytes: a copy equal to a version Lisa shipped
   * holds nothing of the consumer's, whatever ownership header it carries —
   * see `core/retire-unmodified`. That proof stands in for the workflow
   * ownership gate, which would otherwise refuse every create-only seed. It
   * does not stand in for "nothing calls it", so a path the consumer's own
   * scripts or workflows still name is kept too.
   *
   * Every refusal is recorded as a notice, because a retired file left in
   * place is the consumer's to remove and they can only do that if told.
   * @param targetPath - Absolute path of the file on disk
   * @param relativePath - Repo-relative path the manifest named
   * @param shipped - Digests of every version Lisa shipped at this path
   * @returns Whether the deletion may proceed
   */
  protected async mayRetireUnmodified(
    targetPath: string,
    relativePath: string,
    shipped: ReadonlySet<string>
  ): Promise<boolean> {
    const keep = (reason: string): false => {
      const notice = `Kept ${relativePath} — ${reason}`;
      this.deps.logger.warn(notice);
      this.deletionNotices.push(notice);
      this.counters.skipped++;
      return false;
    };
    const proof = await readRegularFile(targetPath);
    if (proof === null) {
      return keep(
        "Lisa retired this path, but it is not a readable file here, so Lisa cannot prove it is the copy Lisa shipped. Remove it yourself if you no longer use it."
      );
    }
    if (!isShippedVersion(proof.bytes, shipped)) {
      return keep(
        "Lisa retired this file, but your copy differs from every version Lisa shipped, so it may hold your changes. Delete it yourself once you no longer need it."
      );
    }
    const references = await findHostReferences(
      this.config.destDir,
      relativePath
    );
    if (references === null) {
      return keep(
        "Lisa retired this file, but could not read your package.json or workflows to check that nothing still uses it. Delete it yourself once you have checked."
      );
    }
    if (references.length > 0) {
      return keep(
        `Lisa retired this file, but ${references.join(", ")} still names it. Remove that reference, then delete the file.`
      );
    }
    // The proof is re-checked last, immediately before removal: a file
    // replaced or edited while references were read is not the one proved.
    if (!(await stillProved(targetPath, proof))) {
      return keep(
        "Lisa retired this file, but it changed while Lisa was checking it, so it was left in place. Re-run lisa apply, or delete it yourself."
      );
    }
    return true;
  }

  /**
   * Remove a path every guard has cleared, and say so.
   *
   * The announcement is not incidental to the removal — under
   * CodySwannGT/lisa#3656 it is half the fix, so it is emitted on the same
   * statement path that does the deleting and cannot be skipped while the
   * removal still happens.
   * @param targetPath - Absolute path to remove
   * @param relativePath - Repo-relative path, as the manifest spelled it
   * @param forcedReason - Why this removal overrode the ownership gate, when it did
   */
  protected async performDeletion(
    targetPath: string,
    relativePath: string,
    forcedReason: string | undefined
  ): Promise<void> {
    const { logger } = this.deps;
    const verb = this.config.dryRun ? "Would delete" : "Deleted";
    const because = forcedReason === undefined ? "" : ` — ${forcedReason}`;
    const notice = `${verb}: ${relativePath}${because}`;
    if (this.config.dryRun) {
      logger.dry(notice);
    } else {
      await fse.remove(targetPath);
      logger.success(notice);
    }
    this.counters.deleted++;
    this.deletionNotices.push(notice);
    this.deletedPaths.push(relativePath);
  }

  /**
   * Decide whether a `.github/workflows/` deletion target is Lisa's to remove.
   *
   * A deletions manifest names paths, never bytes, so on its own it cannot tell
   * a retired Lisa workflow from an unrelated file a consumer authored at the
   * same path. The file's own ownership header can, and every workflow Lisa
   * ships carries one — see `core/workflow-deletion-ownership` for why that
   * header is the signal and the hash ledger is not.
   *
   * Unreadable is treated as unattributable rather than as an error: a
   * directory, a permissions failure, or bytes that are not text all mean Lisa
   * has no proof, and the safe response to no proof is to leave it alone.
   *
   * A manifest may override the gate per path by giving a reason in its
   * `force` map. That exists because two workflow removals already shipped on
   * owner rulings against files that were actively harmful (#3590, #3599), and
   * those have to reach an edited copy too. The override does not buy silence:
   * a forced removal is announced with its reason attached, which is more than
   * the unforced path used to manage.
   * @param targetPath - Absolute path of the file on disk
   * @param relativePath - Repo-relative path the manifest named
   * @param forcedReason - Why this removal overrides the gate, when it does
   * @returns Whether the deletion may proceed
   */
  protected async mayDeleteWorkflow(
    targetPath: string,
    relativePath: string,
    forcedReason: string | undefined
  ): Promise<boolean> {
    if (!isWorkflowDeletionPath(relativePath) || forcedReason !== undefined) {
      return true;
    }

    const contents = await this.tryReadFile(targetPath);
    const verdict =
      contents === null
        ? ({ kind: "unattributable" } as const)
        : classifyWorkflowForDeletion(contents);
    if (verdict.kind === "lisa-managed") {
      return true;
    }

    const notice = `Kept ${relativePath} — ${describeRefusal(verdict)}.`;
    this.deps.logger.warn(notice);
    this.deletionNotices.push(notice);
    this.counters.skipped++;
    return false;
  }
}
