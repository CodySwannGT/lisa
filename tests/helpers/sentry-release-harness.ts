/** Run the shipped release.yml Sentry job's shell steps with fixture contexts. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { data, Evaluator, Lexer, Parser } from "@actions/expressions";

import { githubCondition } from "./github-expression.js";
import { boundedSpawnSync } from "./io-latency-budget.js";
import {
  jobOf,
  loadWorkflow,
  type WorkflowStep,
} from "./workflow-test-utils.js";

export const releaseWorkflow = loadWorkflow(".github/workflows/release.yml");
const job = jobOf(releaseWorkflow, "sentry_release");

export const SENTRY_CREDENTIALS = {
  SENTRY_AUTH_TOKEN: "fixture-token",
  SENTRY_ORG: "private-org",
  SENTRY_PROJECT: "private-project",
};

/** The version job outputs every case shares unless it overrides them. */
export const VERSION_OUTPUTS = {
  version: "1.2.3",
  tag: "v1.2.3",
  release_commit: "c0ffee1234567890c0ffee1234567890c0ffee12",
};

/** The pushed commit the caller's run was triggered by. */
export const TRIGGER_SHA = "56f04b8d0123456789abcdef0123456789abcdef";

/**
 * Resolve expressions using GitHub's interpreter, including actual env bindings.
 * @param source Shipped workflow expression or shell script.
 * @param context Fixture values for GitHub contexts.
 * @returns Rendered value passed to the shell.
 */
export function render(
  source: unknown,
  context: Record<string, unknown>
): string {
  return String(source).replace(
    /\$\{\{(.*?)\}\}/gu,
    (_, expression: string) => {
      const tokens = new Lexer(expression.trim()).lex().tokens;
      const parsed = new Parser(tokens, Object.keys(context), []).parse();
      const values = JSON.parse(
        JSON.stringify(context),
        data.reviver
      ) as data.Dictionary;
      return new Evaluator(parsed, values).evaluate().coerceString();
    }
  );
}

/** Fixture knobs for one exercise of the Sentry job. */
export interface SentryExercise {
  readonly secrets: Record<string, string>;
  readonly vars?: Record<string, string>;
  readonly actionOutcome?: string;
  readonly inputs?: Record<string, string>;
  readonly versionOutputs?: Record<string, string>;
  /** Git checkout the steps run in (the job's checkout); defaults to a non-repository scratch dir. */
  readonly repository?: string;
  /** Overrides the triggering commit (`github.sha`). */
  readonly triggerSha?: string;
}

/** What one exercise observed. */
export interface SentryObservation {
  readonly invoked: boolean;
  readonly actionEnv: Record<string, string>;
  readonly actionVersion: string;
  readonly resolveStatus: number | null;
  readonly resolveStderr: string;
  readonly resolveStdout: string;
  readonly output: string;
  readonly summary: string;
}

/**
 * Locate a shipped step by id or name.
 * @param id Step id or display name.
 * @returns The shipped step.
 */
function step(id: string): WorkflowStep {
  const found = job.steps?.find(item => item.id === id || item.name === id);
  if (!found) throw new Error(`Missing Sentry step ${id}`);
  return found;
}

/** Step results the later steps' expressions read. */
interface StepState {
  readonly configured: string;
  readonly name: string;
  readonly outcome: string;
}

/** GitHub contexts keyed by name (secrets, vars, inputs, needs, steps). */
type Contexts = Record<string, unknown>;

/**
 * Build the GitHub contexts one step renders against.
 * @param fixture Fixture knobs.
 * @param state Outputs produced by the steps that already ran.
 * @returns Contexts for expression evaluation.
 */
function contextsFor(fixture: SentryExercise, state: StepState): Contexts {
  return {
    secrets: fixture.secrets,
    vars: fixture.vars ?? {},
    github: { sha: fixture.triggerSha ?? TRIGGER_SHA },
    inputs: {
      environment: "production",
      sourcemaps: "",
      sentry_release_name: "",
      sentry_release_name_command: "",
      ...fixture.inputs,
    },
    needs: {
      version: { outputs: { ...VERSION_OUTPUTS, ...fixture.versionOutputs } },
    },
    steps: {
      check_config: { outputs: { configured: state.configured } },
      resolve_name: { outputs: { name: state.name } },
      sentry: { outcome: state.outcome },
    },
  };
}

