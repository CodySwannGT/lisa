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
import type {
  ReleasePin,
  ReusableWorkflowRef,
} from "../core/reusable-workflow-pin.js";
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
  | { readonly ok: false; readonly error: UnresolvableReleasePinError };

/** One workflow file whose content the pin changes. */
interface PlannedRewrite {
  /** Path relative to the project root. */
  readonly relative: string;
  /** Absolute path to write. */
  readonly absolute: string;
  /** The rewritten file content. */
  readonly source: string;
}

/** One caller left alone because this release cannot vouch for its callee. */
interface UnvouchedCaller {
  /** Path relative to the project root. */
  readonly relative: string;
  /** 1-based line the caller sits on. */
  readonly line: number;
  /** The Lisa reusable workflow it calls. */
  readonly workflow: string;
  /** The ref it keeps. */
  readonly ref: string;
}

/** Everything one pass over the project's workflow files decided. */
interface RewritePlan {
  /** Files to write, computed in full before any is written. */
  readonly changes: readonly PlannedRewrite[];
  /** Callers deliberately left on the ref they already had. */
  readonly unvouched: readonly UnvouchedCaller[];
}

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
 * has changed.
 *
 * ## What it refuses to do, and what it only reports
 *
 * A Lisa whose DECLARED release identity will not resolve is broken, and it
 * stops the apply wherever a caller is involved — installed in the project, or
 * about to arrive from the templates.
 *
 * A Lisa that declares NO release identity was never released: a working
 * checkout, or a template tree copied somewhere without its history. There is
 * no tag for a caller to name, so the apply continues and says so — refusing
 * would make every developer checkout unable to apply Lisa at all. The one
 * exception is a project that ALREADY calls a Lisa reusable workflow: leaving
 * an existing caller mutable while reporting a successful apply is the
 * fail-open shape this migration exists to remove, so that case still stops.
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
   * Whether the project already called a Lisa reusable workflow when this
   * apply started, or null when nobody looked before the strategies ran.
   *
   * Asked before the copy, because afterwards the answer is always yes: the
   * templates have just seeded callers, and "was already installed" and "was
   * seeded thirty seconds ago" are the two cases that need opposite answers
   * from an unreleased Lisa.
   */
  private hadCallersBefore: boolean | null = null;

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
   * @throws {UnresolvableReleasePinError} When a caller is involved and the pin will not resolve
   */
  async beforeStrategies(ctx: MigrationContext): Promise<void> {
    this.resolution = await this.resolve(ctx);
    this.hadCallersBefore = await containsCaller(ctx.projectDir);
    if (this.resolution.ok) return;
    const { error } = this.resolution;

    const fatal =
      error.reason === "malformed"
        ? await this.anyCallerReachable(ctx)
        : this.hadCallersBefore;
    if (fatal) throw error;

    if (await this.anyCallerReachable(ctx)) {
      // Said out loud rather than swallowed: this apply is about to seed
      // caller workflows that stay on a mutable ref, and the only reason that
      // is tolerable is that this Lisa is not a release. `lisa doctor` will
      // report those refs, so the gap is visible from two directions.
      ctx.logger.warn(
        `Lisa reusable-workflow refs left unpinned: ${error.message}`
      );
    }
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
    if (resolution.ok) {
      const plan = await this.plan(
        ctx.projectDir,
        resolution.pin,
        await vouchedCallees(ctx.lisaDir, [
          UNIVERSAL_LANE,
          ...ctx.detectedTypes,
        ])
      );
      return plan.changes.length > 0;
    }
    return this.isFatal(ctx, resolution.error);
  }

  /**
   * Rewrite every caller to the pin, or abort having written nothing.
   * @param ctx - Migration context
   * @returns Applied or no-op result
   * @throws {UnresolvableReleasePinError} When the installed version's tag resolves to no commit
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const resolution = await this.resolved(ctx);
    if (!resolution.ok) {
      if (this.isFatal(ctx, resolution.error)) throw resolution.error;
      return {
        name: this.name,
        action: "noop",
        message: `Lisa reusable-workflow refs left unpinned: ${resolution.error.message}`,
      };
    }
    const { pin } = resolution;

    // Every rewrite is computed before any is written. A partial rewrite would
    // leave one caller on the new release and another on the old one, which
    // reads as a finished migration and is not one.
    const { changes, unvouched } = await this.plan(
      ctx.projectDir,
      pin,
      await vouchedCallees(ctx.lisaDir, [UNIVERSAL_LANE, ...ctx.detectedTypes])
    );
    // Said once per apply, before anything is written. "This one stays where
    // it is, and here is why" is the whole remedy the reporting consumer
    // asked for: they had to revert one rewrite of five by hand, with nothing
    // in the output marking that one as different (CodySwannGT/lisa#4021).
    for (const caller of unvouched) {
      ctx.logger.warn(unvouchedMessage(caller, pin));
    }
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
   * Whether an unresolved pin must stop this apply rather than be reported.
   *
   * A DECLARED identity that will not resolve is a broken installation and
   * stops wherever a caller is involved. No declared identity at all is an
   * unreleased tree, which has no tag for a caller to name — it stops only
   * where continuing would leave a caller that was ALREADY there mutable
   * while the apply reported success.
   * @param ctx - Migration context
   * @param error - The resolution failure
   * @returns True when the apply must abort
   */
  private isFatal(
    ctx: MigrationContext,
    error: UnresolvableReleasePinError
  ): boolean {
    if (error.reason === "malformed") return true;
    // Null means nobody looked before the strategies ran — a direct call, or a
    // registry driven without the pre-strategy hook. Treating that as "there
    // were callers" is the conservative reading: it aborts rather than
    // reporting a skip nobody asked for.
    return this.hadCallersBefore ?? true;
  }

  /**
   * The rewrite to perform on every workflow file, and every caller skipped.
   * @param projectDir - Destination project directory
   * @param pin - The identity every caller must carry
   * @param vouched - Callee names this release carries; empty means unknown
   * @returns Files whose content changes, and callers left on their own ref
   */
  private async plan(
    projectDir: string,
    pin: ReleasePin,
    vouched: ReadonlySet<string>
  ): Promise<RewritePlan> {
    // An EMPTY vouched set means the templates could not be read, not that
    // this release ships no reusable workflows. Falling back to pinning
    // everything preserves today's behaviour rather than silently disabling
    // the pin, which would be a worse failure than the one this guard exists
    // to prevent.
    const shouldPin = (workflow: string): boolean =>
      vouched.size === 0 || vouched.has(workflow);
    const files = await workflowFiles(projectDir);
    const perFile = await Promise.all(
      files.map(async relative => {
        const absolute = path.join(projectDir, relative);
        const before = await readFile(absolute, "utf8").catch(() => null);
        return before === null
          ? EMPTY_PLAN
          : planFile({ relative, absolute, before, pin, shouldPin });
      })
    );
    return {
      changes: perFile.flatMap(entry => entry.changes),
      unvouched: perFile.flatMap(entry => entry.unvouched),
    };
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

/** What a file that contributes nothing to the plan returns. */
const EMPTY_PLAN: RewritePlan = { changes: [], unvouched: [] };

/**
 * Decide what one workflow file contributes to the plan.
 *
 * A file is rewritten when any caller this release WILL pin is not already at
 * the pin. Callers it will not pin are recorded instead — and recorded even
 * when the file needs no rewrite, because the reason a caller stays on the ref
 * it has is the sentence the consumer needs in order to write the right
 * comment beside it.
 * @param input - The file, its content, and what is being pinned
 * @param input.relative - Path relative to the project root
 * @param input.absolute - Absolute path to the workflow file
 * @param input.before - Current content of the file
 * @param input.pin - The identity every caller must carry
 * @param input.shouldPin - Whether a given callee basename may be pinned
 * @returns This file's contribution to the plan
 */
function planFile(input: {
  readonly relative: string;
  readonly absolute: string;
  readonly before: string;
  readonly pin: ReleasePin;
  readonly shouldPin: (workflow: string) => boolean;
}): RewritePlan {
  const { relative, absolute, before, pin, shouldPin } = input;
  const refs = findReusableWorkflowRefs(before);
  if (refs.length === 0) return EMPTY_PLAN;

  // Only references this release will actually pin count toward "already
  // settled". An unvouched reference is deliberately left mutable, so it is
  // never `isPinnedAt` — reading it as unsettled made this file report a
  // change on EVERY apply, rewriting byte-identical content and logging a pin
  // that did not happen. That is the exact idempotency the migration
  // otherwise guarantees.
  const settled = refs.every(
    reference => !shouldPin(reference.workflow) || isPinnedAt(reference, pin)
  );

  return {
    changes: settled
      ? []
      : [
          {
            relative,
            absolute,
            source: pinReusableWorkflowRefs(before, pin, shouldPin),
          },
        ],
    unvouched: refs
      .filter(reference => !shouldPin(reference.workflow))
      .map(reference => toUnvouched(relative, reference)),
  };
}

/**
 * Record one caller this release cannot vouch for.
 * @param relative - Path relative to the project root
 * @param reference - The caller reference found there
 * @returns The reportable record
 */
function toUnvouched(
  relative: string,
  reference: ReusableWorkflowRef
): UnvouchedCaller {
  return {
    relative,
    line: reference.line,
    workflow: reference.workflow,
    ref: reference.ref,
  };
}

/**
 * Say why one caller was left where it was, in the consumer's terms.
 * @param caller - The caller left alone
 * @param pin - The identity the rest of the project was pinned at
 * @returns An operator-readable statement
 */
function unvouchedMessage(caller: UnvouchedCaller, pin: ReleasePin): string {
  return (
    `${caller.relative}:${caller.line} calls ${caller.workflow}@${caller.ref} and stays on that ref: ` +
    `no caller template in the installed Lisa references ${caller.workflow}, so this release cannot ` +
    `confirm it exists at ${pin.sha} (v${pin.version}). Pinning it there could name a commit the workflow ` +
    "is absent from, and GitHub answers an unresolvable `uses:` with a load error — zero jobs created, so " +
    "zero failures, and nothing naming the missing file."
  );
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
 * The callee names Lisa's OWN shipped caller templates reference.
 * @remarks
 * This is the set this release can vouch for. A caller naming anything else —
 * typically a workflow that exists only on Lisa's `main`, adopted by a project
 * ahead of a release carrying it — must not be pinned: the pin would name a
 * commit where the file is absent, and an unresolvable reusable workflow is a
 * LOAD error that kills the job before a step runs, with nothing in the
 * consumer's own diff to explain it.
 *
 * Derived from the templates on disk rather than a hardcoded roster, because
 * the roster is exactly what changes between releases. The npm package does
 * not ship Lisa's own `.github/workflows/`, so the callee files cannot be
 * probed directly; the caller templates are the only offline witness to what a
 * given release provides.
 * @param lisaDir - Installed Lisa root
 * @param lanes - Universal lane plus the project's detected types
 * @returns Callee basenames, e.g. `quality.yml`
 */
export async function vouchedCallees(
  lisaDir: string,
  lanes: readonly string[]
): Promise<ReadonlySet<string>> {
  const roots = lanes.flatMap(lane =>
    TEMPLATE_MODES.map(mode => path.join(lisaDir, lane, mode))
  );
  const perRoot = await Promise.all(
    roots.map(async root => {
      const files = await workflowFiles(root);
      const perFile = await Promise.all(
        files.map(async relative => {
          const source = await readFile(
            path.join(root, relative),
            "utf8"
          ).catch(() => "");
          return findReusableWorkflowRefs(source).map(
            reference => reference.workflow
          );
        })
      );
      return perFile.flat();
    })
  );
  return new Set(perRoot.flat());
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
