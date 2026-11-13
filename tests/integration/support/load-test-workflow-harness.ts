/**
 * Executes the shipped `load-test.yml` k6 steps in a disposable sandbox.
 *
 * The three steps that decide whether a load test ran and what its result
 * means — Prepare, Run and Generate summary — are read out of the real
 * workflow, their `${{ }}` expressions are rendered with GitHub's own
 * expression interpreter, and their `run:` bodies are executed by bash with
 * stub `k6` and `./scripts/k6-run.sh` binaries. Prepare's `$GITHUB_ENV` writes
 * are carried into Run, and Run's `$GITHUB_OUTPUT` into Generate summary, the
 * way a runner carries them (CodySwannGT/lisa#4526).
 *
 * Inputs are resolved the way `workflow_call` resolves them: a value the case
 * passes wins, then the input's declared `default:`, then the type's empty
 * value. That last rule is the one #4526's second defect hangs on — GitHub
 * renders an omitted `type: number` input as `0`, not as an empty string.
 * @module tests/integration/support/load-test-workflow-harness
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { load as loadYaml } from "js-yaml";

import { githubTemplate } from "../../helpers/github-expression.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** The shipped reusable workflow under test. */
export const LOAD_TEST_WORKFLOW = path.join(
  process.cwd(),
  ".github/workflows/load-test.yml"
);

/** A `workflow_call` input's value, as a caller passes or a default supplies it. */
type InputValue = string | number | boolean;

/** One input declaration under `on.workflow_call.inputs`. */
interface InputDeclaration {
  readonly type: "string" | "number" | "boolean";
  readonly default?: InputValue;
}

/** One step of the `k6_test` job. */
interface Step {
  readonly id?: string;
  readonly run?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/** The parts of the parsed workflow this harness reads. */
interface LoadTestWorkflow {
  readonly on: {
    readonly workflow_call: {
      readonly inputs: Readonly<Record<string, InputDeclaration>>;
    };
  };
  readonly jobs: { readonly k6_test: { readonly steps: readonly Step[] } };
}

/** A caller's `with:` block, plus what the consumer's tree contains. */
export interface LoadTestCase {
  /** Values the caller passes; anything omitted resolves as GitHub would. */
  readonly inputs?: Readonly<Record<string, InputValue>>;
  /** Exit status the stub `k6` returns. */
  readonly k6Exit?: number;
  /** Ship a `./scripts/k6-run.sh` stub exiting with this status. */
  readonly runnerExit?: number;
  /** File mode of the runner stub; executable (0o755) unless stated. */
  readonly runnerMode?: number;
  /** Repository-relative files the consumer's checkout contains. */
  readonly files?: readonly string[];
  /** Workflow to execute instead of the shipped one (rejection controls). */
  readonly workflowFile?: string;
  /** Secrets the caller passes; omitted secrets render as empty. */
  readonly secrets?: Readonly<Record<string, string>>;
}

/** Everything the three steps left behind, read before the sandbox goes. */
export interface LoadTestOutcome {
  /** Variables Prepare exported through `$GITHUB_ENV`. */
  readonly preparedEnv: Readonly<Record<string, string>>;
  /** Prepare step stdout and stderr together (warnings land here). */
  readonly prepareLog: string;
  /** Exit status of the Run step — what decides the job's colour. */
  readonly runStatus: number;
  /** Run step stdout and stderr together. */
  readonly runLog: string;
  /** Run's `$GITHUB_OUTPUT`. */
  readonly outputs: Readonly<Record<string, string>>;
  /** The step summary both Run and Generate summary appended to. */
  readonly stepSummary: string;
  /** argv the stub `k6` received, one entry per word; undefined if never run. */
  readonly k6Argv: readonly string[] | undefined;
  /** argv the stub runner received; undefined if never run. */
  readonly runnerArgv: readonly string[] | undefined;
}

const STUB_K6 = `#!/bin/bash
printf '%s\\n' "$@" > "$STUB_LOG_DIR/k6.argv"
echo "     checks.........................: 100.00% 5 out of 5"
echo "     iterations.....................: 5      1/s"
exit "\${K6_STUB_EXIT:-0}"
`;

const STUB_RUNNER = `#!/bin/bash
printf '%s\\n' "$@" > "$STUB_LOG_DIR/runner.argv"
exit "\${RUNNER_STUB_EXIT:-0}"
`;

/**
 * Parse the workflow fresh, so an edit to it is what every case observes.
 * @param file - The workflow to read; the shipped one unless stated
 * @returns The parsed workflow
 */
function workflow(file = LOAD_TEST_WORKFLOW): LoadTestWorkflow {
  return loadYaml(fs.readFileSync(file, "utf-8")) as LoadTestWorkflow;
}

/**
 * Find one `k6_test` step by its `id:`.
 * @param id - The step id
 * @param file - The workflow to read; the shipped one unless stated
 * @returns The step as shipped
 */
export function loadTestStep(id: string, file = LOAD_TEST_WORKFLOW): Step {
  const step = workflow(file).jobs.k6_test.steps.find(s => s.id === id);
  if (step?.run === undefined) throw new Error(`k6_test step not found: ${id}`);
  return step;
}

/**
 * Resolve the caller's `with:` block the way `workflow_call` does.
 * @param passed - Values the caller passes
 * @param file - The workflow to read; the shipped one unless stated
 * @returns Every declared input with its effective value
 */
export function resolveInputs(
  passed: Readonly<Record<string, InputValue>>,
  file = LOAD_TEST_WORKFLOW
): Record<string, InputValue> {
  const declared = workflow(file).on.workflow_call.inputs;
  const emptyOf = { string: "", number: 0, boolean: false } as const;
  return Object.fromEntries(
    Object.entries(declared).map(([name, decl]) => [
      name,
      passed[name] ?? decl.default ?? emptyOf[decl.type],
    ])
  );
}

/**
 * Parse a `$GITHUB_OUTPUT` / `$GITHUB_ENV` file of `KEY=value` lines.
 *
 * Heredoc (`KEY<<EOF`) values are not parsed: the only step that writes one is
 * Generate summary, whose output no case reads.
 * @param text - The file's contents
 * @returns Each key's last-written value
 */
export function parseCommandFile(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split("\n")
      .filter(line => line.includes("=") && !line.includes("<<"))
      .map(line => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)] as const;
      })
  );
}

