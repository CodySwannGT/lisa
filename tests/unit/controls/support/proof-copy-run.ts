/**
 * Building a disposable copy of a fixture repository and running proofs
 * through its hooks (CodySwannGT/lisa#4996).
 *
 * The suites about the disposable copy all need the same things: somewhere
 * to put the copy, an environment in which the installed hook can find Node,
 * the copy itself, and a run of the paired proofs in it. They are written
 * once here.
 * @module tests/unit/controls/support/proof-copy-run
 */
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { vi } from "vitest";

import { SWEPT_ENV } from "../../../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep.mjs";
import {
  buildProofCopy,
  type ProofCopy,
  type ProofCopyDependencies,
} from "../../../../src/controls/proof-copy.js";
import { proofCopyWorkspace } from "../../../../src/controls/proof-copy-workspace.js";
import { runPairedProofs } from "../../../../src/controls/proof-runner.js";
import { loadProofTools } from "../../../../src/controls/proof-tools.js";
import type { ProofRun } from "../../../../src/controls/proof-types.js";
import { generateControlRegister } from "../../../../src/controls/register.js";
import { sweepAlreadyRanEnv } from "../../../helpers/cleanup-sweep-skip.js";
import { runControlAuditGit } from "../../../helpers/control-audit-fixtures.js";
import { steppingClock } from "./proof-run.js";

const scratches: string[] = [];

/**
 * Give this process the environment an operator's shell has when a hook
 * runs: Node on `PATH`, because the carrier is started by git and looks for
 * it there. The gate runner's start-of-push sweep of the machine's temporary
 * folder is switched off, as every suite that pushes through a hook does.
 */
export function hookEnvironment(): void {
  vi.stubEnv(
    "PATH",
    [path.dirname(process.execPath), process.env.PATH ?? ""].join(
      path.delimiter
    )
  );
  vi.stubEnv(SWEPT_ENV, sweepAlreadyRanEnv()[SWEPT_ENV] ?? "");
}

/**
 * Point the machine's temporary folder at a new, empty one, so a suite can
 * see exactly what a run left there.
 * @returns The folder
 */
export function ownTemporaryFolder(): string {
  const folder = realpathSync(
    mkdtempSync(path.join(tmpdir(), "lisa-proof-copy-tmp-"))
  );
  scratches.push(folder);
  vi.stubEnv("TMPDIR", folder);
  return folder;
}

/**
 * Name a folder for a disposable copy. The folder does not exist yet; its
 * parent does and is removed by {@link removeScratch}.
 * @returns The folder's path
 */
export function scratchFolder(): string {
  const parent = realpathSync(
    mkdtempSync(path.join(tmpdir(), "lisa-proof-copy-test-"))
  );
  scratches.push(parent);
  return path.join(parent, "run");
}

/** Remove every folder a case made and put the environment back. */
export function removeScratch(): void {
  vi.unstubAllEnvs();
  scratches.splice(0).forEach(folder => {
    rmSync(folder, { force: true, maxRetries: 10, recursive: true });
  });
}

/**
 * Build the disposable copy of a repository, failing the case when it cannot
 * be built.
 * @param repoPath - The repository
 * @param dependencies - Replaceable collaborators
 * @returns The copy
 */
export async function copyOf(
  repoPath: string,
  dependencies: ProofCopyDependencies = {}
): Promise<ProofCopy> {
  const built = await buildProofCopy(repoPath, scratchFolder(), dependencies);
  if (built.problem !== null) throw new Error(built.problem);
  return built.copy;
}

/** A run of the paired proofs, and the copy it ran in. */
export interface CopyRun {
  readonly run: ProofRun;
  readonly copy: ProofCopy;
}

/**
 * Run the paired proof of every control of a repository through the hooks of
 * a disposable copy of it.
 * @param repoPath - The repository
 * @param dependencies - Replaceable collaborators of building the copy
 * @returns The results and the copy
 */
export async function proveInCopy(
  repoPath: string,
  dependencies: ProofCopyDependencies = {}
): Promise<CopyRun> {
  const generated = await generateControlRegister(repoPath);
  if (generated.problems !== null) {
    throw new Error(generated.problems.join("\n"));
  }
  const tools = await loadProofTools();
  const copy = await copyOf(repoPath, dependencies);
  const run = await runPairedProofs({
    register: generated.register,
    root: repoPath,
    workspace: proofCopyWorkspace(copy, tools),
    judge: tools.judge,
    clock: steppingClock(),
  });
  return { run, copy };
}

/**
 * Run git in a folder of a disposable copy, or in a fixture.
 * @param directory - The folder
 * @param args - Arguments to git
 * @returns What git printed
 */
export function gitIn(directory: string, ...args: readonly string[]): string {
  return runControlAuditGit(directory, args);
}
