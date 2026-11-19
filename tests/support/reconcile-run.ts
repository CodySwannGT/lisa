/**
 * Running `lisa controls reconcile` against a fixture repository, the way an
 * operator would (CodySwannGT/lisa#5000).
 *
 * Every suite about the reconciler does the same things: declare checks in a
 * fixture, install the carriers with the real installer, change something
 * with real git or on disk, and run the command. They are written once here.
 * The command runs in the fixture's own git environment, so a suite started
 * from inside a hook still asks about the fixture.
 * @module tests/support/reconcile-run
 */
import { mkdtempSync, rmSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import path from "node:path";

import { createCarrierGit } from "../../src/controls/carrier-git.js";
import { runReconcile } from "../../src/controls/commands/reconcile.js";
import {
  reconcileRepository,
  type ReconcileDependencies,
  type ReconcileOptions,
} from "../../src/controls/reconcile.js";
import type {
  CommandFinding,
  PointFinding,
  ReconcileResult,
} from "../../src/controls/reconcile-types.js";
import { evidenceAt, type GatesBlock } from "../helpers/control-register.js";
import {
  installCarriers,
  operatorEnv,
  operatorGit,
} from "./carrier-install.js";
import {
  declaredFNone,
  type NoManifestRepository,
  wholeRepositoryPart,
} from "./no-manifest-run.js";

/** The linter F-none declares at commit. It is never started by a suite. */
export const LINT = ["ruff", "check", "."];

/** The test run F-none declares at push. It is never started by a suite. */
export const TESTS = ["python", "-m", "pytest", "-q"];

/** The entry the linter is listed under in the register. */
export const LINT_ENTRY = "code-style@.";

/** The entry the test run is listed under in the register. */
export const TESTS_ENTRY = "test-correctness@.";

/**
 * One part covering the whole repository, with the evidence a register asks
 * of every part.
 * @param command - The argument list that checks it
 * @returns The part
 */
export function evidencedPart(
  command: readonly string[]
): Record<string, unknown> {
  return { ...wholeRepositoryPart(command), evidence: evidenceAt("ruff.toml") };
}

/** A linter at commit and a test run at push, each serving a requirement. */
export const RECONCILE_GATES: GatesBlock = {
  "code-style": {
    commit: "required",
    criteria: ["SI7"],
    parts: [evidencedPart(LINT)],
  },
  "test-correctness": {
    push: "required",
    criteria: ["SI1"],
    parts: [evidencedPart(TESTS)],
  },
};

/** One finished run of the command. */
export interface ReconcileCommandRun {
  /** The exit code. */
  readonly code: number;
  /** The JSON document on stdout, or `null` when there was none. */
  readonly result: ReconcileResult | null;
  /** The JSON document exactly as it was printed. */
  readonly printed: string;
  /** Everything written for a person, one item per line. */
  readonly said: readonly string[];
}

/**
 * Run `lisa controls reconcile` against a repository.
 * @param root - The repository
 * @param options - The command's options
 * @param dependencies - Replaceable collaborators of the comparison
 * @returns The exit code, the result document and what was said
 */
export async function reconcile(
  root: string,
  options: ReconcileOptions = {},
  dependencies: ReconcileDependencies = {}
): Promise<ReconcileCommandRun> {
  const printed: string[] = [];
  const said: string[] = [];
  const code = await runReconcile(root, options, {
    reconcile: (repository, chosen) =>
      reconcileRepository(repository, chosen, {
        git: createCarrierGit(operatorEnv()),
        ...dependencies,
      }),
    stderr: line => said.push(line),
    stdout: text => printed.push(text),
  });
  const text = printed.join("\n");
  return {
    code,
    printed: text,
    result: text === "" ? null : (JSON.parse(text) as ReconcileResult),
    said,
  };
}

/**
 * The result of a run that was expected to produce one.
 * @param run - The finished run
 * @returns The result document
 */
export function resultOf(run: ReconcileCommandRun): ReconcileResult {
  if (run.result === null) throw new Error(run.said.join("\n"));
  return run.result;
}

/**
 * The findings of a run about enforcement points nothing runs.
 * @param run - The finished run
 * @returns The findings, in order
 */
export function missingPoints(
  run: ReconcileCommandRun
): readonly PointFinding[] {
  return resultOf(run).findings.filter(
    (finding): finding is PointFinding =>
      finding.kind === "enforcement-point-not-wired"
  );
}

/**
 * The findings of a run about commands no register entry declares.
 * @param run - The finished run
 * @returns The findings, in order
 */
export function undeclared(
  run: ReconcileCommandRun
): readonly CommandFinding[] {
  return resultOf(run).findings.filter(
    (finding): finding is CommandFinding =>
      finding.kind === "undeclared-command"
  );
}

/**
 * Build F-none with gates declared in it, and nothing installed.
 * @param gates - The `gates` block; a linter at commit and tests at push by
 *   default
 * @returns The repository
 */
export function declaredRepository(
  gates: GatesBlock = RECONCILE_GATES
): NoManifestRepository {
  return declaredFNone(gates);
}

/**
 * Build F-none with gates declared and the carriers installed by the real
 * installer: a fully wired repository. What the installer wrote is left
 * uncommitted, as it is straight after an install.
 * @param gates - The `gates` block
 * @returns The repository
 */
export async function wiredRepository(
  gates: GatesBlock = RECONCILE_GATES
): Promise<NoManifestRepository> {
  const repository = declaredRepository(gates);
  const run = await installCarriers(repository.fixture.repoPath);
  if (run.code !== 0) throw new Error(run.said.join("\n"));
  return repository;
}

/**
 * Commit everything in a repository without starting its hooks.
 *
 * The declared checks name tools that are not installed where the suite
 * runs, and no reconcile suite is about running them: the carrier suites
 * already hold the installed hooks to running a check. So the commit that
 * only seeds a fixture is made with git pointed at no hooks folder.
 * @param root - The repository
 */
export function commitSeed(root: string): void {
  const added = operatorGit(root, ["add", "--all"]);
  const committed = operatorGit(root, [
    "-c",
    `core.hooksPath=${devNull}`,
    "commit",
    "--quiet",
    "-m",
    "chore: seed a reconcile fixture",
  ]);
  if (added.status !== 0 || committed.status !== 0) {
    throw new Error(`${added.stderr}${committed.stdout}${committed.stderr}`);
  }
}

/** A clone of a repository, and how to remove it. */
export interface ClonedRepository {
  /** The clone's root. */
  readonly root: string;
  /** Remove the clone. */
  readonly cleanup: () => void;
}

/**
 * Commit a repository as it is and clone it with real git, the way a
 * teammate would get it.
 * @param source - The repository to clone
 * @returns The clone
 */
export function cloneOf(source: string): ClonedRepository {
  commitSeed(source);
  return clonedFrom(source);
}

/**
 * Clone a repository's committed state with real git.
 * @param source - The repository to clone
 * @returns The clone
 */
function clonedFrom(source: string): ClonedRepository {
  const parent = mkdtempSync(path.join(tmpdir(), "lisa-reconcile-clone-"));
  const root = path.join(parent, "clone");
  const cloned = operatorGit(parent, ["clone", "--quiet", source, root]);
  if (cloned.status !== 0) throw new Error(cloned.stderr);
  return {
    cleanup: () => rmSync(parent, { force: true, recursive: true }),
    root,
  };
}
