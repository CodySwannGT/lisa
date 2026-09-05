/**
 * Decide whether a job SKIPS because its release job did not succeed
 * (CodySwannGT/lisa#3740).
 *
 * ## The shape being detected
 *
 * GitHub renders a skipped job as neutral and counts a skipped required check
 * as satisfied. So a deploy that never happened leaves no signal anywhere: the
 * branch still carries its release commit, every status field still says green,
 * and nothing prompts anyone to go read CI history for skipped Deploy jobs. A
 * consuming repository ran eight days that way (#3467).
 *
 * Two spellings produce it, and neither says anything about skipping:
 *
 * - **No `if:` at all.** GitHub ANDs an implicit `success()` onto the job, so a
 *   failed release skips it silently. (The rails template's form.)
 * - **An `if:` that names a status function but conjoins
 *   `needs.<release>.result == 'success'`.** The status function suppresses the
 *   implicit AND, and then the conjunct reintroduces it by hand. (The expo
 *   template's form.)
 *
 * ## Why this is answered semantically rather than by pattern
 *
 * Matching those two spellings would find the two templates and miss the third
 * spelling a host wrote by hand — and, worse, would flag a job that skips for a
 * reason having nothing to do with the release. The question is not "does this
 * condition contain a string" but **"does the release result decide whether
 * this job runs"**, and that is answered by evaluating the condition twice:
 *
 * - **released:** the release job reports `success`.
 * - **failed:** the release job reports `failure`.
 *
 * A job that runs under the first and skips under the second is skipping
 * because of the release. A job that skips under both — an unconfigured
 * stack, a path filter, a deliberate `if:` about something else — is skipping
 * for its own reasons and is not this defect. That is the acceptance criteria's
 * third scenario satisfied by construction rather than by a special case.
 *
 * ## The most-permissive assignment, and what it can miss
 *
 * Both evaluations need values for the paths the condition reads that are not
 * the release result — another job's output, a `github.*` field, an input.
 * Those are assigned the value that makes the surrounding comparison hold: a
 * path compared for equality against a literal takes that literal, and anything
 * else takes a non-empty placeholder. The reading is "assuming everything else
 * about this repository is configured, does the release result decide it".
 *
 * Stated rather than implied: this is one assignment, not a search. A condition
 * whose release dependence only appears under some *other* combination of
 * values is not reported. Under-reporting is the deliberate direction — a check
 * that flags a deploy job for a skip it does not have is one that gets turned
 * off, and then the real instances go unreported too.
 *
 * A condition the evaluator cannot parse yields `unreadable`, never `false`.
 * @module core/deploy-release-dependence
 */
import {
  type JobResult,
  jobRuns,
  type RunScenario,
  tokenize,
} from "./github-actions-condition.js";

/** The minimal job shape this analysis reads. */
export interface DependenceJob {
  /** The job's key in the workflow's `jobs:` map. */
  readonly id: string;
  /** The job's display `name:`, or `""` when it declares none. */
  readonly name?: string;
  /** Ids of the jobs this one declares in `needs:`. */
  readonly needs: readonly string[];
  /** The job's `if:` text, or `""` when it declares none. */
  readonly ifCondition: string;
  /** Deployment environments the job declares, if any. */
  readonly environment?: readonly string[];
}

/** What one job's release dependence turned out to be. */
export type ReleaseDependence =
  /** The job runs when the release succeeds and skips when it fails. */
  | { readonly kind: "skips-on-failed-release"; readonly release: string }
  /** The release result does not decide whether this job runs. */
  | { readonly kind: "independent" }
  /** The condition could not be read, so nothing is claimed either way. */
  | { readonly kind: "unreadable"; readonly reason: string };

/** Job ids and names that identify the job which cuts the release. */
const RELEASE_JOB = /(^|[_\-\s])(release|publish)([_\-\s]|$)/i;

/** Job ids and names that identify a job which ships to an environment. */
const DEPLOY_JOB = /deploy/i;

