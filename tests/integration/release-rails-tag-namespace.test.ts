/**
 * The Rails release path must not share one `vX.Y.Z` tag namespace across
 * environments.
 *
 * `release.yml` was given environment-scoped release tags in July 2026, but
 * `release-rails.yml` is a separate implementation that never received the
 * change: it ran bare `standard-version` and `git push --follow-tags` on
 * whatever branch triggered it, so `dev`, `staging` and `main` all cut clean
 * `vX.Y.Z` tags into one repo-global namespace. A version cut on one branch
 * then collided with the same version cut on another, the push was rejected,
 * the release job failed, and the Deploy job that depends on it was SKIPPED —
 * a branch that looks released with nothing deployed (CodySwannGT/lisa#3467).
 *
 * These cases execute the real step extracted from the workflow rather than
 * asserting on its text, because the defect was behavioural: the previous
 * implementation contained no wrong string, it simply named every tag the same
 * way on every branch. The assertion that discriminates against it is that
 * `dev` and `staging` no longer produce the same tag.
 *
 * The `npx standard-version@9` line is dropped before execution — it needs the
 * network and a conventional-commit history, and it is not what these cases
 * are about. Everything after it, which is the whole of the fix, runs as
 * written.
 * @module tests/integration/release-rails-tag-namespace
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import * as fs from "fs-extra";
import yaml from "js-yaml";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { cleanGitEnv, resolveGit } from "../support/git-executable.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RELEASE_RAILS_YML = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "release-rails.yml"
);

const GIT_BIN = resolveGit();
const BASH_BIN = "/bin/bash";

/** The version these cases bump to, fixed so tags are predictable. */
const VERSION = "1.4.2";

/** `VERSION` with its dots escaped, for building tag-shape expectations. */
const VERSION_RE = VERSION.replace(/\./g, "\\.");

/** Hermetic git environment: no inherited GIT_* state, no developer config. */
const GIT_ENV: NodeJS.ProcessEnv = {
  ...cleanGitEnv(),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

/** Minimal shape of the parsed workflow these cases read. */
interface RailsReleaseWorkflow {
  readonly jobs: Record<
    string,
    {
      readonly steps?: ReadonlyArray<{
        readonly id?: string;
        readonly name?: string;
        readonly run?: string;
      }>;
    }
  >;
}

/** What one execution of the extracted version step produced. */
interface StepRun {
  readonly status: number | null;
  /** stdout and stderr combined: `::error::` is a stdout annotation. */
  readonly output: string;
  readonly outputs: Record<string, string>;
}

let versionStepScript = "";
let releaseStepScript = "";
const scratchRoots: string[] = [];

/**
 * Reads one step's `run` body out of the release job.
 * @param workflow - The parsed workflow.
 * @param id - The step's `id`, or its `name` when it carries no id.
 * @returns The step's shell body.
 */
function stepScript(workflow: RailsReleaseWorkflow, id: string): string {
  const steps = workflow.jobs.release?.steps ?? [];
  const step = steps.find(s => s.id === id || s.name === id);

  if (!step?.run) {
    throw new Error(`No step with id or name "${id}" in release-rails.yml`);
  }
  return step.run;
}

/**
 * Runs one git command in a scratch repository.
 * @param root - Repository to run in.
 * @param args - Arguments, excluding the executable.
 */
function git(root: string, ...args: readonly string[]): void {
  boundedSpawnSync({
    label: `git ${args[0] ?? ""}`,
    command: GIT_BIN,
    args: [...args],
    cwd: root,
    env: GIT_ENV,
  });
}

/**
 * Builds a throwaway git repository holding one commit and a VERSION file.
 * @returns Absolute path to the repository.
 */
function scratchRepo(): string {
  const base = fs.realpathSync(process.env["TMPDIR"] ?? "/tmp");
  const root = fs.mkdtempSync(path.join(base, "rails-tag-"));

  scratchRoots.push(root);
  git(root, "init", "--quiet", "--initial-branch=main");
  git(root, "config", "user.name", "t");
  git(root, "config", "user.email", "t@example.com");
  fs.writeFileSync(path.join(root, "VERSION"), `${VERSION}\n`);
  git(root, "add", "VERSION");
  git(root, "commit", "--quiet", "-m", "chore(release): 1.4.2");
  return root;
}

/**
 * Builds a repository where `vX.Y.Z` already points at an earlier commit.
 * @returns Absolute path to the repository.
 */
function repoWithPriorTag(): string {
  const root = scratchRepo();

  git(root, "tag", "-a", `v${VERSION}`, "-m", "prior release", "HEAD");
  fs.writeFileSync(path.join(root, "later.txt"), "later\n");
  git(root, "add", "later.txt");
  git(root, "commit", "--quiet", "-m", "feat: later");
  return root;
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
  const outputs: Record<string, string> = {};

  for (const line of raw.split("\n")) {
    const index = line.indexOf("=");

    if (index > 0) {
      outputs[line.slice(0, index)] = line.slice(index + 1);
    }
  }
  return outputs;
}

/**
 * Runs the extracted version step for one branch.
 * @param branch - Value of the step's BRANCH environment variable.
 * @param root - Repository to run in; a fresh one when omitted.
 * @returns Exit status, combined output, and parsed step outputs.
 */
function runVersionStep(branch: string, root: string = scratchRepo()): StepRun {
  // Drop only the bump itself; every line the fix added runs as written.
  const script = versionStepScript
    .split("\n")
    .filter(line => !line.includes("standard-version@9"))
    .join("\n");
  const outputPath = path.join(root, "step-output.txt");
  const result = boundedSpawnSync({
    label: "release-rails version step",
    command: BASH_BIN,
    // `-e` because that is the shell GitHub Actions gives a `run:` block
    // (`bash -e {0}`); without it a failing command mid-step would pass here
    // and fail in CI.
    args: ["-e", "-c", script],
    cwd: root,
    env: { ...GIT_ENV, BRANCH: branch, GITHUB_OUTPUT: outputPath },
  });

  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    outputs: parseStepOutputs(outputPath),
  };
}