/**
 * Write a rendered script into the sandbox.
 * @param dir - The sandbox
 * @param body - The rendered script
 * @returns The script's path
 */
function writeScript(dir: string, body: string): string {
  const script = path.join(dir, ".step.sh");
  fs.writeFileSync(script, body);
  return script;
}

/**
 * The test process's environment minus every `K6_*` variable.
 *
 * k6 reads `K6_*` directly, and the Run step reads `K6_VUS` and `K6_DURATION`
 * back from Prepare, so one set on the developer's machine would stand in for
 * what Prepare exported and decide the case.
 * @returns The environment a step may inherit
 */
function inheritedEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("K6_"))
  );
}

/**
 * Render a step's `env:` and `run:` and execute it in the sandbox.
 * @param dir - The sandbox (the consumer's checkout)
 * @param step - The shipped step
 * @param context - Expression contexts for rendering
 * @param env - Environment the runner would provide
 * @returns Exit status and combined output
 */
function execStep(
  dir: string,
  step: Step,
  context: Record<string, unknown>,
  env: Readonly<Record<string, string>>
): { readonly status: number; readonly log: string } {
  const stepEnv = Object.fromEntries(
    Object.entries(step.env ?? {}).map(([k, v]) => [
      k,
      githubTemplate(String(v), context),
    ])
  );
  const script = writeScript(dir, githubTemplate(step.run ?? "", context));
  const outcome = boundedSpawnSync({
    command: "bash",
    args: ["-e", script],
    cwd: dir,
    label: "load-test.yml step body",
    env: { ...inheritedEnv(), ...env, ...stepEnv },
  });
  return {
    status: outcome.status ?? -1,
    log: `${outcome.stdout}${outcome.stderr}`,
  };
}

