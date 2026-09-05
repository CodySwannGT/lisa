/**
 * Repair an already-seeded `deploy.yml` whose deploy job goes SILENT when its
 * release fails (CodySwannGT/lisa#3740).
 *
 * ## Why a migration and not a template fix
 *
 * #3467 found a deploy job that was SKIPPED rather than failed when its release
 * failed. GitHub renders a skipped job as neutral and counts a skipped required
 * check as satisfied, so the deploy that never happened left no signal
 * anywhere: release commit present, versions matching, every status green. A
 * consuming repository ran eight days that way.
 *
 * #3738 fixed the templates. Those templates are `create-only` — Lisa seeds
 * `deploy.yml` once and never overwrites it, because the host owns that file —
 * so the fix reaches new adoptions and reaches nothing that already exists,
 * which is precisely where the defect is live. `copy-overwrite` would clobber
 * host customizations, and no reusable workflow can force a caller's job to
 * run. A migration is the surface that reaches the installed base, exactly as
 * `ensure-nightly-e2e-workflow-pins` does for the same `create-only` wall
 * (#3476, #3485).
 *
 * ## What it will and will not touch
 *
 * It repairs a deploy job only when it can do BOTH halves: suppress the
 * implicit `success()` so the job runs on a failed release, and insert the
 * guard step that then fails it loudly. Half of that repair would be worse than
 * the defect — a deploy job that runs on a failed release with nothing checking
 * the release result would try to ship.
 *
 * It declines, leaving the doctor finding to report the file, when:
 *
 * - the run is `postinstallSafe`. Nobody types `bun install` meaning to rewrite
 *   a reviewed, checked-in workflow, and the interface says so outright;
 * - the condition needs a rewrite this cannot make without guessing;
 * - the file's shape cannot be located unambiguously;
 * - the edited file does not parse, or does not come back repaired.
 *
 * The guard body is lifted from Lisa's own shipped template rather than
 * reproduced here, so the copy a test keeps identical across the templates is
 * the copy a host receives.
 * @module migrations/ensure-deploy-outcome-guard
 */
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

import {
  type DependenceJob,
  deployJobsSkippedByFailedRelease,
  releaseDependence,
} from "../core/deploy-release-dependence.js";
import {
  type ParsedWorkflow,
  parseRepositoryWorkflows,
} from "../cli/doctor-readiness-workflows.js";
import { isJsonObject } from "../sync/json-path.js";
import { loadYaml } from "../utils/yaml.js";
import {
  GUARD_STEP_NAME,
  rewrittenCondition,
} from "./deploy-outcome-guard-edit.js";
import {
  applyGuardEdits,
  extractGuardStep,
} from "./deploy-outcome-guard-yaml.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

/**
 * The shipped template the guard step is read out of.
 *
 * The rails one specifically: its guard names the environment as
 * `github.ref_name`, which resolves in any repository, while the expo copy
 * reads an output only that workflow's job graph publishes. The `run:` body is
 * identical in both — a test asserts it — so this choice is about the `env:`
 * block travelling safely, not about the words an operator reads.
 */
const GUARD_TEMPLATE = path.join(
  "rails",
  "create-only",
  ".github",
  "workflows",
  "deploy.yml"
);

/** The release job id the shipped template's guard step refers to. */
const TEMPLATE_RELEASE_JOB = "release";

/** One host workflow this migration is prepared to rewrite. */
interface PlannedEdit {
  /** Repo-relative workflow path. */
  readonly relative: string;
  /** Absolute path to write. */
  readonly absolute: string;
  /** The repaired source. */
  readonly source: string;
  /** The deploy jobs repaired in it. */
  readonly jobs: readonly string[];
}

/**
 * Re-read one job out of an edited workflow source.
 * @param source - The edited workflow source
 * @param jobId - The job to read back
 * @returns The job's condition and first step name, or null when unreadable
 */
function readBackJob(
  source: string,
  jobId: string
): { readonly ifCondition: string; readonly firstStep: string } | null {
  try {
    const document: unknown = loadYaml(source);
    if (!isJsonObject(document) || !isJsonObject(document.jobs)) return null;
    const job = document.jobs[jobId];
    if (!isJsonObject(job)) return null;
    const steps = Array.isArray(job.steps) ? job.steps : [];
    const first: unknown = steps[0];
    return {
      ifCondition: typeof job.if === "string" ? job.if : "",
      firstStep:
        isJsonObject(first) && typeof first.name === "string" ? first.name : "",
    };
  } catch {
    return null;
  }
}

/**
 * Whether an edited source really repaired the job it claims to have repaired.
 *
 * The post-condition, not a formality: a mis-indented insertion produces a file
 * that still parses and still skips, and writing that would replace a reported
 * defect with an unreported one.
 * @param source - The edited workflow source
 * @param job - The job as originally parsed
 * @param release - The upstream release job's id
 * @returns True when the job now survives a failed release and carries the guard
 */
function repairHolds(
  source: string,
  job: DependenceJob,
  release: string
): boolean {
  const readBack = readBackJob(source, job.id);
  if (readBack === null) return false;
  if (readBack.firstStep !== GUARD_STEP_NAME) return false;
  return (
    releaseDependence({ ...job, ifCondition: readBack.ifCondition }, release)
      .kind === "independent"
  );
}

