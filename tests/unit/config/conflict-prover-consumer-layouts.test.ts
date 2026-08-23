/**
 * The conflict-residue fallback must find the prover in a CONSUMER tree
 * (CodySwannGT/lisa#2951).
 *
 * The reusable workflow is consumed at `@main`; the package is version-pinned.
 * When the prover moved from `scripts/` to `all/copy-overwrite/scripts/` 72
 * minutes after a release, every consumer on that release began running a
 * post-move workflow against a pre-move package, and the fallback's candidate
 * list did not contain the one path where the file actually sat:
 * `node_modules/@codyswann/lisa/scripts/check-conflict-markers.mjs`.
 *
 * Lisa's own CI structurally cannot catch this, which is why this file builds
 * consumer-shaped trees instead of asserting anything about this repository.
 * Lisa is the single repository where the HOST-relative candidate
 * `all/copy-overwrite/scripts/check-conflict-markers.mjs` resolves, so a test
 * that ran the gate here would pass against the broken list. Each fixture below
 * therefore places the prover under `node_modules/@codyswann/lisa/` ONLY, and
 * asserts up front that no host-relative candidate exists in the tree — without
 * that assertion the fixture could silently degrade into another Lisa-shaped
 * pass.
 *
 * The step's shell is not restated here. It is extracted from
 * `.github/workflows/quality.yml` and executed verbatim, so the thing under
 * test is the workflow itself rather than a paraphrase of it that can drift.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/unit/config/conflict-prover-consumer-layouts
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { load as loadYaml } from "js-yaml";
import { afterEach, describe, expect, it } from "vitest";

import { cleanGitEnv } from "../../helpers/test-utils";
import { resolveGit } from "../../support/git-executable.js";

const REPO_ROOT = process.cwd();
const GIT = resolveGit();

/**
 * The shell the runner gives a `run:` step, by absolute path.
 *
 * Absolute rather than `"bash"` so the interpreter cannot be picked up off a
 * writable `PATH` entry — the same reason `resolveGit` exists.
 */
const BASH = "/bin/bash";

/** Where the workflow lives. */
const QUALITY_YML = path.join(REPO_ROOT, ".github", "workflows", "quality.yml");

/** The job carrying the fallback under test. */
const JOB = "conflict_markers";

/** The step whose shell resolves the prover with no `gates` block present. */
const STEP_NAME = "🩹 Check for leftover conflict markers";

/** The prover, as it sits in this repository today. */
const PROVER_SOURCE = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  "scripts",
  "check-conflict-markers.mjs"
);

/** The one module the prover imports relative to itself. */
const PROVER_LIB = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  "scripts",
  "lib",
  "invoked-as-script.mjs"
);

/** The packaged path a release predating the move installs the prover at. */
const PACKAGED_OLD_LAYOUT =
  "node_modules/@codyswann/lisa/scripts/check-conflict-markers.mjs";

/** The packaged path a release carrying the move installs the prover at. */
const PACKAGED_NEW_LAYOUT =
  "node_modules/@codyswann/lisa/all/copy-overwrite/scripts/check-conflict-markers.mjs";

/** Candidates that resolve from the HOST tree rather than from the package. */
const HOST_RELATIVE_CANDIDATES = [
  "scripts/check-conflict-markers.mjs",
  "all/copy-overwrite/scripts/check-conflict-markers.mjs",
] as const;

/** What the prover prints when it has actually walked the tracked files. */
const SCAN_RAN = "no leftover conflict markers in";