describe("release-rails.yml environment-scoped tags (#3467)", () => {
  beforeAll(() => {
    const workflow = yaml.load(
      fs.readFileSync(RELEASE_RAILS_YML, "utf8")
    ) as RailsReleaseWorkflow;

    versionStepScript = stepScript(workflow, "version");
    releaseStepScript = stepScript(workflow, "Create GitHub Release");
  });

  afterEach(() => {
    for (const root of scratchRoots.splice(0)) {
      fs.removeSync(root);
    }
  });

  it("cuts a clean vX.Y.Z on every production branch name", () => {
    for (const branch of ["main", "master", "prod", "production"]) {
      const run = runVersionStep(branch);

      expect(run.status).toBe(0);
      expect(run.outputs["tag"]).toBe(`v${VERSION}`);
    }
  });

  it("gives each non-production branch its own tag namespace", () => {
    const dev = runVersionStep("dev");
    const staging = runVersionStep("staging");

    expect(dev.status).toBe(0);
    expect(staging.status).toBe(0);
    expect(dev.outputs["tag"]).toMatch(
      new RegExp(`^v${VERSION_RE}-dev\\.\\d+$`)
    );
    expect(staging.outputs["tag"]).toMatch(
      new RegExp(`^v${VERSION_RE}-staging\\.\\d+$`)
    );

    // The collision the ticket is about: same version, two branches. Before
    // this change both produced exactly "v1.4.2".
    expect(dev.outputs["tag"]).not.toBe(staging.outputs["tag"]);
  });

  it("keeps VERSION clean so the next bump is never fed a prerelease string", () => {
    const root = scratchRepo();
    const run = runVersionStep("staging", root);

    expect(run.outputs["version"]).toBe(VERSION);
    expect(fs.readFileSync(path.join(root, "VERSION"), "utf8").trim()).toBe(
      VERSION
    );
    // The suffix belongs to the tag alone.
    expect(run.outputs["tag"]).toContain("-staging.");
  });

  it("flattens a branch name that is legal in a ref but not in a semver label", () => {
    const run = runVersionStep("release/2026-09");

    expect(run.status).toBe(0);
    expect(run.outputs["tag"]).toMatch(
      new RegExp(`^v${VERSION_RE}-release-2026-09\\.\\d+$`)
    );
    expect(run.outputs["tag"]).not.toContain("/");
  });

  it("refuses a production tag that already points at a different commit", () => {
    const root = repoWithPriorTag();
    const run = runVersionStep("main", root);

    // Loud and diagnosable, rather than a rejected ref from `git push` that
    // says nothing about what to do.
    expect(run.status).toBe(1);
    expect(run.output).toContain("::error::");
    expect(run.output).toContain(`Tag v${VERSION} already exists`);
    expect(run.output).toContain("align VERSION past the latest existing tag");
  });

  it("reuses an existing release on rerun instead of failing the deploy behind it", () => {
    // A release job that dies here takes the Deploy job with it, because
    // Deploy `needs:` the release — the silent half of #3467.
    expect(releaseStepScript).toContain('gh release view "$TAG"');
    expect(releaseStepScript).toContain("exit 0");
    expect(releaseStepScript).toContain('gh release create "$TAG"');
  });
});
