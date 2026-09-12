/**
 * Every release strategy must scope its tags per environment, and the one
 * strategy that must not must fail loudly instead.
 *
 * `release.yml`'s `Determine Version` step was given environment-scoped
 * release tags in July 2026, but the scoping was gated on
 * `release_strategy == 'standard-version'`. The other three strategies —
 * `semantic`, `calendar` and `custom` — fell through to the unscoped path and
 * kept sharing a single repo-global `vX.Y.Z` namespace across `dev`, `staging`
 * and `main`. A promote or a `main -> staging` sync-back then carried a version
 * one branch had already released onto another, which is the shape of
 * CodySwannGT/lisa#3467: the release job dies on a taken tag and the deploy
 * behind it never runs.
 *
 * `custom` is the deliberate exception. An explicitly pinned version must never
 * be silently renamed, so it keeps the clean tag and refuses a collision by
 * name rather than routing around it.
 *
 * These cases execute the real step extracted from the workflow rather than
 * asserting on its text, because the defect is behavioural: the previous
 * implementation contained no wrong string, it simply named every non-prod tag
 * the way it named the production one. The assertion that discriminates against
 * it is that `dev` and `staging` no longer produce the same tag.
 *
 * Offline by construction: `npx` is shimmed onto PATH to resolve `semver` from
 * this repository's `node_modules`, and the scratch `package.json` carries no
 * `name`, which is what makes the production path skip its `npm view` lookup.
 * @module tests/integration/release-strategy-tag-namespace
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
const RELEASE_YML = path.join(REPO_ROOT, ".github", "workflows", "release.yml");

const GIT_BIN = resolveGit();
const BASH_BIN = "/bin/bash";

/** The version `main` has already released in these fixtures. */
const RELEASED = "1.6.0";

/** `RELEASED` with its dots escaped, for building tag-shape expectations. */
const RELEASED_RE = RELEASED.replace(/\./g, "\\.");