/** The value assigned to a free path with no equality comparison to borrow. */
const PLACEHOLDER = "lisa-permissive-placeholder";

/** Context roots whose values this analysis chooses, beyond `github.*`. */
const FREE_ROOTS = ["inputs"];

/**
 * Whether an upstream job is the one that cuts the release.
 *
 * Name-based, and that is a stated limit rather than an oversight: a host free
 * to name its jobs anything can name this one something with neither word in
 * it, and such a job is not recognised. The alternative — treating every
 * upstream job as release-like — would report a deploy that skips because an
 * unrelated optional job failed, which is a different property.
 * @param job - The candidate upstream job
 * @returns True when the job looks like the release
 */
export function isReleaseJob(job: DependenceJob): boolean {
  return RELEASE_JOB.test(job.id) || RELEASE_JOB.test(job.name ?? "");
}

/**
 * Whether a job ships something to an environment.
 *
 * A declared `environment:` is the name-independent half: GitHub's deployment
 * environments exist for exactly this kind of job, so a host that used one has
 * said what the job is without Lisa having to guess from its id.
 * @param job - The candidate job
 * @returns True when the job looks like a deploy
 */
export function isDeployJob(job: DependenceJob): boolean {
  return (
    DEPLOY_JOB.test(job.id) ||
    DEPLOY_JOB.test(job.name ?? "") ||
    (job.environment ?? []).length > 0
  );
}

/**
 * The literal a path is compared against, when the comparison is an equality.
 * @param tokens - The tokenized condition
 * @param index - Position of the path token
 * @returns The literal without its quotes, or null when there is none
 */
function comparedLiteral(
  tokens: readonly string[],
  index: number
): string | null {
  const quoted = (token: string | undefined): string | null =>
    token !== undefined && token.startsWith("'") ? token.slice(1, -1) : null;
  if (tokens[index + 1] === "==") return quoted(tokens[index + 2]);
  if (tokens[index - 1] === "==") return quoted(tokens[index - 2]);
  return null;
}

/**
 * Choose a value for every non-`needs.*.result` path the condition reads.
 *
 * A path compared for equality against a string literal takes that literal, so
 * the comparison holds; every other path takes a non-empty placeholder, which
 * is truthy and satisfies an inequality. The result is the run in which
 * everything except the release is configured as the condition wants it.
 * @param condition - The raw `if:` text
 * @returns The chosen values, keyed by full dotted path
 */
function permissiveAssignment(
  condition: string
): Readonly<Record<string, string>> {
  const tokens = tokenize(
    condition
      .trim()
      .replace(/^\$\{\{/, "")
      .replace(/\}\}$/, "")
  );
  const isPath = (token: string): boolean =>
    /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(token) && !token.endsWith(".result");
  return Object.fromEntries(
    tokens.flatMap((token, index) =>
      isPath(token)
        ? [[token, comparedLiteral(tokens, index) ?? PLACEHOLDER] as const]
        : []
    )
  );
}

/** The permissive assignment, split into the shapes the evaluator consumes. */
interface SplitAssignment {
  /** Per-upstream-job output maps. */
  readonly outputs: Readonly<Record<string, Record<string, string>>>;
  /** Flattened `github.*` paths. */
  readonly github: Readonly<Record<string, string>>;
  /** Flattened `inputs.*` values. */
  readonly inputs: Readonly<Record<string, string>>;
}

/** An assignment with nothing in it, and the seed for the fold below. */
const EMPTY_ASSIGNMENT: SplitAssignment = {
  outputs: {},
  github: {},
  inputs: {},
};

/**
 * Route one chosen path into the half of the scenario that owns it.
 * @param split - The assignment built so far
 * @param entry - One `[path, value]` pair
 * @returns The assignment with that pair routed
 */
