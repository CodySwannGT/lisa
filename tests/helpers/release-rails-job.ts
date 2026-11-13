/**
 * Executes the `release` job of `.github/workflows/release-rails.yml` against
 * a local bare remote, so release behaviour is proven by running the shipped
 * shell rather than by reading its text.
 *
 * The harness runs every `run:` step of the job in order, exactly as written,
 * after rendering the handful of `${{ }}` expressions those steps use. Three
 * things stand in for GitHub:
 *
 * - A bare repository is the remote. Each clone rewrites
 *   `git@github.com:<repository>.git` to it with `url.<bare>.insteadOf`, so a
 *   step that re-points `origin` at the deploy-key URL still reaches it.
 * - `npx` is `__fixtures__/standard-version-npx-stub.sh` on PATH, which plays
 *   `standard-version`: it bumps the patch in VERSION (or writes
 *   `--release-as`), commits `chore(release): X.Y.Z`, and logs every command
 *   line it receives, so a case can assert that the workflow's own invocation
 *   is what ran.
 * - The stub can land a concurrent merge on the remote while it "bumps",
 *   which reproduces the real race window: a run fetches, bumps, and by the
 *   time it pushes the branch has moved.
 *
 * The skip-detection step and `Create GitHub Release` are not executed (they
 * need the GitHub API); the release step's `if:` is evaluated with GitHub's
 * own expression interpreter so a case can assert whether it would run.
 * @module tests/helpers/release-rails-job
 */
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import * as fs from "fs-extra";
import yaml from "js-yaml";

import { githubCondition } from "./github-expression.js";
import { boundedSpawnSync } from "./io-latency-budget.js";
import { cleanGitEnv, resolveGit } from "../support/git-executable.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The workflow under test. */
export const RELEASE_RAILS_YML = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "release-rails.yml"
);

/** The `standard-version` stand-in installed as `npx`. */
const NPX_STUB = path.join(
  __dirname,
  "__fixtures__",
  "standard-version-npx-stub.sh"
);

const GIT_BIN = resolveGit();
const BASH_BIN = "/bin/bash";

/** The `github.repository` value the steps see. */
const REPOSITORY = "example-org/example-app";

/** Steps that talk to GitHub and are therefore not executed. */
const SKIP_STEP = "Check for skip conditions";
const RELEASE_STEP = "Create GitHub Release";