/** A minimal step shape, enough to find the one under test. */
interface WorkflowStep {
  readonly name?: string;
  readonly run?: string;
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/**
 * The `run:` shell of the fallback step, read out of the workflow.
 * @returns The step's shell script, verbatim
 */
function fallbackShell(): string {
  const workflow = loadYaml(readFileSync(QUALITY_YML, "utf8")) as {
    jobs?: Record<string, { steps?: readonly WorkflowStep[] }>;
  };
  const steps = workflow.jobs?.[JOB]?.steps ?? [];
  const step = steps.find(entry => entry.name === STEP_NAME);
  if (step?.run === undefined) {
    throw new Error(`no \`run:\` on step "${STEP_NAME}" of job "${JOB}"`);
  }
  return step.run;
}

/**
 * Write the prover (and the one module it imports) at a path in a tree.
 * @param root - Absolute tree root
 * @param relative - Where the prover goes, relative to the root
 */
function installProver(root: string, relative: string): void {
  const target = path.join(root, relative);
  mkdirSync(path.join(path.dirname(target), "lib"), { recursive: true });
  copyFileSync(PROVER_SOURCE, target);
  copyFileSync(
    PROVER_LIB,
    path.join(path.dirname(target), "lib", path.basename(PROVER_LIB))
  );
}

/**
 * A clean, committed git tree shaped like a CONSUMER: the prover exists only
 * inside `node_modules/@codyswann/lisa`, never at a host-relative candidate.
 *
 * `node_modules` is deliberately left untracked, exactly as a consumer has it,
 * which also keeps the prover's own `git ls-files` walk honest.
 * @param proverPath - Candidate path to install the prover at, or undefined
 * @returns The absolute tree root
 */
function consumerTree(proverPath?: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-2951-"));
  const env = cleanGitEnv(process.env);
  const git = (...args: readonly string[]): void => {
    execFileSync(GIT, [...args], { cwd: root, env, stdio: "ignore" });
  };
  roots.push(root);
  writeFileSync(path.join(root, "README.md"), "# a consumer\n", "utf8");
  writeFileSync(path.join(root, ".gitignore"), "node_modules/\n", "utf8");
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  if (proverPath !== undefined) installProver(root, proverPath);
  return root;
}

/**
 * Drop the workflow step's shell into a tree as an executable script.
 * @param root - Absolute tree root
 * @returns Absolute path to the written script
 */
function writeStepScript(root: string): string {
  const script = path.join(root, "step.sh");
  writeFileSync(script, fallbackShell(), "utf8");
  return script;
}

/**
 * Run the workflow step's shell in a tree, the way the runner would.
 * @param root - Working directory for the step
 * @returns Exit status and combined output
 */
function runStep(root: string): { code: number; output: string } {
  const script = writeStepScript(root);
  const result = spawnSync(BASH, [script], {
    cwd: root,
    encoding: "utf8",
    env: cleanGitEnv(process.env),
    timeout: 60_000,
  });
  expect(
    result.signal,
    "the step was killed rather than finishing; its exit status proves nothing"
  ).toBeNull();
  return {
    code: result.status ?? -1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

describe("the fixtures are consumer-shaped, not Lisa-shaped", () => {
  it.each(HOST_RELATIVE_CANDIDATES)(
    "leaves %s absent, so a host-relative candidate cannot carry the pass",
    (candidate: string) => {
      const root = consumerTree(PACKAGED_OLD_LAYOUT);
      expect(existsSync(path.join(root, candidate))).toBe(false);
    }
  );

  it("resolves the host-relative candidate in THIS repository, which is why Lisa never caught it", () => {
    // Stated as an assertion rather than a comment: it is the reason the tests
    // above have to build a tree at all. Lisa passes the broken list.
    expect(
      existsSync(
        path.join(
          REPO_ROOT,
          "all/copy-overwrite/scripts/check-conflict-markers.mjs"
        )
      )
    ).toBe(true);
  });
});

describe("conflict-residue fallback resolves the prover in a consumer tree", () => {
  it("finds the packaged prover of a release predating the layout move", () => {
    const { code, output } = runStep(consumerTree(PACKAGED_OLD_LAYOUT));
    expect(output).toContain(SCAN_RAN);
    expect(code).toBe(0);
  });

  it("finds the packaged prover of a release carrying the layout move", () => {
    const { code, output } = runStep(consumerTree(PACKAGED_NEW_LAYOUT));
    expect(output).toContain(SCAN_RAN);
    expect(code).toBe(0);
  });

  it("still fails closed when no candidate resolves, naming every path searched", () => {
    const { code, output } = runStep(consumerTree());
    expect(code).toBe(1);
    expect(output).not.toContain(SCAN_RAN);
    for (const candidate of [
      PACKAGED_NEW_LAYOUT,
      PACKAGED_OLD_LAYOUT,
      ...HOST_RELATIVE_CANDIDATES,
    ]) {
      expect(output, `the failure never names ${candidate}`).toContain(
        candidate
      );
    }
  });
});

describe("the workflow's candidate list covers both packaged layouts", () => {
  it("searches the packaged prover of both the pre- and post-move layout", () => {
    const shell = fallbackShell();
    expect(shell).toContain(PACKAGED_OLD_LAYOUT);
    expect(shell).toContain(PACKAGED_NEW_LAYOUT);
  });
});