function routePath(
  split: SplitAssignment,
  entry: readonly [string, string]
): SplitAssignment {
  const [path, value] = entry;
  const segments = path.split(".");
  const root = segments[0] ?? "";
  if (root === "needs" && segments[2] === "outputs") {
    const job = segments[1] ?? "";
    return {
      ...split,
      outputs: {
        ...split.outputs,
        [job]: { ...split.outputs[job], [segments[3] ?? ""]: value },
      },
    };
  }
  if (root === "github") {
    return { ...split, github: { ...split.github, [path]: value } };
  }
  return FREE_ROOTS.includes(root)
    ? { ...split, inputs: { ...split.inputs, [segments[1] ?? ""]: value } }
    : split;
}

/**
 * Split the permissive assignment into the shapes the evaluator consumes.
 * @param chosen - The permissive assignment
 * @returns The `needs` outputs, `github.*` values and `inputs.*` values
 */
function splitAssignment(
  chosen: Readonly<Record<string, string>>
): SplitAssignment {
  return Object.entries(chosen).reduce<SplitAssignment>(
    (split, entry) => routePath(split, entry),
    EMPTY_ASSIGNMENT
  );
}

/**
 * Build the run state for one release outcome.
 * @param job - The job under analysis
 * @param release - The release job's id
 * @param releaseResult - What the release job reports in this scenario
 * @param chosen - The permissive assignment
 * @returns A scenario the evaluator can be run against
 */
function scenarioFor(
  job: DependenceJob,
  release: string,
  releaseResult: JobResult,
  chosen: Readonly<Record<string, string>>
): RunScenario {
  const { outputs, github, inputs } = splitAssignment(chosen);
  return {
    needs: Object.fromEntries(
      job.needs.map(id => [
        id,
        {
          result: id === release ? releaseResult : ("success" as JobResult),
          outputs: outputs[id] ?? {},
        },
      ])
    ),
    github,
    inputs,
    cancelled: false,
  };
}

/**
 * Decide whether the release result is what makes this job skip.
 * @param job - The job under analysis
 * @param release - The id of the upstream release job
 * @returns What the two evaluations established
 */
export function releaseDependence(
  job: DependenceJob,
  release: string
): ReleaseDependence {
  try {
    const chosen = permissiveAssignment(job.ifCondition);
    const runsWhenReleased = jobRuns(
      job.ifCondition,
      scenarioFor(job, release, "success", chosen)
    );
    const runsWhenFailed = jobRuns(
      job.ifCondition,
      scenarioFor(job, release, "failure", chosen)
    );
    return runsWhenReleased && !runsWhenFailed
      ? { kind: "skips-on-failed-release", release }
      : { kind: "independent" };
  } catch (error) {
    return {
      kind: "unreadable",
      reason: (error as Error).message,
    };
  }
}

/** One deploy job whose run depends on the release having succeeded. */
export interface SkippingDeployJob {
  /** The job that skips. */
  readonly job: DependenceJob;
  /** The upstream release job whose failure skips it. */
  readonly release: string;
}

/**
 * Find every deploy job in one workflow that skips when its release fails.
 * @param jobs - Every job the workflow declares
 * @returns The deploy jobs that go silent on a failed release
 */
export function deployJobsSkippedByFailedRelease(
  jobs: readonly DependenceJob[]
): readonly SkippingDeployJob[] {
  const releases = new Set(jobs.filter(isReleaseJob).map(job => job.id));
  return jobs.flatMap(job => {
    if (releases.has(job.id) || !isDeployJob(job)) return [];
    // Every release-like upstream, not merely the first. A deploy that needs
    // two of them gates on ONE, and which one is not the order `needs:` happens
    // to list. Taking the first and stopping reported `independent` whenever the
    // gating release was listed second — the defect silently unreported, and the
    // migration declining to repair it (CodeRabbit on CodySwannGT/lisa#3740).
    const release = job.needs.find(
      id =>
        releases.has(id) &&
        releaseDependence(job, id).kind === "skips-on-failed-release"
    );
    if (release === undefined) return [];
    return [{ job, release }];
  });
}
