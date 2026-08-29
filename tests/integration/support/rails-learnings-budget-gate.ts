/**
 * Harness that EXECUTES `quality-rails.yml`'s learnings-budget gate façade.
 *
 * The step is pulled verbatim out of the workflow and run under `bash`, for the
 * reason its sibling `threshold-ratchet-gate-fail-closed` gives: the property
 * under test is what a Rails project's declaration makes the job do, and a test
 * that greps YAML for `configured=off` passes against a branch nothing reaches.
 *
 * `npm` is stubbed on `$PATH` rather than reached over the network, so the
 * fetch path is exercised offline and deterministically. The tarball the stub
 * hands back is built from this repository's own `all/copy-overwrite/scripts`,
 * which is the tree the published package ships.
 * @module tests/integration/support/rails-learnings-budget-gate
 */
import * as fs from "fs-extra";
import type { SpawnSyncReturns } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  loadWorkflow,
  type WorkflowStep,
} from "../../helpers/workflow-test-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repository root, from this file. */
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** `bash` by absolute path — never resolved through a writeable $PATH. */
const BASH = "/bin/bash";

/** The workflow under test. */
const WORKFLOW = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "quality-rails.yml"
);

/** The step that runs whatever prover the project declared. */
export const DECLARED_PROVER_STEP = "📚 Run the learnings-budget gate";

/**
 * Every step of the job, in the order GitHub would consider them.
 * @returns The job's steps.
 */
export function jobSteps(): readonly WorkflowStep[] {
  return loadWorkflow(WORKFLOW).jobs["learnings_budget"]?.steps ?? [];
}

/**
 * One step of the job.
 * @param match Predicate over the step.
 * @returns The matching step.
 * @throws {Error} When the job carries no such step.
 */
export function step(
  match: (candidate: WorkflowStep) => boolean
): WorkflowStep {
  const hit = jobSteps().find(match);
  if (!hit) throw new Error("quality-rails.yml learnings_budget: step absent");
  return hit;
}

/**
 * The gate resolution step, the subject of this suite.
 * @returns The step whose id is `gate`.
 */
const resolveStep = (): WorkflowStep => step(one => one.id === "gate");

/**
 * The step names GitHub would RUN for a given resolved `configured` value.
 *
 * The conditions are parsed out of the workflow and evaluated, not compared to
 * an expected string: a guard rewritten into a shape this cannot read fails
 * loudly instead of silently agreeing.
 * @param configured The value the resolve step wrote to `$GITHUB_OUTPUT`.
 * @returns Names of the steps that would run.
 * @throws {Error} When a step carries a condition this cannot evaluate.
 */
export function stepsThatRun(configured: string): readonly string[] {
  const guard = /^steps\.gate\.outputs\.configured == '([a-z]+)'$/u;
  const runs = (one: WorkflowStep): boolean => {
    if (!one.if) return true;
    const parsed = guard.exec(one.if.trim());
    if (!parsed) throw new Error(`unreadable step condition: ${one.if}`);
    return parsed[1] === configured;
  };
  return jobSteps()
    .filter(runs)
    .map(one => one.name ?? "");
}

/** How the stubbed `npm pack` should behave. */
export type PackMode = "ok" | "fail" | "no-resolver";

/** How the workflow's exact temporary-root cleanup command should behave. */
export type CleanupMode = "ok" | "fail";

/** A project the gate step is run against. */
export interface Project {
  /** Contents of `.lisa.config.json`, or `null` for a project without one. */
  readonly config: string | null;
  /** Contents of `package.json`. */
  readonly packageJson: string;
  /** How the stubbed `npm pack` behaves for this run. */
  readonly packMode?: PackMode;
  /** Whether an otherwise successful `rm` reports a cleanup failure. */
  readonly cleanupMode?: CleanupMode;
}

/** What running one step produced. */
export interface StepRun {
  readonly status: number;
  readonly output: string;
  readonly outputs: Record<string, string>;
  readonly npmInvocations: readonly string[];
  /** Linux-shaped `mktemp -d` roots allocated by the workflow step. */
  readonly temporaryRoots: readonly string[];
}