/** Hermetic git environment: no inherited GIT_* state, no developer config. */
const GIT_ENV: NodeJS.ProcessEnv = {
  ...cleanGitEnv(),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

/** Minimal shape of the parsed workflow these cases read. */
interface ReleaseWorkflow {
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

/** The `env:` values one run gives the step. */
interface StepInputs {
  readonly strategy: string;
  readonly environment: string;
  readonly prerelease?: string;
  readonly customVersion?: string;
}

let versionStepScript = "";
const scratchRoots: string[] = [];

/**
 * Reads the `Determine Version` step's `run` body out of the version job.
 * @param workflow - The parsed workflow.
 * @returns The step's shell body.
 */
function versionStep(workflow: ReleaseWorkflow): string {
  const steps = workflow.jobs.version?.steps ?? [];
  const step = steps.find(s => s.id === "version");

  if (!step?.run) {
    throw new Error('No step with id "version" in release.yml');
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
 * Writes an offline `npx` shim and returns the directory holding it.
 *
 * The step shells out to `npx semver` on the `semantic` path and on the
 * collision guard. Resolving it from this repository's `node_modules` keeps
 * these cases off the network without changing the line under test.
 * @param root - Scratch repository the shim lives beside.
 * @returns Directory to prepend to PATH.
 */
function npxShim(root: string): string {
  const binDir = path.join(root, ".shim-bin");
  const semverBin = path.join(REPO_ROOT, "node_modules", ".bin", "semver");
  const shim = [
    "#!/bin/sh",
    'if [ "$1" = "semver" ]; then',
    "  shift",
    `  exec ${JSON.stringify(semverBin)} "$@"`,
    "fi",
    'echo "npx shim: unexpected tool $1" >&2',
    "exit 127",
    "",
  ].join("\n");

  fs.mkdirpSync(binDir);
  fs.writeFileSync(path.join(binDir, "npx"), shim, { mode: 0o755 });
  return binDir;
}

/**
 * Builds a repository shaped like a staging branch that has not taken the
 * release `main` already cut.
 *
 * `staging` is HEAD and carries a `feat:` commit, so the `semantic` strategy
 * computes a minor bump off the last tag it can see (`v1.5.0`) and lands on
 * exactly the version `main` released on a branch of its own (`v1.6.0`).
 * @returns Absolute path to the repository.
 */
function scratchRepo(): string {
  const base = fs.realpathSync(process.env["TMPDIR"] ?? "/tmp");
  const root = fs.mkdtempSync(path.join(base, "rel-strategy-"));

  scratchRoots.push(root);
  git(root, "init", "--quiet", "--initial-branch=staging");
  git(root, "config", "user.name", "t");
  git(root, "config", "user.email", "t@example.com");
  // No `name`: the production path reads it to compare against npm's published
  // version, and an empty name is what makes that lookup skip.
  fs.writeJsonSync(path.join(root, "package.json"), { private: true });
  git(root, "add", "package.json");
  git(root, "commit", "--quiet", "-m", "chore: base");
  git(root, "tag", "v1.5.0");

  // What `main` released, on a branch staging has not merged.
  git(root, "checkout", "--quiet", "-b", "main");
  fs.writeFileSync(path.join(root, "released.txt"), "released\n");
  git(root, "add", "released.txt");
  git(root, "commit", "--quiet", "-m", `chore(release): ${RELEASED}`);
  git(root, "tag", `v${RELEASED}`);

  git(root, "checkout", "--quiet", "staging");
  fs.writeFileSync(path.join(root, "work.txt"), "work\n");
  git(root, "add", "work.txt");
  git(root, "commit", "--quiet", "-m", "feat: staging work");
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
 * Runs the extracted version step under one set of workflow inputs.
 *
 * `release-logger.sh` is written by an earlier step in the job and is not what
 * these cases are about, so the `source` line is dropped and the one function
 * it provides is stubbed. Everything else runs as written.
 * @param inputs - The step's `env:` values for this run.
 * @param root - Repository to run in; a fresh one when omitted.
 * @returns Exit status, combined output, and parsed step outputs.
 */
function runVersionStep(
  inputs: StepInputs,
  root: string = scratchRepo()
): StepRun {
  const body = versionStepScript
    .split("\n")
    .filter(line => !line.includes("release-logger.sh"))
    .join("\n");
  const script = `log_release_event() { :; }\n${body}`;
  const outputPath = path.join(root, "step-output.txt");
  const summaryPath = path.join(root, "step-summary.md");
  const result = boundedSpawnSync({
    label: "release.yml version step",
    command: BASH_BIN,
    // `-e` because that is the shell GitHub Actions gives a `run:` block
    // (`bash -e {0}`); without it a failing command mid-step would pass here
    // and fail in CI.
    args: ["-e", "-c", script],
    cwd: root,
    env: {
      ...GIT_ENV,
      PATH: `${npxShim(root)}:${process.env["PATH"] ?? ""}`,
      GITHUB_OUTPUT: outputPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      RELEASE_STRATEGY: inputs.strategy,
      RELEASE_ENVIRONMENT: inputs.environment,
      RELEASE_PRERELEASE: inputs.prerelease ?? "",
      RELEASE_CUSTOM_VERSION: inputs.customVersion ?? "",
    },
  });

  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    outputs: parseStepOutputs(outputPath),
  };
}

describe("release.yml per-strategy tag namespaces (#3741)", () => {
  beforeAll(() => {
    const workflow = yaml.load(
      fs.readFileSync(RELEASE_YML, "utf8")
    ) as ReleaseWorkflow;

    versionStepScript = versionStep(workflow);
  });

  afterEach(() => {
    for (const root of scratchRoots.splice(0)) {
      fs.removeSync(root);
    }
  });

  describe("semantic", () => {
    it("gives each non-production environment its own tag namespace", () => {
      const dev = runVersionStep({ strategy: "semantic", environment: "dev" });
      const staging = runVersionStep({
        strategy: "semantic",
        environment: "staging",
      });

      expect(dev.status).toBe(0);
      expect(staging.status).toBe(0);
      expect(dev.outputs["tag"]).toMatch(
        new RegExp(`^v${RELEASED_RE}-dev\\.\\d+$`)
      );
      expect(staging.outputs["tag"]).toMatch(
        new RegExp(`^v${RELEASED_RE}-staging\\.\\d+$`)
      );

      // The collision the ticket is about: same computed version, two
      // branches. Before this change both landed on one clean `vX.Y.Z`.
      expect(dev.outputs["tag"]).not.toBe(staging.outputs["tag"]);
    });

    it("never reuses the clean tag production already released", () => {
      const staging = runVersionStep({
        strategy: "semantic",
        environment: "staging",
      });

      expect(staging.outputs["tag"]).not.toBe(`v${RELEASED}`);
      expect(staging.outputs["prerelease"]).toBe("true");
    });

    it("keeps the version clean so the next bump is never fed a prerelease", () => {
      const staging = runVersionStep({
        strategy: "semantic",
        environment: "staging",
      });

      // The suffix belongs to the tag alone; `version` feeds package.json and
      // the changelog.
      expect(staging.outputs["version"]).toBe(RELEASED);
      expect(staging.outputs["tag"]).toContain("-staging.");
    });

    it("still cuts a clean vX.Y.Z on every production environment name", () => {
      for (const environment of ["main", "master", "prod", "production"]) {
        const run = runVersionStep({ strategy: "semantic", environment });

        expect(run.status).toBe(0);
        expect(run.outputs["tag"]).toMatch(/^v\d+\.\d+\.\d+$/);
        expect(run.outputs["prerelease"]).toBe("false");
      }
    });
  });

  describe("calendar", () => {
    it("gives each non-production environment its own tag namespace", () => {
      const dev = runVersionStep({ strategy: "calendar", environment: "dev" });
      const staging = runVersionStep({
        strategy: "calendar",
        environment: "staging",
      });

      expect(dev.status).toBe(0);
      expect(staging.status).toBe(0);
      expect(dev.outputs["tag"]).toMatch(/^v\d{4}\.\d{2}\.\d{2}-dev\.\d+$/);
      expect(staging.outputs["tag"]).toMatch(
        /^v\d{4}\.\d{2}\.\d{2}-staging\.\d+$/
      );

      // Two environments releasing on the same calendar day previously
      // computed the identical date version and the identical clean tag.
      expect(dev.outputs["tag"]).not.toBe(staging.outputs["tag"]);
    });

    it("does not append the label twice when the date already carries one", () => {
      // The calendar strategy bakes an explicit `prerelease` input into the
      // version itself, so the tag must not carry a second copy.
      const run = runVersionStep({
        strategy: "calendar",
        environment: "staging",
        prerelease: "beta",
      });

      expect(run.status).toBe(0);
      expect(run.outputs["tag"]).toMatch(/^v\d{4}\.\d{2}\.\d{2}-beta\.\d+$/);
      expect(run.outputs["tag"]).not.toContain("-staging.");
      expect(run.outputs["tag"]?.split("-").length).toBe(2);
    });

    it("still cuts a clean date tag on production", () => {
      const run = runVersionStep({
        strategy: "calendar",
        environment: "production",
      });

      expect(run.status).toBe(0);
      expect(run.outputs["tag"]).toMatch(/^v\d{4}\.\d{2}\.\d{2}$/);
    });
  });

  describe("custom", () => {
    it("refuses a pinned version whose tag is held by another commit", () => {
      const run = runVersionStep({
        strategy: "custom",
        environment: "staging",
        customVersion: RELEASED,
      });

      // Loud and diagnosable: the tag by name, and the refs that hold it, so
      // the operator can see which branch already released it.
      expect(run.status).toBe(1);
      expect(run.output).toContain("::error::");
      expect(run.output).toContain(`v${RELEASED} already exists`);
      expect(run.output).toContain("main");
      expect(run.output).toContain("custom_version");
    });

    it("does not rename or bump the pinned version it refused", () => {
      const run = runVersionStep({
        strategy: "custom",
        environment: "staging",
        customVersion: RELEASED,
      });

      // The neighbouring strategies bump patch until the tag is free. Doing
      // that here would release something other than what was pinned.
      expect(run.outputs["version"]).toBeUndefined();
      expect(run.outputs["tag"]).toBeUndefined();
      expect(run.output).not.toContain("bumping patch");
    });

    it("is never given an environment-derived prerelease label", () => {
      const run = runVersionStep({
        strategy: "custom",
        environment: "staging",
        customVersion: "2.0.0",
      });

      expect(run.status).toBe(0);
      expect(run.outputs["tag"]).toBe("v2.0.0");
      expect(run.outputs["version"]).toBe("2.0.0");
    });

    it("accepts a rerun whose tag already points at this very commit", () => {
      const root = scratchRepo();

      git(root, "tag", "v2.0.0");

      const run = runVersionStep(
        { strategy: "custom", environment: "staging", customVersion: "2.0.0" },
        root
      );

      // Same commit, same release: the Create GitHub Release step is
      // idempotent on it, so refusing here would fail a harmless rerun.
      expect(run.status).toBe(0);
      expect(run.outputs["tag"]).toBe("v2.0.0");
    });
  });
});
