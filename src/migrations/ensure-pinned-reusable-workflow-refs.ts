import { readFile, readdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

import {
  getPackageReleaseCommit,
  getPackageReleaseTag,
  getPackageVersion,
} from "../cli/version.js";
import type { ReleaseCalleeDependencies } from "../core/lisa-release-callees.js";
import {
  defaultReleaseCalleeDependencies,
  resolveReleaseCallees,
} from "../core/lisa-release-callees.js";
import type { ReleasePinDependencies } from "../core/lisa-release-pin.js";
import {
  UnresolvableReleasePinError,
  resolveReleasePin,
  resolveTagCommitFromGit,
} from "../core/lisa-release-pin.js";
import type {
  ReleaseCallees,
  ReleasePin,
  ReusableWorkflowRef,
} from "../core/reusable-workflow-pin.js";
import {
  findReusableWorkflowRefs,
  isCalleePresent,
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

/** One caller left alone because the release does not carry its callee. */
interface UnpinnableCaller {
  /** Path relative to the project root. */
  readonly relative: string;
  /** 1-based line the caller sits on. */
  readonly line: number;
  /** The Lisa reusable workflow it calls. */
  readonly workflow: string;
  /** The ref it keeps. */
  readonly ref: string;
}

/** Everything one pass over the project's workflows decided. */
interface RewritePlan {
  /** Files to write, computed in full before any is written. */
  readonly changes: readonly PlannedRewrite[];
  /** Callers deliberately not rewritten, and reported instead. */
  readonly unpinnable: readonly UnpinnableCaller[];
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
 * ## Why a caller can be left on `@main` on purpose
 *
 * Pinning assumes the release is a superset of what the consumer references,
 * and a reusable workflow that exists only on `main` breaks that: the caller
 * would be rewritten to a commit the file is not in. That is not a wrong pin,
 * it is an unloadable one — Actions resolves `uses:` before creating any job,
 * so the run has zero jobs, zero failures, and no message naming the missing
 * file. Such a caller is left exactly as it was and reported by name, because
 * "this stays on `@main` because no release carries it yet" is a fact the
 * consumer can act on and a silent rewrite is not (CodySwannGT/lisa#4021).
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

  /** Which reusable workflows the pinned release carries, once asked. */
  private callees: { value: ReleaseCallees } | null = null;

  /**
   * Create the migration.
   * @param deps - Pin resolution readers, injectable for deterministic tests
   * @param calleeDeps - Callee-inventory readers, injectable for the same reason
   */
  constructor(
    private readonly deps: ReleasePinDependencies = {
      readVersion: getPackageVersion,
      readStampedCommit: getPackageReleaseCommit,
      readStampedTag: getPackageReleaseTag,
      resolveTagCommit: resolveTagCommitFromGit,
    },
    private readonly calleeDeps: ReleaseCalleeDependencies = defaultReleaseCalleeDependencies
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
      const plan = await this.planned(ctx, resolution.pin);
      // An unpinnable caller keeps the migration applicable with nothing to
      // write. `apply` is the only place that says why a caller was left on a
      // mutable ref, and a silent skip is exactly the outcome the consumer
      // could not act on (CodySwannGT/lisa#4021).
      return plan.changes.length > 0 || plan.unpinnable.length > 0;
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
    const { changes, unpinnable } = await this.planned(ctx, pin);
    for (const caller of unpinnable) {
      ctx.logger.warn(unpinnableMessage(caller, pin));
    }

    if (changes.length === 0) {
      return {
        name: this.name,
        action: "noop",
        ...(unpinnable.length > 0 ? { message: skipSummary(unpinnable) } : {}),
      };
    }

    const changedFiles = changes.map(change => change.relative);
    const message = [
      `Pinned ${changedFiles.length} Lisa reusable-workflow caller file(s) at ${pin.sha} (v${pin.version})`,
      ...(unpinnable.length > 0 ? [skipSummary(unpinnable)] : []),
    ].join("; ");
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
   * @param ctx - Migration context
   * @param pin - The identity every caller must carry
   * @returns Files to write and callers left on their existing ref
   */
  private async planned(
    ctx: MigrationContext,
    pin: ReleasePin
  ): Promise<RewritePlan> {
    const callees = await this.resolvedCallees(ctx, pin);
    const files = await workflowFiles(ctx.projectDir);
    const perFile = await Promise.all(
      files.map(async relative => {
        const absolute = path.join(ctx.projectDir, relative);
        const before = await readFile(absolute, "utf8").catch(() => null);
        return before === null
          ? emptyPlan
          : planFile({ relative, absolute, before, pin, callees });
      })
    );
    return {
      changes: perFile.flatMap(entry => entry.changes),
      unpinnable: perFile.flatMap(entry => entry.unpinnable),
    };
  }

  /**
   * The callee inventory for this pin, resolved once per apply.
   *
   * Cached rather than re-read because `applies` and `apply` both need it and
   * the git fallback spawns a process; caching the null answer matters as much
   * as caching a set, since "nobody recorded it" is also a stable fact.
   * @param ctx - Migration context
   * @param pin - The identity every caller must carry
   * @returns The inventory, or null when neither source can answer
   */
  private async resolvedCallees(
    ctx: MigrationContext,
    pin: ReleasePin
  ): Promise<ReleaseCallees> {
    this.callees ??= {
      value: await resolveReleaseCallees(ctx.lisaDir, pin, this.calleeDeps),
    };
    return this.callees.value;
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

/** A file that contributes nothing to the plan. */
const emptyPlan: RewritePlan = { changes: [], unpinnable: [] };

/**
 * Decide what one workflow file contributes to the plan.
 *
 * A file is rewritten when any caller whose callee EXISTS is not already at
 * the pin. Callers whose callee is absent are reported instead — and they are
 * reported even when the file needs no rewrite, because the reason a caller
 * stays on `@main` is the sentence the consumer needs in order to write the
 * right comment next to it.
 * @param input - The file, its content, and what is being pinned
 * @param input.relative - Path relative to the project root
 * @param input.absolute - Absolute path to the workflow file
 * @param input.before - Current content of the file
 * @param input.pin - The identity every caller must carry
 * @param input.callees - The release's inventory, or null when it is unknown
 * @returns This file's contribution to the plan
 */
function planFile(input: {
  readonly relative: string;
  readonly absolute: string;
  readonly before: string;
  readonly pin: ReleasePin;
  readonly callees: ReleaseCallees;
}): RewritePlan {
  const { relative, absolute, before, pin, callees } = input;
  const refs = findReusableWorkflowRefs(before);
  if (refs.length === 0) return emptyPlan;

  const present = refs.filter(reference => isCalleePresent(reference, callees));
  const unpinnable = refs
    .filter(reference => !isCalleePresent(reference, callees))
    .map(reference => toUnpinnable(relative, reference));
  const needsWrite = present.some(reference => !isPinnedAt(reference, pin));

  return {
    changes: needsWrite
      ? [
          {
            relative,
            absolute,
            source: pinReusableWorkflowRefs(before, pin, callees),
          },
        ]
      : [],
    unpinnable,
  };
}

/**
 * Record one caller the release cannot carry.
 * @param relative - Path relative to the project root
 * @param reference - The caller reference found there
 * @returns The reportable record
 */
function toUnpinnable(
  relative: string,
  reference: ReusableWorkflowRef
): UnpinnableCaller {
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
function unpinnableMessage(caller: UnpinnableCaller, pin: ReleasePin): string {
  return (
    `${caller.relative}:${caller.line} calls ${caller.workflow}@${caller.ref} and stays on that ref: ` +
    `${caller.workflow} does not exist at ${pin.sha} (v${pin.version}), so no released Lisa carries it yet. ` +
    "Pinning it there would name a commit the workflow is absent from, and GitHub answers an unresolvable " +
    "`uses:` with a load error — zero jobs created, so zero failures, and nothing naming the missing file."
  );
}

/**
 * One line naming every caller the pin could not reach.
 * @param unpinnable - Callers left on their existing ref
 * @returns A summary for the migration result
 */
function skipSummary(unpinnable: readonly UnpinnableCaller[]): string {
  const named = unpinnable
    .map(caller => `${caller.workflow} (${caller.relative}:${caller.line})`)
    .join(", ");
  return `left ${unpinnable.length} caller(s) unpinned because no released Lisa carries the workflow: ${named}`;
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
