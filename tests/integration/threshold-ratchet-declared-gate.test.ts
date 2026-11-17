/**
 * The `threshold-monotonicity` gate, run by the shipped gate runner in a
 * repository with no `package.json`, fails a push that lowers a declared
 * floor and passes one that raises it (CodySwannGT/lisa#4985).
 *
 * The gate's default task is a package script, which a repository on no
 * supported stack does not have. Such a repository declares the gate as a
 * part whose command is the shipped check, the way the design note
 * (`docs/design/gates-and-policy.md`, "A declared threshold moves one way")
 * writes it. This suite runs that declaration through the real runner, so the
 * note cannot describe something the runner does not do.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildFNone,
  controlAuditGitEnv,
  runControlAuditGit,
} from "../helpers/control-audit-fixtures.js";
import {
  COVERAGE_FLOOR,
  COVERAGE_GATE,
  LISA_CONFIG_FILE,
  configText,
  gateOf,
  part,
} from "../helpers/declared-thresholds.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import {
  SHIPPED_CHECK,
  shippedThresholdCheck,
} from "./support/shipped-threshold-check.js";

useIoLatencyBudget();

const RUNNER_SCRIPT = path.resolve(
  __dirname,
  "..",
  "..",
  "all",
  "copy-overwrite",
  "scripts",
  "lisa-run-gates.mjs"
);

const GATE = "threshold-monotonicity";

/** The gate and its one part, as the runner names them. */
const GATE_IN_REPOSITORY = `${GATE} in .`;

const cleanups: Array<() => void> = [];

/**
 * A `.lisa.config.json` that requires the threshold gate at push, proved by
 * the shipped check, and declares a coverage floor for the whole repository.
 * @param floor - The coverage floor
 * @returns The file content
 */
function declaring(floor: number): string {
  return configText({
    [GATE]: {
      push: "required",
      parts: [
        {
          scope: ".",
          command: [process.execPath, SHIPPED_CHECK, "--base", "HEAD^"],
          proof: { failure_shape: ["blocked by the threshold ratchet"] },
        },
      ],
    },
    [COVERAGE_GATE]: gateOf(
      part(".", { [COVERAGE_FLOOR]: { value: floor, direction: "floor" } })
    ),
  });
}

/**
 * Build a repository on no supported stack that declares a floor of 60, then
 * commit a change to that floor.
 * @param floor - The floor the change sets
 * @returns The repository root
 */
function hostChanging(floor: number): string {
  const fixture = buildFNone({
    extraFiles: {
      ...shippedThresholdCheck(),
      [LISA_CONFIG_FILE]: declaring(60),
    },
  });
  cleanups.push(fixture.cleanup);
  writeFileSync(
    path.join(fixture.repoPath, LISA_CONFIG_FILE),
    declaring(floor)
  );
  runControlAuditGit(fixture.repoPath, ["add", "--all"]);
  runControlAuditGit(fixture.repoPath, [
    "commit",
    "--quiet",
    "--message",
    "change the floor",
  ]);
  return fixture.repoPath;
}

/**
 * A place outside the repository for the runner's list of built-in checks it
 * took over, removed after the case.
 * @returns The path to hand the runner
 */
function coverageFile(): string {
  const scratch = mkdtempSync(path.join(tmpdir(), "lisa-threshold-gate-"));
  cleanups.push(() => rmSync(scratch, { force: true, recursive: true }));
  return path.join(scratch, "coverage");
}

/**
 * Run the shipped gate runner at push the way the push hook does: with a file
 * to list the built-in checks it took over, so it runs what is declared
 * instead of handing the whole moment back.
 * @param floor - The floor the change under test sets
 * @returns Exit status and everything the runner printed
 */
function pushChanging(floor: number): {
  readonly status: number | null;
  readonly output: string;
} {
  const repoPath = hostChanging(floor);
  const coverage = coverageFile();
  const child = boundedSpawnSync({
    label: "lisa-run-gates.mjs --moment=push on the threshold gate as a part",
    command: process.execPath,
    args: [RUNNER_SCRIPT, "--moment=push", `--coverage=${coverage}`],
    cwd: repoPath,
    env: controlAuditGitEnv(),
  });
  return { status: child.status, output: `${child.stdout}${child.stderr}` };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("the threshold gate in a repository with no package.json", () => {
  it("fails a push that lowers a declared floor, naming the parameter", () => {
    const run = pushChanging(55);

    expect(run.status).toBe(1);
    expect(run.output).toContain(`FAILED     required ${GATE_IN_REPOSITORY}`);
    expect(run.output).toContain(
      `the floor "${COVERAGE_FLOOR}" of the ${COVERAGE_GATE} gate, for the whole repository, was lowered from 60 to 55`
    );
    expect(run.output).not.toContain("PASSED");
  });

  it("passes a push that raises it", () => {
    const run = pushChanging(65);

    expect(run.output).toContain(`PASSED     required ${GATE_IN_REPOSITORY}`);
    expect(run.output).not.toContain("FAILED     required");
    expect(run.status).toBe(0);
  });
});
