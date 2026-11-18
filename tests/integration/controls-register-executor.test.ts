/**
 * `lisa controls register`, run as the built command, for a repository whose
 * pull-request check runs from a pipeline file Lisa did not write.
 *
 * The unit suites run the command from source. This one runs the built
 * artifact inside a repository Lisa was never applied to, the way the enforce
 * and attest steps call it, and covers the two things the operator relies
 * on: the entries read unproved while no proof is on record, and they stop
 * reading unproved once both halves of it are (CodySwannGT/lisa#4991).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  controlAuditGitEnv,
  type ControlAuditFixture,
} from "../helpers/control-audit-fixtures.js";
import {
  F_NONE_GATES,
  buildDeclaredFixture,
  registerSchemaErrors,
} from "../helpers/control-register.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import {
  bothHalves,
  withExecutor,
} from "../unit/controls/support/executor-fixtures.js";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DIST_CLI = path.join(REPO_ROOT, "dist", "index.js");
const REGISTER = ".lisa/controls/register.json";
const EVIDENCE = ".lisa/controls/evidence.json";
const LINT = "code-style@.";
const COVERAGE = "coverage-adequacy@.";

const fixtures: ControlAuditFixture[] = [];

/**
 * Build F-none, a Python repository, with a pipeline file named on every gate
 * it checks at the pull-request moment.
 * @returns The repository root
 */
function repository(): string {
  const built = buildDeclaredFixture("F-none", withExecutor(F_NONE_GATES));
  fixtures.push(built);
  return built.repoPath;
}

/**
 * Run the built command from inside a repository, with no path argument.
 * @param repoPath - The repository to stand in
 * @param flags - Flags after `register`
 * @returns Exit status and both streams
 */
function register(
  repoPath: string,
  flags: readonly string[] = []
): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const child = boundedSpawnSync({
    label: "lisa controls register (built CLI, non-GitHub executor)",
    command: process.execPath,
    args: [DIST_CLI, "controls", "register", ...flags],
    cwd: repoPath,
    env: { ...controlAuditGitEnv(), LISA_SKIP_UPDATE_CHECK: "1" },
  });
  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

/**
 * The entries of the register a repository holds, by whether they read
 * unproved.
 * @param repoPath - The repository root
 * @returns The parsed register and the ids of its unproved entries
 */
function written(repoPath: string): {
  readonly document: unknown;
  readonly unproved: readonly string[];
} {
  const document = JSON.parse(
    readFileSync(path.join(repoPath, REGISTER), "utf8")
  ) as {
    readonly entries: readonly {
      readonly id: string;
      readonly status?: string;
    }[];
  };
  return {
    document,
    unproved: document.entries
      .filter(entry => entry.status === "unproved")
      .map(entry => entry.id),
  };
}

/**
 * Write the evidence file the attest step would.
 * @param repoPath - The repository root
 * @param records - Its records
 */
function recordEvidence(repoPath: string, records: readonly unknown[]): void {
  const file = path.join(repoPath, EVIDENCE);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ records }, null, 2)}\n`);
}

afterEach(() => {
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

describe("built lisa controls register with a pull-request executor Lisa did not write", () => {
  it("writes every entry the file runs as unproved while no proof is on record", () => {
    const repoPath = repository();

    const run = register(repoPath);
    const { document, unproved } = written(repoPath);

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout.split("\n")[0]).toBe(
      `register: 2 entries read unproved: ${LINT}, ${COVERAGE}. The pull-request check for them runs from .gitlab-ci.yml on gitlab, a file Lisa did not write, and ${EVIDENCE} holds no record that both halves of their proof held yet. They stay unproved until the attest step records that both held.`
    );
    expect(unproved).toEqual([LINT, COVERAGE]);
    expect(registerSchemaErrors(document)).toEqual([]);
    expect(register(repoPath, ["--check"]).status).toBe(0);
  });

  it("stops writing an entry as unproved once both halves of its proof are on record", () => {
    const repoPath = repository();
    register(repoPath);
    recordEvidence(repoPath, bothHalves(LINT));

    const stale = register(repoPath, ["--check"]);
    const rewrite = register(repoPath);

    expect(stale.status).toBe(1);
    expect(stale.stderr.split("\n")[0]).toBe(
      `The entry "${LINT}" in ${REGISTER} does not match the gates declaration: status differs. The status is worked out from the proof records in ${EVIDENCE}, so it changes when a proof is recorded or removed.`
    );
    expect(rewrite.status).toBe(0);
    expect(written(repoPath).unproved).toEqual([COVERAGE]);
    expect(register(repoPath, ["--check"]).status).toBe(0);
  });
});