/**
 * Render a step's env bindings.
 * @param item The shipped step.
 * @param context Contexts to render against.
 * @returns The env the step would receive.
 */
function environmentOf(
  item: WorkflowStep,
  context: Contexts
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(item.env ?? {}).map(([key, value]) => [
      key,
      render(value, context),
    ])
  );
}

/**
 * Run one shipped step under bash with only its declared env.
 * @param item The shipped step.
 * @param context Contexts to render against.
 * @param root Scratch directory holding the output and summary files.
 * @param cwd Directory the step runs in (the checked-out repository).
 * @returns The child's result.
 */
function runStep(
  item: WorkflowStep,
  context: Contexts,
  root: string,
  cwd: string = root
) {
  const fixtureEnv: Record<string, string> = {
    // Hosted runners carry node on PATH; the fixture exposes the same one.
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
    ...environmentOf(item, context),
    GITHUB_OUTPUT: path.join(root, "output"),
    GITHUB_STEP_SUMMARY: path.join(root, "summary"),
  };
  const clearMissing = Object.keys(SENTRY_CREDENTIALS)
    .filter(key => fixtureEnv[key] === "")
    .map(key => `unset ${key};`)
    .join("\n");
  // Clear ambient credential injection inside the child before the fixture runs.
  return boundedSpawnSync({
    label: "Sentry workflow step",
    command: "/usr/bin/env",
    args: [
      "-i",
      ...Object.entries(fixtureEnv).map(([key, value]) => `${key}=${value}`),
      "/bin/bash",
      "--noprofile",
      "--norc",
      "-eo",
      "pipefail",
      "-c",
      `${clearMissing}\n${render(item.run, context)}`,
    ],
    cwd,
  });
}

/**
 * Read one key from the step output file.
 * @param root Scratch directory.
 * @param key Output key.
 * @returns The last value written for the key, or empty.
 */
function readOutput(root: string, key: string): string {
  const values = readFileSync(path.join(root, "output"), "utf8")
    .split("\n")
    .filter(line => line.startsWith(`${key}=`))
    .map(line => line.slice(key.length + 1));
  return values.at(-1) ?? "";
}

/**
 * Run real shell steps; only the external Sentry action outcome is supplied.
 * @param fixture Fixture secret/variable channels, inputs and action outcome.
 * @returns Observed action selection, credentials, outputs and summary.
 */
export function exerciseSentryJob(fixture: SentryExercise): SentryObservation {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-sentry-config-"));
  const outcome = fixture.actionOutcome ?? "success";
  try {
    writeFileSync(path.join(root, "output"), "");
    writeFileSync(path.join(root, "summary"), "");
    const initial = contextsFor(fixture, {
      configured: "false",
      name: "",
      outcome,
    });
    runStep(step("check_config"), initial, root);
    const checked = {
      configured: readOutput(root, "configured"),
      name: "",
      outcome,
    };
    const resolver = step("resolve_name");
    const resolved = githubCondition(
      resolver.if ?? "false",
      contextsFor(fixture, checked)
    )
      ? runStep(
          resolver,
          contextsFor(fixture, checked),
          root,
          fixture.repository ?? root
        )
      : undefined;
    const named = { ...checked, name: readOutput(root, "name") };
    const action = step("sentry");
    const invoked =
      (resolved?.status ?? 0) === 0 &&
      githubCondition(action.if ?? "false", contextsFor(fixture, named));
    const final = contextsFor(fixture, {
      ...named,
      outcome: invoked ? outcome : "skipped",
    });
    const reporting = step("Update Release Summary");
    if (githubCondition(reporting.if ?? "false", final)) {
      runStep(reporting, final, root);
    }
    writeFileSync(path.join(root, "output"), "");
    runStep(step("set_outputs"), final, root);
    return {
      invoked,
      actionEnv: environmentOf(action, final),
      actionVersion: render(action.with?.version, final),
      resolveStatus: resolved?.status ?? null,
      resolveStderr: String(resolved?.stderr ?? ""),
      resolveStdout: String(resolved?.stdout ?? ""),
      output: readFileSync(path.join(root, "output"), "utf8"),
      summary: readFileSync(path.join(root, "summary"), "utf8"),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
