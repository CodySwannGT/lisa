/**
 * Tier 3 — whether a CI job reads the declaration or runs a hardcoded command.
 *
 * That answer is written in `.github/workflows/quality.yml`, and a consumer
 * holds no copy of it: it calls the reusable workflow by ref. So for most
 * projects the honest answer is that the question cannot be answered here.
 *
 * It was, however, being refused UNCONDITIONALLY — including in the one
 * repository where the file is present, which is Lisa's own. A refusal that
 * does not look is indistinguishable from a refusal that looked and failed,
 * and only one of those is true. So: when the workflow is on disk, read it and
 * answer.
 *
 * The read is a deterministic YAML parse and nothing else. No agent, no
 * judgement, no network. A job's façade is wired when its steps carry the
 * resolve step — `id: gate` with a `GATE_ID` in its environment — which is the
 * same signal `tests/integration/quality-gate-skip-jobs-mapping.test.ts`
 * derives the shipped job table from, so the two cannot answer differently.
 *
 * Sibling workflows are scanned too, because a job that moved to a workflow of
 * its own took its façade with it. Reading `quality.yml` alone would report a
 * moved job as unwired on the grounds that it is no longer next door.
 * @module cli/gate-report-facade
 */
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";

import { loadYaml } from "../utils/yaml.js";
import type { FacadeSource, Finding } from "./gate-report-types.js";

/** The workflow Tier 3 is written in. */
const QUALITY_YML = "quality.yml";

/** Where a repository keeps its workflows. */
const WORKFLOW_DIR = path.join(".github", "workflows");

/** The step id every façade resolve step carries. */
const RESOLVE_STEP_ID = "gate";

/** Everything the local workflows say about façade wiring. */
export interface FacadeFacts {
  /** Whether `quality.yml` itself was found and parsed. */
  readonly qualityYmlPresent: boolean;
  /** Workflow files parsed, project-relative and sorted. */
  readonly files: readonly string[];
  /** Job id -> the gate its façade resolves. */
  readonly gatesByJob: ReadonlyMap<string, string>;
  /** Every job id declared across the parsed workflows. */
  readonly jobs: ReadonlySet<string>;
  /**
   * Every status context the project's OWN workflows could post.
   *
   * Both the bare job name and the `workflow / job` form, because GitHub
   * spells a context differently depending on how the job was reached and a
   * report that matched only one form would attribute a project's own job to a
   * third party.
   */
  readonly projectContexts: ReadonlySet<string>;
  /** Every job, with the shell it runs and the contexts it could post. */
  readonly jobSites: readonly JobSite[];
}

/** One CI job, as the merge-verdict join reads it. */
export interface JobSite {
  /** The job's id. */
  readonly id: string;
  /** The job's `name:`, which is what a ruleset matches by string. */
  readonly name: string;
  /** The contexts it could post, in both spellings GitHub uses. */
  readonly contexts: readonly string[];
  /** Every `run:` block in the job, concatenated. */
  readonly shell: string;
}

/** The refusal a project with no copy of the workflow gets. */
export const TIER_THREE_UNKNOWABLE: Finding<never> = {
  state: "unknown",
  reason: "determined-by-quality-yml",
  message:
    "Whether the CI job reads this declaration or runs a hardcoded command is written in quality.yml, which this project does not have — it calls the reusable workflow by ref.",
};

/**
 * The gate one job's façade resolves, if it has one.
 * @param job - One parsed job definition
 * @returns The declared `GATE_ID`, or null
 */
function gateOfJob(job: unknown): string | null {
  if (job === null || typeof job !== "object") return null;
  const steps: unknown = Reflect.get(job, "steps");
  if (!Array.isArray(steps)) return null;
  const resolve = steps.find(
    step =>
      step !== null &&
      typeof step === "object" &&
      Reflect.get(step, "id") === RESOLVE_STEP_ID
  );
  if (resolve === undefined) return null;
  const environment: unknown = Reflect.get(resolve, "env");
  if (environment === null || typeof environment !== "object") return null;
  const id: unknown = Reflect.get(environment, "GATE_ID");
  return typeof id === "string" ? id : null;
}

/** One parsed workflow file. */
interface ParsedWorkflowFile {
  /** The workflow's own `name:`, which prefixes every context it posts. */
  readonly workflowName: string | null;
  /** Job id -> definition. */
  readonly jobs: Record<string, unknown>;
}

/**
 * Parse one workflow file into its name and its jobs.
 * @param file - Absolute path
 * @returns The parsed workflow, or null when it could not be read
 */