/**
 * Reads a stub's append-only invocation log.
 * @param logPath Where the stub appended.
 * @returns One entry per invocation.
 */
function readLog(logPath: string): readonly string[] {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
}

/**
 * Parses the `key=value` lines a step wrote to `$GITHUB_OUTPUT`.
 * @param outputFile The file the step appended to.
 * @returns The outputs the step declared.
 */
function readOutputs(outputFile: string): Record<string, string> {
  const outputs: Record<string, string> = {};
  const lines = fs.readFileSync(outputFile, "utf8").split("\n");
  for (const line of lines) {
    const at = line.indexOf("=");
    if (at > 0) outputs[line.slice(0, at)] = line.slice(at + 1);
  }
  return outputs;
}

/**
 * The literal environment the workflow declares on the resolve step.
 * @returns The step's `env:` block, as strings.
 * @throws {Error} When a value carries an unexpanded `${{ }}` expression.
 */
function declaredEnv(): Record<string, string> {
  const entries = Object.entries(resolveStep().env ?? {}).map(
    ([key, value]) => [key, String(value)] as const
  );
  const expression = entries.find(([, value]) => value.includes("${{"));
  if (expression)
    throw new Error(`step env ${expression[0]} carries an expression`);
  return Object.fromEntries(entries);
}

/**
 * Builds the tarball the stubbed `npm pack` hands back.
 * @param workdir Scratch directory.
 * @param mode Whether the tarball carries the resolver.
 * @returns Absolute path to the tarball.
 */
function buildTarball(workdir: string, mode: PackMode): string {
  const staged = path.join(workdir, "staged");
  const scripts = path.join(
    staged,
    "package",
    "all",
    "copy-overwrite",
    "scripts"
  );
  const tarball = path.join(workdir, "lisa.tgz");
  fs.ensureDirSync(scripts);
  // The `no-resolver` shape is real: 2.x tarballs ship this directory WITHOUT
  // lisa-gates.mjs, so a project pinned there cannot resolve its own block.
  if (mode === "no-resolver")
    fs.writeFileSync(path.join(scripts, "lisa-work-item.mjs"), "// present\n");
  else
    fs.copySync(
      path.join(REPO_ROOT, "all", "copy-overwrite", "scripts"),
      scripts
    );
  boundedSpawnSync({
    label: "packing the stub tarball",
    command: "/usr/bin/tar",
    args: ["-czf", tarball, "-C", staged, "package"],
    cwd: workdir,
  });
  return tarball;
}

/**
 * Writes the `npm` and `bundle` stubs onto a scratch `$PATH`.
 * @param workdir Scratch directory.
 * @param mode How `npm pack` behaves.
 * @param cleanupMode How the exact workflow cleanup command behaves.
 * @returns The bin directory and the npm invocation log path.
 */
function buildBin(
  workdir: string,
  mode: PackMode,
  cleanupMode: CleanupMode
): {
  readonly bin: string;
  readonly log: string;
  readonly temporaryRootsLog: string;
} {
  const bin = path.join(workdir, "bin");
  const log = path.join(workdir, "npm-invocations.log");
  const temporaryRootsLog = path.join(workdir, "temporary-roots.log");
  const tarball = buildTarball(workdir, mode);
  const npm = [
    "#!/bin/sh",
    `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
    mode === "fail" ? "exit 1" : "",
    'dest=""; prev=""',
    'for arg in "$@"; do',
    '  if [ "$prev" = "--pack-destination" ]; then dest="$arg"; fi',
    '  prev="$arg"',
    "done",
    `cp ${JSON.stringify(tarball)} "$dest/lisa.tgz"`,
    "echo lisa.tgz",
  ].join("\n");
  // `bundle` stands in for the prover a project names, so "the declared gate
  // ran" is observable rather than inferred.
  const bundle = '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$BUNDLE_LOG"\n';
  // GNU `mktemp -d` honors TMPDIR and defaults to `tmp.XXXXXX`; BSD mktemp
  // does not. Shadowing only the exact workflow call makes that Linux
  // lifecycle reproducible on every development platform.
  const mktemp = [
    "#!/bin/sh",
    'if [ "$#" -ne 1 ] || [ "$1" != "-d" ]; then exit 64; fi',
    'root=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/tmp.XXXXXX") || exit $?',
    `printf '%s\\n' "$root" >> ${JSON.stringify(temporaryRootsLog)}`,
    "printf '%s\\n' \"$root\"",
  ].join("\n");
  // Remove the exact root first, then report failure. The workflow must turn
  // the command failure into a red verdict without making this test itself
  // contaminate the supervised namespace it is verifying.
  const failingRm = '#!/bin/sh\n/bin/rm "$@"\nexit 1\n';
  fs.ensureDirSync(bin);
  fs.writeFileSync(path.join(bin, "npm"), `${npm}\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "bundle"), bundle, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "mktemp"), `${mktemp}\n`, { mode: 0o755 });
  if (cleanupMode === "fail") {
    fs.writeFileSync(path.join(bin, "rm"), failingRm, { mode: 0o755 });
  }
  return { bin, log, temporaryRootsLog };
}

