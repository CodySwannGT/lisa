/**
 * Two overlapping runs in one checkout each measure their own coverage.
 *
 * ## What was measured, and what it cost
 *
 * CodySwannGT/lisa#3911. Vitest derives the coverage provider's scratch
 * directory from `coverage.reportsDirectory` and removes both, recursively,
 * during initialisation — before a test file is globbed. Against a fixed
 * default of `coverage/` that made the path shared mutable state: a second run
 * starting in the same checkout deleted the first run's live scratch, and the
 * first reached the end of its coverage phase with nothing to merge. Twice in
 * one evening, at roughly 24 minutes an attempt, because the coverage phase is
 * the expensive stretch of the push gate and the collision is only discovered
 * at the end of it.
 *
 * ## Why this spawns processes instead of reading the config
 *
 * A case that asserted `reportsDirectory !== "coverage"` would pass against a
 * fix that isolated the reports and left the scratch shared, and would keep
 * passing if a future vitest changed where it puts `.tmp`. The property is
 * about two runs, so the case runs two — real processes, interleaved at a
 * filesystem barrier rather than on a timer, each performing the provider's
 * own `rm`/`rm`/`mkdir` initialisation around a scratch file it reads back.
 *
 * The directory each child uses comes from the shipped factory. Where the
 * factory declares none the fixture falls back to vitest's own
 * `coverageConfigDefaults.reportsDirectory` — what vitest itself does — so this
 * case fails against the exact pre-fix code rather than against a stand-in for
 * it.
 * @module tests/unit/config/coverage-scratch-isolation
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  COVERAGE_REPORTS_DIR_ENV,
  COVERAGE_RUNS_DIR,
  coverageReportsDirectory,
  coverageRunDirectory,
  resetCoverageReportsDirectory,
} from "../../../src/configs/vitest/coverage-reports-directory.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURE = path.join(
  REPO_ROOT,
  "tests/helpers/__fixtures__/coverage-scratch-concurrent.ts"
);

/** Only a hung child can reach this; the barrier itself is event-driven. */
const CHILD_BUDGET_MS = 120_000;

/** What one child reported about its own coverage scratch. */
interface RaceReport {
  readonly error: string | null;
  readonly reportsDirectory: string;
  readonly role: string;
  readonly survived: boolean;
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  resetCoverageReportsDirectory();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

/** Exit status and complete output of one finished child. */
interface ChildOutcome {
  readonly code: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

/**
 * Collects a child through its natural close event.
 * @param child - The spawned race arm
 * @returns Its exit status and complete output.
 */
function collectChild(
  // The exact type `spawn` returns for `stdio: ["ignore", "pipe", "pipe"]` —
  // stdin null, both readable ends piped. `ChildProcessWithoutNullStreams` is
  // the wrong one, and only `tsconfig.tests.json` says so, because that is the
  // project which compiles this file.
  child: ChildProcessByStdio<null, Readable, Readable>
): Promise<ChildOutcome> {
  const out: string[] = [];
  const err: string[] = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => out.push(chunk));
  child.stderr.on("data", (chunk: string) => err.push(chunk));
  return new Promise(resolve => {
    child.on("close", (code: number | null) => {
      resolve({ code, stderr: err.join(""), stdout: out.join("") });
    });
  });
}

/**
 * Runs one child of the race to completion.
 * @param root - Shared project root both children resolve against
 * @param role - Which arm of the interleaving this child plays
 * @param ownSignal - Path this child touches when it has written its scratch
 * @param peerSignal - Path this child waits on
 * @returns What the child reported.
 */
async function runChild(
  root: string,
  role: "first" | "second",
  ownSignal: string,
  peerSignal: string
): Promise<RaceReport> {
  const child = spawn(process.execPath, ["--import", "tsx", FIXTURE], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      LISA_COVERAGE_RACE_OWN_SIGNAL: ownSignal,
      LISA_COVERAGE_RACE_PEER_SIGNAL: peerSignal,
      LISA_COVERAGE_RACE_ROLE: role,
      LISA_COVERAGE_RACE_ROOT: root,
      // The child's own temp residue (tsx's transform cache) belongs to the
      // race root, not to this suite's scratch run root — the leak guard
      // attributes an unregistered child to the suite that left it, and this
      // suite does not own what a `--import tsx` bootstrap writes.
      TEMP: root,
      TMP: root,
      TMPDIR: root,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const outcome = await collectChild(child);
  if (outcome.code !== 0) {
    throw new Error(
      `${role} child exited ${String(outcome.code)}: ${outcome.stderr}${outcome.stdout}`
    );
  }
  return JSON.parse(
    outcome.stdout.trim().split("\n").at(-1) ?? "{}"
  ) as RaceReport;
}

describe("concurrent coverage runs in one checkout", () => {
  it(
    "leaves each run's own scratch readable after the other has cleaned",
    { timeout: CHILD_BUDGET_MS },
    async () => {
      const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-cov-race-"));
      temporaryDirectories.push(root);
      const firstSignal = path.join(root, "first-wrote");
      const secondSignal = path.join(root, "second-wrote");

      const [first, second] = await Promise.all([
        runChild(root, "first", firstSignal, secondSignal),
        runChild(root, "second", secondSignal, firstSignal),
      ]);

      // The measured failure: the first run's files vanish underneath it while
      // it is still running, and it dies on a bare ENOENT with nothing to
      // merge. `error` is asserted so a regression names the syscall rather
      // than reporting a bare false.
      expect(first.error).toBeNull();
      expect(first.survived).toBe(true);
      expect(second.survived).toBe(true);

      // And the reason it survived: the two runs never shared a directory.
      expect(first.reportsDirectory).not.toBe(second.reportsDirectory);
    }
  );
});

describe("coverageReportsDirectory", () => {
  it("derives the path from the run's identity, not the repository", () => {
    expect(coverageRunDirectory(1234, 5678, "abcd")).toBe(
      `coverage/${COVERAGE_RUNS_DIR}/run-1234-5678-abcd`
    );
  });

  it("stays inside coverage/, which every shipped gitignore already covers", () => {
    expect(coverageReportsDirectory({})).toMatch(
      new RegExp(`^coverage/${COVERAGE_RUNS_DIR}/run-\\d+-\\d+-[0-9a-f]+$`)
    );
  });

  it("returns one path per process, so scratch and reports cannot disagree", () => {
    expect(coverageReportsDirectory({})).toBe(coverageReportsDirectory({}));
  });

  it("honours a caller-pinned path for single-writer environments", () => {
    expect(
      coverageReportsDirectory({ [COVERAGE_REPORTS_DIR_ENV]: "coverage" })
    ).toBe("coverage");
  });

  it("ignores a blank pin rather than writing coverage to the project root", () => {
    expect(
      coverageReportsDirectory({ [COVERAGE_REPORTS_DIR_ENV]: "   " })
    ).not.toBe("   ");
  });
});