/**
 * Turn one parsed job into the shape the dependence analysis reads.
 * @param job - The parsed workflow job
 * @returns The analysis input
 */
function asDependenceJob(job: ParsedWorkflow["jobs"][number]): DependenceJob {
  return {
    id: job.id,
    name: job.name,
    needs: job.needs,
    ifCondition: job.ifCondition,
    environment: job.environment,
  };
}

/**
 * Repair every repairable deploy job in one workflow's source.
 * @param source - The host workflow's source
 * @param workflow - The parsed workflow
 * @param guardStep - The guard step's lines, de-indented to column zero
 * @returns The repaired source and the jobs repaired, or null when none were
 */
function repairWorkflow(
  source: string,
  workflow: ParsedWorkflow,
  guardStep: readonly string[]
): { readonly source: string; readonly jobs: readonly string[] } | null {
  const found = deployJobsSkippedByFailedRelease(
    workflow.jobs.map(asDependenceJob)
  );
  const repaired = found.reduce<{
    readonly source: string;
    readonly jobs: readonly string[];
  }>(
    (carried, entry) => {
      const condition = rewrittenCondition(entry.job, entry.release);
      if (condition === null) return carried;
      const guard = guardStep.map(line =>
        line.replaceAll(
          `needs.${TEMPLATE_RELEASE_JOB}.result`,
          `needs.${entry.release}.result`
        )
      );
      const edited = applyGuardEdits(
        carried.source,
        entry.job.id,
        condition,
        guard
      );
      if (edited === null || !repairHolds(edited, entry.job, entry.release)) {
        return carried;
      }
      return { source: edited, jobs: [...carried.jobs, entry.job.id] };
    },
    { source, jobs: [] }
  );
  return repaired.jobs.length === 0 ? null : repaired;
}

/**
 * Bring an already-seeded deploy workflow up to the #3467 outcome contract.
 */
export class EnsureDeployOutcomeGuardMigration implements Migration {
  readonly name = "ensure-deploy-outcome-guard";
  readonly description =
    "Make an already-seeded deploy job fail loudly instead of skipping silently when its release does not succeed";

  /**
   * Whether any host deploy workflow can be repaired.
   * @param ctx - Migration context
   * @returns True when at least one workflow would change
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    return (await this.plan(ctx)).length > 0;
  }

  /**
   * Rewrite every repairable deploy workflow.
   * @param ctx - Migration context
   * @returns Applied or no-op result
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const edits = await this.plan(ctx);
    if (edits.length === 0) {
      return { name: this.name, action: "noop" };
    }
    const changedFiles = edits.map(edit => edit.relative);
    const message =
      `Made ${edits.flatMap(edit => edit.jobs).length} deploy job(s) fail ` +
      "loudly instead of skipping silently when the release does not succeed";
    if (ctx.dryRun) {
      ctx.logger.dry(`Would update ${changedFiles.join(", ")}`);
      return { name: this.name, action: "applied", changedFiles, message };
    }
    for (const edit of edits) {
      await writeFile(edit.absolute, edit.source);
    }
    ctx.logger.success(message);
    return { name: this.name, action: "applied", changedFiles, message };
  }

  /**
   * Work out which host workflows this run would rewrite.
   * @param ctx - Migration context
   * @returns One entry per workflow that can be repaired
   */
  private async plan(ctx: MigrationContext): Promise<readonly PlannedEdit[]> {
    // A dependency install is not somebody asking for a reviewed workflow to be
    // rewritten. The doctor finding reports these instead.
    if (ctx.postinstallSafe === true) return [];
    const guardStep = await this.readGuardStep(ctx.lisaDir);
    if (guardStep === null) return [];
    const workflows = await parseRepositoryWorkflows(ctx.projectDir);
    const planned = await Promise.all(
      workflows.map(
        async workflow => await this.planOne(ctx, workflow, guardStep)
      )
    );
    return planned.filter((edit): edit is PlannedEdit => edit !== null);
  }

  /**
   * Plan the repair of one workflow.
   * @param ctx - Migration context
   * @param workflow - The parsed workflow
   * @param guardStep - The guard step's lines
   * @returns The planned edit, or null when nothing here can be repaired
   */
  private async planOne(
    ctx: MigrationContext,
    workflow: ParsedWorkflow,
    guardStep: readonly string[]
  ): Promise<PlannedEdit | null> {
    const absolute = path.join(ctx.projectDir, ...workflow.file.split("/"));
    try {
      const source = await readFile(absolute, "utf8");
      const repaired = repairWorkflow(source, workflow, guardStep);
      return repaired === null
        ? null
        : {
            relative: workflow.file,
            absolute,
            source: repaired.source,
            jobs: repaired.jobs,
          };
    } catch {
      return null;
    }
  }

  /**
   * Read the guard step out of Lisa's own shipped deploy template.
   * @param lisaDir - Lisa installation directory
   * @returns The step's lines, or null when the template cannot be read
   */
  private async readGuardStep(
    lisaDir: string
  ): Promise<readonly string[] | null> {
    try {
      const template = await readFile(
        path.join(lisaDir, GUARD_TEMPLATE),
        "utf8"
      );
      return extractGuardStep(template, GUARD_STEP_NAME);
    } catch {
      return null;
    }
  }
}