/** Hermetic git environment: no inherited GIT_* state, no developer config. */
export const GIT_ENV: NodeJS.ProcessEnv = {
  ...cleanGitEnv(),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

/** Minimal shape of one workflow step. */
interface WorkflowStep {
  readonly id?: string;
  readonly name?: string;
  readonly if?: string;
  readonly run?: string;
  readonly env?: Record<string, string>;
}

/** Minimal shape of the parsed workflow. */
interface RailsReleaseWorkflow {
  readonly jobs: Record<string, { readonly steps?: readonly WorkflowStep[] }>;
}

/** A bare remote plus the scratch directory that owns it. */
export interface ReleaseFixture {
  readonly base: string;
  readonly remote: string;
  readonly branch: string;
  readonly stubBin: string;
}

/** A concurrent merge the npx stub lands while the run bumps. */
export interface RaceSpec {
  /** Clone the concurrent merges are committed from. */
  readonly clone: string;
  /** How many bump invocations each land one concurrent merge first. */
  readonly landings: number;
  /** When set, force the branch back to this commit instead of merging. */
  readonly rewindTo?: string;
}

/** What one execution of the release job produced. */
export interface ReleaseRun {
  readonly status: number | null;
  /** stdout and stderr of every executed step, in order. */
  readonly output: string;
  /** Step outputs keyed by step id. */
  readonly outputs: Record<string, Record<string, string>>;
  /** Every command line the npx stub received. */
  readonly npxCalls: readonly string[];
  /** Whether `Create GitHub Release` would run after these steps. */
  readonly createsGithubRelease: boolean;
}

/**
 * Runs git and returns its trimmed stdout.
 * @param cwd - Directory to run in.
 * @param args - Arguments, excluding the executable.
 * @returns Trimmed stdout.
 */
export function git(cwd: string, ...args: readonly string[]): string {
  const result = boundedSpawnSync({
    label: `git ${args[0] ?? ""}`,
    command: GIT_BIN,
    args: [...args],
    cwd,
    env: GIT_ENV,
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr ?? ""}`);
  }
  return (result.stdout ?? "").trim();
}

/**
 * Whether `ancestor` is reachable from `descendant` in `cwd`.
 * @param cwd - Repository to ask.
 * @param ancestor - Candidate ancestor ref.
 * @param descendant - Candidate descendant ref.
 * @returns True when the ancestry holds.
 */
export function isAncestor(
  cwd: string,
  ancestor: string,
  descendant: string
): boolean {
  const result = boundedSpawnSync({
    label: "git merge-base",
    command: GIT_BIN,
    args: ["merge-base", "--is-ancestor", ancestor, descendant],
    cwd,
    env: GIT_ENV,
  });

  return result.status === 0;
}

/**
 * Lists the tags on a repository.
 * @param cwd - Repository to ask.
 * @returns Tag names, sorted.
 */
export function tags(cwd: string): readonly string[] {
  return git(cwd, "tag", "--list")
    .split("\n")
    .filter(name => name !== "")
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Configures a working repository's identity.
 * @param cwd - Repository to configure.
 */
function identify(cwd: string): void {
  git(cwd, "config", "user.name", "t");
  git(cwd, "config", "user.email", "t@example.com");
}

/**
 * Builds a bare remote whose `branch` holds one commit with a VERSION file.
 * The caller owns `base` and removes it after the case.
 * @param baseVersion - Content of the seeded VERSION file.
 * @param branch - Branch the release runs on.
 * @returns The fixture handles.
 */
export function releaseFixture(
  baseVersion: string,
  branch: string
): ReleaseFixture {
  // `os.tmpdir()` honours TMPDIR, which the scratch setup points at a run
  // root it owns and reclaims.
  const tmp = fs.realpathSync(os.tmpdir());
  const base = fs.mkdtempSync(path.join(tmp, "rails-release-"));
  const remote = path.join(base, "remote.git");
  const seed = path.join(base, "seed");
  const stubBin = path.join(base, "bin");

  fs.mkdirpSync(stubBin);
  fs.copyFileSync(NPX_STUB, path.join(stubBin, "npx"));
  fs.chmodSync(path.join(stubBin, "npx"), 0o700);
  git(base, "init", "--quiet", "--bare", `--initial-branch=${branch}`, remote);
  fs.mkdirpSync(seed);
  git(seed, "init", "--quiet", `--initial-branch=${branch}`);
  identify(seed);
  fs.writeFileSync(path.join(seed, "VERSION"), `${baseVersion}\n`);
  git(seed, "add", "VERSION");
  git(seed, "commit", "--quiet", "-m", "feat: initial");
  git(seed, "push", "--quiet", remote, `HEAD:refs/heads/${branch}`);
  return { base, remote, branch, stubBin };
}

/**
 * Clones the fixture's remote the way `actions/checkout` would.
 * @param fixture - The fixture to clone.
 * @param name - Directory name for the clone.
 * @returns Absolute path to the clone.
 */
export function cloneRemote(fixture: ReleaseFixture, name: string): string {
  const dir = path.join(fixture.base, name);

  git(
    fixture.base,
    "clone",
    "--quiet",
    "--branch",
    fixture.branch,
    fixture.remote,
    dir
  );
  identify(dir);
  git(
    dir,
    "config",
    `url.${fixture.remote}.insteadOf`,
    `git@github.com:${REPOSITORY}.git`
  );
  return dir;
}

/**
 * Commits one file in a clone and pushes it to the remote branch: a merge.
 * @param fixture - The fixture whose remote receives the merge.
 * @param clone - Clone to commit from.
 * @param file - File name to create.
 * @returns The merged commit's SHA.
 */
export function landMerge(
  fixture: ReleaseFixture,
  clone: string,
  file: string
): string {
  git(clone, "fetch", "--quiet", "origin", fixture.branch);
  git(clone, "reset", "--quiet", "--hard", `origin/${fixture.branch}`);
  fs.writeFileSync(path.join(clone, file), `${file}\n`);
  git(clone, "add", file);
  git(clone, "commit", "--quiet", "-m", `feat: ${file}`);
  git(clone, "push", "--quiet", "origin", `HEAD:refs/heads/${fixture.branch}`);
  return git(clone, "rev-parse", "HEAD");
}

/**
 * Renders the `${{ }}` expressions the release job's run steps use.
 * @param text - Step source or env value.
 * @param branch - The `github.ref_name` value.
 * @returns The rendered text.
 */
function render(text: string, branch: string): string {
  return text.replace(/\$\{\{([^}]*)\}\}/gu, (_whole, raw: string) => {
    const expr = raw.trim();

    if (expr === "github.ref_name") return branch;
    if (expr === "github.repository") return REPOSITORY;
    if (expr.startsWith("secrets.")) return "";
    throw new Error(`release-rails harness cannot render \${{ ${expr} }}`);
  });
}

/**
 * Parses the `key=value` lines a step wrote to `$GITHUB_OUTPUT`.
 * @param outputPath - Path the step was given as GITHUB_OUTPUT.
 * @returns The step's outputs.
 */
function parseStepOutputs(outputPath: string): Record<string, string> {
  const raw = fs.existsSync(outputPath)
    ? fs.readFileSync(outputPath, "utf8")
    : "";

  return Object.fromEntries(
    raw
      .split("\n")
      .filter(line => line.indexOf("=") > 0)
      .map(line => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)] as const;
      })
  );
}

/**
 * Reads the release job's steps from the workflow as it is on disk now.
 * @returns The job's steps.
 */
function releaseSteps(): readonly WorkflowStep[] {
  const workflow = yaml.load(
    fs.readFileSync(RELEASE_RAILS_YML, "utf8")
  ) as RailsReleaseWorkflow;

  return workflow.jobs["release"]?.steps ?? [];
}

/** What one executed step produced. */
interface StepResult {
  readonly id: string | undefined;
  readonly status: number | null;
  readonly output: string;
  readonly outputs: Record<string, string>;
}

/** Everything one step execution needs besides the step itself. */
interface StepContext {
  readonly fixture: ReleaseFixture;
  readonly clone: string;
  /** This invocation's own scratch directory: npx log and step outputs. */
  readonly runDir: string;
  readonly npxLog: string;
  readonly race: RaceSpec | undefined;
}

/**
 * Executes one `run:` step the way GitHub Actions would.
 * @param step - The step to execute.
 * @param index - Its position in the job, for a unique output file.
 * @param ctx - The run's fixture, checkout, npx log and race.
 * @returns What the step produced.
 */
function runStep(
  step: WorkflowStep,
  index: number,
  ctx: StepContext
): StepResult {
  const { fixture, clone, runDir, npxLog, race } = ctx;
  // Per invocation, so a rerun never reads the outputs of the run before it.
  const outputPath = path.join(runDir, `step-${index}-output.txt`);
  const stepEnv = Object.fromEntries(
    Object.entries(step.env ?? {}).map(([k, v]) => [
      k,
      render(String(v), fixture.branch),
    ])
  );
  const result = boundedSpawnSync({
    label: `release-rails step ${step.id ?? step.name ?? index}`,
    command: BASH_BIN,
    // `bash -e` is the shell GitHub Actions gives a `run:` block.
    args: ["-e", "-c", render(step.run ?? "", fixture.branch)],
    cwd: clone,
    env: {
      ...GIT_ENV,
      ...stepEnv,
      PATH: `${fixture.stubBin}:${GIT_ENV["PATH"] ?? ""}`,
      NPX_LOG: npxLog,
      GITHUB_OUTPUT: outputPath,
      GITHUB_REF_NAME: fixture.branch,
      GITHUB_REPOSITORY: REPOSITORY,
      RACE_CLONE: race?.clone ?? "",
      RACE_LANDINGS: String(race?.landings ?? 0),
      RACE_REWIND_TO: race?.rewindTo ?? "",
      RACE_BRANCH: fixture.branch,
    },
  });

  return {
    id: step.id,
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    outputs: parseStepOutputs(outputPath),
  };
}

/**
 * Executes the release job's run steps in `clone`, stopping at the first
 * failing step as GitHub Actions does.
 * @param fixture - The fixture whose remote the run pushes to.
 * @param clone - The checkout the run starts from (its HEAD is the trigger).
 * @param race - Optional concurrent merges landed during the bump.
 * @returns What the run produced.
 */
export function runReleaseJob(
  fixture: ReleaseFixture,
  clone: string,
  race?: RaceSpec
): ReleaseRun {
  const runDir = fs.mkdtempSync(path.join(fixture.base, "run-"));
  const npxLog = path.join(runDir, "npx.log");
  const steps = releaseSteps();
  const releaseStep = steps.find(s => s.name === RELEASE_STEP);
  const ctx: StepContext = { fixture, clone, runDir, npxLog, race };
  const results = steps.reduce<readonly StepResult[]>(
    (done, step, index) =>
      done.some(r => r.status !== 0) ||
      !step.run ||
      step.name === SKIP_STEP ||
      step.name === RELEASE_STEP
        ? done
        : [...done, runStep(step, index, ctx)],
    []
  );
  const status = results.find(r => r.status !== 0)?.status ?? 0;
  const outputs: Record<string, Record<string, string>> = {
    skip: { skip: "false" },
    ...Object.fromEntries(
      results.flatMap(r => (r.id ? [[r.id, r.outputs] as const] : []))
    ),
  };
  const context = {
    github: { ref_name: fixture.branch },
    steps: Object.fromEntries(
      Object.entries(outputs).map(([id, values]) => [id, { outputs: values }])
    ),
  };

  return {
    status,
    output: results.map(r => r.output).join(""),
    outputs,
    // The stub creates its log on first call; no log means it never ran.
    npxCalls: (fs.existsSync(npxLog) ? fs.readFileSync(npxLog, "utf8") : "")
      .split("\n")
      .filter(line => line !== ""),
    createsGithubRelease:
      status === 0 && githubCondition(releaseStep?.if ?? "true", context),
  };
}