async function parseWorkflow(file: string): Promise<ParsedWorkflowFile | null> {
  const source = await readFile(file, "utf8").catch(() => undefined);
  if (source === undefined) return null;
  try {
    const parsed: unknown = loadYaml(source);
    if (parsed === null || typeof parsed !== "object") return null;
    const jobs: unknown = Reflect.get(parsed, "jobs");
    if (jobs === null || typeof jobs !== "object") return null;
    const workflowName: unknown = Reflect.get(parsed, "name");
    return {
      workflowName: typeof workflowName === "string" ? workflowName : null,
      jobs: jobs as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

/**
 * The contexts one job could post, in both spellings GitHub uses.
 * @param workflowName - The declaring workflow's name
 * @param job - The job definition
 * @param jobId - The job's id, used when it declares no name
 * @returns Candidate context strings
 */
function contextsOfJob(
  workflowName: string | null,
  job: unknown,
  jobId: string
): string[] {
  const declared =
    job !== null && typeof job === "object" ? Reflect.get(job, "name") : null;
  const name = typeof declared === "string" ? declared : jobId;
  return workflowName === null ? [name] : [name, `${workflowName} / ${name}`];
}

/**
 * Every `run:` block one job declares, concatenated.
 * @param job - The job definition
 * @returns The shell the job runs
 */
function shellOf(job: unknown): string {
  if (job === null || typeof job !== "object") return "";
  const steps: unknown = Reflect.get(job, "steps");
  if (!Array.isArray(steps)) return "";
  return steps
    .map(step => {
      if (step === null || typeof step !== "object") return "";
      const run: unknown = Reflect.get(step, "run");
      return typeof run === "string" ? run : "";
    })
    .join("\n");
}

/**
 * Every workflow file in the project, sorted so the report is stable.
 * @param projectRoot - Project root
 * @returns File names, sorted
 */
async function listWorkflowFiles(projectRoot: string): Promise<string[]> {
  const entries = await readdir(path.join(projectRoot, WORKFLOW_DIR), {
    withFileTypes: true,
  }).catch(() => undefined);
  if (entries === undefined) return [];
  return entries
    .filter(
      entry =>
        entry.isFile() &&
        (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml"))
    )
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Read what the project's own workflows say about façade wiring.
 * @param projectRoot - Project root
 * @returns The facts, empty when the project holds no workflows
 */
export async function readFacadeFacts(
  projectRoot: string
): Promise<FacadeFacts> {
  const names = await listWorkflowFiles(projectRoot);
  const parsed = await Promise.all(
    names.map(async name => ({
      name,
      parsed: await parseWorkflow(path.join(projectRoot, WORKFLOW_DIR, name)),
    }))
  );
  const readable = parsed.filter(
    (entry): entry is { name: string; parsed: ParsedWorkflowFile } =>
      entry.parsed !== null
  );
  const sites = readable.flatMap(entry =>
    Object.entries(entry.parsed.jobs).map(([job, definition]) => {
      const contexts = contextsOfJob(
        entry.parsed.workflowName,
        definition,
        job
      );
      return {
        id: job,
        name: contexts[0] ?? job,
        contexts,
        shell: shellOf(definition),
        gate: gateOfJob(definition),
      };
    })
  );
  const jobSites = [...sites].sort(byJobId);
  const gatePairs = jobSites.flatMap((site): [string, string][] =>
    site.gate === null ? [] : [[site.id, site.gate]]
  );
  return {
    qualityYmlPresent: readable.some(entry => entry.name === QUALITY_YML),
    files: readable.map(entry => `${WORKFLOW_DIR}/${entry.name}`),
    // Declaration order wins for a duplicated job id, because that is the job
    // GitHub itself would run: a Map built from pairs keeps the LAST, so the
    // list is reversed before it is built.
    gatesByJob: new Map([...gatePairs].reverse()),
    jobs: new Set(jobSites.map(site => site.id)),
    projectContexts: new Set(jobSites.flatMap(site => site.contexts)),
    jobSites,
  };
}

/**
 * Order two jobs by id, so the report is stable across machines.
 * @param left - One job
 * @param right - Another job
 * @returns A comparison result
 */
function byJobId(left: JobSite, right: JobSite): number {
  return left.id.localeCompare(right.id);
}

/**
 * How the report names the workflows it read.
 * @param facts - The parsed workflow facts
 * @returns The source block
 */
export function facadeSourceOf(facts: FacadeFacts): FacadeSource {
  return { present: facts.qualityYmlPresent, files: facts.files };
}

/**
 * Whether the CI job for one gate reads the declaration.
 *
 * Three answers, and the third is not a fourth state smuggled in: a job the
 * workflow does not declare at all is a different fact from a job that runs a
 * hardcoded command, and calling the first one `false` would report a gate as
 * unwired on the strength of never having found it.
 * @param facts - The parsed workflow facts
 * @param gateId - The gate being reported
 * @param qualityJob - The CI job the static table pairs with it
 * @returns Whether that job's façade resolves this gate
 */
export function facadeFinding(
  facts: FacadeFacts,
  gateId: string,
  qualityJob: string | null
): Finding<boolean> {
  if (qualityJob === null) {
    return {
      state: "not-applicable",
      reason: "no-mapped-job",
      message:
        "Lisa's static job table pairs no CI job with this gate, so there is no job whose wiring could be read.",
    };
  }
  if (!facts.qualityYmlPresent) return TIER_THREE_UNKNOWABLE;
  const resolved = facts.gatesByJob.get(qualityJob);
  if (resolved !== undefined) {
    return { state: "verified", value: resolved === gateId };
  }
  if (facts.jobs.has(qualityJob)) return { state: "verified", value: false };
  return {
    state: "unknown",
    reason: "job-absent-from-this-workflow",
    message: `quality.yml is present here but declares no job called ${qualityJob}, so whether that job reads this declaration cannot be read from this checkout.`,
  };
}
