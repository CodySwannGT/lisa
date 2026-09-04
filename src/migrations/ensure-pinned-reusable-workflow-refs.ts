import { readFile, readdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

import {
  getPackageReleaseCommit,
  getPackageReleaseTag,
  getPackageVersion,
} from "../cli/version.js";
import type { ReleasePinDependencies } from "../core/lisa-release-pin.js";
import {
  UnresolvableReleasePinError,
  resolveReleasePin,
  resolveTagCommitFromGit,
} from "../core/lisa-release-pin.js";
import type { ReleasePin } from "../core/reusable-workflow-pin.js";
import {
  findReusableWorkflowRefs,
  isPinnedAt,
  pinReusableWorkflowRefs,
} from "../core/reusable-workflow-pin.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const WORKFLOW_DIR = path.join(".github", "workflows");

/** Template lanes whose caller workflows this project could receive. */
const UNIVERSAL_LANE = "all";

/** Copy modes a stack lane ships caller templates under. */
const TEMPLATE_MODES = ["create-only", "copy-overwrite"] as const;

/** Outcome of resolving the pin, deferred so a failure can abort before writes. */
type Resolution =
  | { readonly ok: true; readonly pin: ReleasePin }
  | { readonly ok: false; readonly error: Error };

/**
 * Pin every Lisa reusable-workflow caller in a project at the commit the
 * installed version's tag names, and keep it pinned as that version moves.
 *
 * ## Why this is a migration and not a template change
 *
 * A template cannot carry the answer. The SHA a caller must name is the commit
 * of a tag that does not exist yet when the template is authored, so the
 * shipped templates track `@main` and this migration rewrites what was copied.
 * That also makes one mechanism cover three cases that would otherwise need
 * three: a fresh install (templates land, then get pinned), an already
 * installed project still on `@main` (rewritten on its next apply — "fixed
 * upstream" is not "a bump brings it", and every caller workflow is
 * create-only, so nothing else would ever reach them), and a version change
 * (repinned in the same pass that rewrites the package pin).
 *
 * ## Why it resolves before any file is written
 *
 * The abort has to leave the working tree untouched, and by the time
 * migrations run the copy strategies have already written. So the resolution
 * happens in `beforeStrategies`, which runs first: an installed Lisa that
 * cannot name its own release commit stops the apply there, before anything
 * has changed. A project with no caller workflows anywhere — neither installed
 * nor about to be — is not held to that, because there is nothing to pin and
 * so nothing to be wrong about.
 *
 * ## Why it declines nothing in postinstall-safe mode
 *
 * The version change IS the postinstall moment. A pin that only moved when an
 * operator happened to run a full apply would spend most of its life naming a
 * release the project no longer has installed, which is the staleness this
 * whole change exists to prevent.
 */
export class EnsurePinnedReusableWorkflowRefsMigration implements Migration {
  readonly name = "ensure-pinned-reusable-workflow-refs";
  readonly description =
    "Pin every Lisa reusable-workflow caller at the commit the installed version's tag names";

  /** Resolution captured before the strategies ran, when they ran at all. */
  private resolution: Resolution | null = null;

  /**
   * Create the migration.
   * @param deps - Pin resolution readers, injectable for deterministic tests
   */
  constructor(
    private readonly deps: ReleasePinDependencies = {
      readVersion: getPackageVersion,
      readStampedCommit: getPackageReleaseCommit,
      readStampedTag: getPackageReleaseTag,
      resolveTagCommit: resolveTagCommitFromGit,
    }
  ) {}

  /**
   * Resolve the pin before any strategy writes, and abort here if it cannot be.
   * @param ctx - Migration context
   */
  async beforeStrategies(ctx: MigrationContext): Promise<void> {
    this.resolution = await this.resolve(ctx);
    if (this.resolution.ok) return;
    if (!(await this.anyCallerReachable(ctx))) return;
    throw this.resolution.error;
  }

  /**
   * Whether any caller in this project still needs rewriting.
   *
   * The caller check comes FIRST, and deliberately. A project with no Lisa
   * reusable callers has nothing to pin, so an installation that cannot name
   * its release commit is not a problem it has — declining here is what keeps
   * an unreleased checkout able to apply Lisa to such a project at all. Once a
   * caller does exist, an unresolved pin returns true so `apply` can abort
   * loudly rather than reporting a skip that reads like conformance.
   * @param ctx - Migration context
   * @returns True when at least one reference is not already at the pin
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    if (!(await containsCaller(ctx.projectDir))) return false;
    const resolution = await this.resolved(ctx);
    if (!resolution.ok) return true;
    const changes = await this.plan(ctx.projectDir, resolution.pin);
    return changes.length > 0;
  }

  /**
   * Rewrite every caller to the pin, or abort having written nothing.
   * @param ctx - Migration context
   * @returns Applied or no-op result
   * @throws {UnresolvableReleasePinError} When the installed version's tag resolves to no commit
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const resolution = await this.resolved(ctx);
    if (!resolution.ok) throw resolution.error;
    const { pin } = resolution;

    // Every rewrite is computed before any is written. A partial rewrite would
    // leave one caller on the new release and another on the old one, which
    // reads as a finished migration and is not one.
    const changes = await this.plan(ctx.projectDir, pin);
    if (changes.length === 0) {
      return { name: this.name, action: "noop" };
    }

    const changedFiles = changes.map(change => change.relative);
    const message = `Pinned ${changedFiles.length} Lisa reusable-workflow caller file(s) at ${pin.sha} (v${pin.version})`;
    if (ctx.dryRun) {
      ctx.logger.dry(`Would update ${changedFiles.join(", ")}`);
      return { name: this.name, action: "applied", changedFiles, message };
    }

    for (const change of changes) {
      await writeFile(change.absolute, change.source);
    }
    ctx.logger.success(message);
    return { name: this.name, action: "applied", changedFiles, message };
  }

  /**
   * The rewrite to perform on every workflow file that needs one.
   * @param projectDir - Destination project directory
   * @param pin - The identity every caller must carry
   * @returns One entry per file whose content changes
   */
  private async plan(
    projectDir: string,
    pin: ReleasePin
  ): Promise<
    readonly { relative: string; absolute: string; source: string }[]
  > {
    const files = await workflowFiles(projectDir);
    const planned = await Promise.all(
      files.map(async relative => {
        const absolute = path.join(projectDir, relative);
        const before = await readFile(absolute, "utf8").catch(() => null);
        if (before === null) return [];
        const refs = findReusableWorkflowRefs(before);
        if (refs.length === 0) return [];
        if (refs.every(reference => isPinnedAt(reference, pin))) return [];
        return [
          { relative, absolute, source: pinReusableWorkflowRefs(before, pin) },
        ];
      })
    );
    return planned.flat();
  }

  /**
   * The resolution captured in `beforeStrategies`, resolving now if it was not.
   *
   * `runAll` can be invoked without the pre-strategy hook — a caller that only
   * wants migrations, and every unit test of this class. Resolving lazily there
   * keeps both paths honest rather than silently treating "never asked" as "no
   * pin needed".
   * @param ctx - Migration context
   * @returns The resolution
   */
  private async resolved(ctx: MigrationContext): Promise<Resolution> {
    this.resolution ??= await this.resolve(ctx);
    return this.resolution;
  }

  /**
   * Attempt resolution, capturing the failure rather than throwing it.
   * @param ctx - Migration context
   * @returns The pin, or the error explaining why there is none
   */
  private async resolve(ctx: MigrationContext): Promise<Resolution> {
    try {
      return { ok: true, pin: await resolveReleasePin(ctx.lisaDir, this.deps) };
    } catch (error) {
      if (error instanceof UnresolvableReleasePinError) {
        return { ok: false, error };
      }
      throw error;
    }
  }

  /**
   * Whether this apply could put a Lisa reusable-workflow caller in the project.
   *
   * Both halves matter. The project's own workflows cover an existing install;
   * the templates about to be copied cover a fresh one, where the project has
   * no workflows yet and the callers arrive minutes later.
   * @param ctx - Migration context
   * @returns True when a caller exists or is about to
   */
  private async anyCallerReachable(ctx: MigrationContext): Promise<boolean> {
    if (await containsCaller(ctx.projectDir)) return true;
    const lanes = [UNIVERSAL_LANE, ...ctx.detectedTypes];
    for (const lane of lanes) {
      for (const mode of TEMPLATE_MODES) {
        if (await containsCaller(path.join(ctx.lisaDir, lane, mode))) {
          return true;
        }
      }
    }
    return false;
  }
}

/**
 * Workflow file paths under a root's `.github/workflows`, relative to the root.
 * @param root - Directory holding a `.github/workflows` directory
 * @returns Relative paths, empty when the directory is absent
 */
async function workflowFiles(root: string): Promise<readonly string[]> {
  const dir = path.join(root, WORKFLOW_DIR);
  const entries = await readdir(dir).catch(() => undefined);
  if (entries === undefined) return [];
  return entries
    .filter(name => /\.ya?ml$/u.test(name))
    .map(name => path.join(WORKFLOW_DIR, name));
}

/**
 * Whether any workflow file under a root calls a Lisa reusable workflow.
 * @param root - Directory holding a `.github/workflows` directory
 * @returns True when at least one caller reference is present
 */
async function containsCaller(root: string): Promise<boolean> {
  const files = await workflowFiles(root);
  for (const relative of files) {
    const source = await readFile(path.join(root, relative), "utf8").catch(
      () => ""
    );
    if (findReusableWorkflowRefs(source).length > 0) return true;
  }
  return false;
}