/**
 * Lay out a consumer checkout with stub binaries and its declared files.
 * @param dir - A fresh sandbox
 * @param testCase - The case being laid out
 */
function layOut(dir: string, testCase: LoadTestCase): void {
  const bin = path.join(dir, ".bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "k6"), STUB_K6, { mode: 0o755 });
  if (testCase.runnerExit !== undefined) {
    fs.mkdirSync(path.join(dir, "scripts"));
    fs.writeFileSync(path.join(dir, "scripts/k6-run.sh"), STUB_RUNNER, {
      mode: testCase.runnerMode ?? 0o755,
    });
  }
  for (const file of testCase.files ?? []) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), "export default function () {}\n");
  }
}

/**
 * Read a stub's recorded argv, if it ran.
 * @param file - The stub's argv log
 * @returns One entry per argv word, or undefined when the stub never ran
 */
function argvOf(file: string): readonly string[] | undefined {
  return fs.existsSync(file)
    ? fs.readFileSync(file, "utf-8").trimEnd().split("\n")
    : undefined;
}

/**
 * Run Prepare, Run and Generate summary for one caller, as a runner would.
 *
 * The sandbox is removed before returning, so nothing may be inspected after.
 * @param testCase - The caller and the consumer tree
 * @returns What the steps produced
 */
export function runLoadTest(testCase: LoadTestCase): LoadTestOutcome {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-load-test-"));
  try {
    layOut(dir, testCase);
    const files = {
      GITHUB_ENV: path.join(dir, ".github_env"),
      GITHUB_OUTPUT: path.join(dir, ".github_output"),
      GITHUB_STEP_SUMMARY: path.join(dir, ".step_summary"),
    };
    for (const file of Object.values(files)) fs.writeFileSync(file, "");
    const file = testCase.workflowFile ?? LOAD_TEST_WORKFLOW;
    const inputs = resolveInputs(testCase.inputs ?? {}, file);
    const runnerEnv = {
      ...files,
      PATH: `${path.join(dir, ".bin")}:${process.env["PATH"] ?? ""}`,
      STUB_LOG_DIR: dir,
      K6_STUB_EXIT: String(testCase.k6Exit ?? 0),
      RUNNER_STUB_EXIT: String(testCase.runnerExit ?? 0),
    };
    const context = { inputs, secrets: testCase.secrets ?? {}, github: {} };

    const prepare = execStep(
      dir,
      loadTestStep("prepare_test", file),
      context,
      runnerEnv
    );
    // A failed Prepare would end the job before Run; every case below
    // assumes Run was reached, so a broken Prepare must not pass silently.
    if (prepare.status !== 0)
      throw new Error(`prepare_test exited ${prepare.status}:\n${prepare.log}`);
    const preparedEnv = parseCommandFile(
      fs.readFileSync(files.GITHUB_ENV, "utf-8")
    );
    const run = execStep(dir, loadTestStep("run_test", file), context, {
      ...runnerEnv,
      ...preparedEnv,
    });
    const outputs = parseCommandFile(
      fs.readFileSync(files.GITHUB_OUTPUT, "utf-8")
    );
    fs.writeFileSync(files.GITHUB_OUTPUT, "");
    const summary = execStep(
      dir,
      loadTestStep("generate_summary", file),
      { ...context, steps: { run_test: { outputs } } },
      runnerEnv
    );
    // The summary step runs `if: always()` and must never fail the job itself;
    // a broken one would otherwise hide behind the Run step's status.
    if (summary.status !== 0)
      throw new Error(
        `generate_summary exited ${summary.status}:\n${summary.log}`
      );

    return {
      preparedEnv,
      prepareLog: prepare.log,
      runStatus: run.status,
      runLog: run.log,
      outputs,
      stepSummary: fs.readFileSync(files.GITHUB_STEP_SUMMARY, "utf-8"),
      k6Argv: argvOf(path.join(dir, "k6.argv")),
      runnerArgv: argvOf(path.join(dir, "runner.argv")),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