/**
 * Materialises the project and runs the resolve step inside it.
 * @param repo The project directory.
 * @param project What the project declares.
 * @param outputFile Stand-in for `$GITHUB_OUTPUT`.
 * @param bin Scratch `$PATH` entry holding the stubs.
 * @returns The raw spawn result.
 */
function runStepIn(
  repo: string,
  project: Project,
  outputFile: string,
  bin: string
): SpawnSyncReturns<string> {
  const env = {
    ...process.env,
    ...declaredEnv(),
    GITHUB_OUTPUT: outputFile,
    PATH: `${bin}:${process.env["PATH"] ?? ""}`,
  };
  fs.ensureDirSync(repo);
  fs.writeFileSync(path.join(repo, "package.json"), project.packageJson);
  if (project.config !== null)
    fs.writeFileSync(path.join(repo, ".lisa.config.json"), project.config);
  fs.writeFileSync(outputFile, "");
  return boundedSpawnSync({
    label: "the quality-rails learnings-budget resolve step",
    command: BASH,
    args: ["-c", resolveStep().run ?? ""],
    cwd: repo,
    env,
    baseMs: 30_000,
  });
}

/**
 * Runs the gate resolution step against a project.
 * @param workdir Scratch directory, one per test.
 * @param project The project to resolve against.
 * @returns Exit status, log output, `$GITHUB_OUTPUT` keys, and npm calls.
 */
export function runResolve(workdir: string, project: Project): StepRun {
  const outputFile = path.join(workdir, "github-output");
  const { bin, log, temporaryRootsLog } = buildBin(
    workdir,
    project.packMode ?? "ok",
    project.cleanupMode ?? "ok"
  );
  const result = runStepIn(
    path.join(workdir, "repo"),
    project,
    outputFile,
    bin
  );
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    outputs: readOutputs(outputFile),
    npmInvocations: readLog(log),
    temporaryRoots: readLog(temporaryRootsLog),
  };
}

/**
 * Runs the step that executes a project's own declared prover.
 * @param workdir Scratch directory that already holds the stub bin.
 * @param outputs Resolved outputs from `runResolve`.
 * @returns What the declared prover was invoked with, one line per call.
 */
export function runDeclaredProver(
  workdir: string,
  outputs: Record<string, string>
): readonly string[] {
  const bundleLog = path.join(workdir, "bundle.log");
  const env = {
    ...process.env,
    BUNDLE_LOG: bundleLog,
    GATE_RUNNER: outputs["runner"] ?? "",
    GATE_TASK: outputs["task"] ?? "",
    PATH: `${path.join(workdir, "bin")}:${process.env["PATH"] ?? ""}`,
  };
  boundedSpawnSync({
    label: "the declared learnings-budget prover",
    command: BASH,
    args: ["-c", step(one => one.name === DECLARED_PROVER_STEP).run ?? ""],
    cwd: path.join(workdir, "repo"),
    env,
  });
  return readLog(bundleLog);
}
