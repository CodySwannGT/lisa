/** Bounded real CLI operations and disposable host checkpoints. */
import * as fs from "node:fs";
import * as path from "node:path";
import { expect } from "vitest";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";
import { type Candidate } from "./artifact.js";
import { run } from "./process.js";

/**
 * Commit only operator-owned disposable fixture state; source hooks stay intact.
 * @param candidate - Exact packed candidate and child environment
 * @param host - Generated host directory
 * @param label - Named evidence log boundary
 */
export async function checkpoint(
  candidate: Candidate,
  host: string,
  label: string
): Promise<void> {
  const git = resolveGit();
  await run(
    git,
    ["add", "."],
    host,
    candidate.env,
    candidate.logs,
    `${label}-add`
  );
  // Generated host hooks verify application delivery. These operator seed
  // checkpoints are not application commits and must not trigger a factory.
  await run(
    git,
    [
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--allow-empty",
      "-m",
      `fixture: ${label}`,
    ],
    host,
    candidate.env,
    candidate.logs,
    `${label}-commit`
  );
  expect(
    boundedSpawnSync({
      label: `${label} clean tree`,
      command: git,
      args: ["status", "--porcelain"],
      cwd: host,
    }).stdout
  ).toBe("");
}

/**
 * Run the real CLI the way the README's `bunx lisa apply .` does, only after
 * proving the host is clean.
 *
 * Bun launches it, so the CLI sees the `npm_config_user_agent` an operator's
 * apply carries and can tell a fresh host, which has no lockfile yet, that
 * Bun is adopting it (CodySwannGT/lisa#4941). `--no-install` with the packed
 * tool's bin directory on `PATH` keeps bunx on the exact installed candidate;
 * it can never fetch some other `lisa` from a registry.
 * @param candidate - Exact packed candidate and child environment
 * @param host - Generated host directory
 * @param stack - Supported host stack
 * @param label - Named evidence log boundary
 */
export async function apply(
  candidate: Candidate,
  host: string,
  stack: string,
  label: string
): Promise<void> {
  const git = resolveGit();
  const sentinel = path.join(candidate.root, "github-was-invoked");
  const toolBin = path.join(candidate.root, "tool", "node_modules", ".bin");
  expect(
    boundedSpawnSync({
      label: "actual apply clean-tree prerequisite",
      command: git,
      args: ["status", "--porcelain"],
      cwd: host,
    }).stdout
  ).toBe("");
  await run(
    "bunx",
    [
      "--no-install",
      "lisa",
      "apply",
      host,
      "--yes",
      "--no-update-check",
      "--harness=cursor",
    ],
    host,
    {
      ...candidate.env,
      PATH: [toolBin, candidate.env["PATH"] ?? ""].join(path.delimiter),
    },
    candidate.logs,
    `${stack}-${label}`,
    60_000
  );
  expect(fs.existsSync(sentinel), "no remote repository creation").toBe(false);
}
