/**
 * A run publishes its finished coverage artifacts, and abandoned ones are reclaimed.
 *
 * ## What isolation alone left behind
 *
 * CodySwannGT/lisa#3911 gave every run its own reports directory, which fixed
 * the collision. `reportsDirectory` is the only lever the coverage provider
 * offers, so isolating the scratch necessarily moved the REPORTS with it, and
 * two consequences fell out that the isolation ticket did not cover
 * (CodySwannGT/lisa#3950):
 *
 * 1. **`coverage/lcov.info` stopped being written.** A project upgrading to
 *    isolation does not get a missing-file error — its Sonar keeps reading the
 *    file left there before the upgrade, indefinitely, and reports a coverage
 *    number that has quietly stopped moving. A wrong value that looks like a
 *    real one, which is the failure #3911 removed from concurrent runs
 *    reappearing one layer out.
 * 2. **`coverage/.runs/` grew without bound.** Vitest's `cleanAfterRun` removes
 *    a reports directory only when it finds it EMPTY, and the default reporter
 *    list is `["text","html","clover","json"]`, so it never is.
 *
 * ## Why these cases inject liveness and one deliberately does not
 *
 * Every reclaim case here states its own liveness probe, so the pid values are
 * labels rather than claims about the machine. That makes them deterministic —
 * and it also means **all of them would pass against an `isProcessAlive` that
 * never reported anything dead.** {@link reclaimsAnOwnerThatReallyExited} is
 * the one case that closes that gap: it spawns a process, waits for it to exit,
 * and hands the resulting pid to the DEFAULT probe.
 *
 * That gap is not hypothetical. It hid a real mistake: `0` looks like a safe
 * "no such process" sentinel and is not one — `kill(0, sig)` targets the
 * CALLER'S PROCESS GROUP, so `process.kill(0, 0)` succeeds and the real probe
 * calls pid 0 alive.
 * @module tests/unit/config/coverage-publish-reclaim
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  publishCoverageRunDirectory,
  reclaimAbandonedCoverageRunDirectories,
  removeOwnCoverageRunDirectory,
} from "../../../src/configs/vitest/coverage-reports-directory.js";
import { runRootName } from "../../../src/configs/vitest/scratch-namespace-authority.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** A pid the injected probes below report as dead. NOT dead to the real one. */
const REPORTED_DEAD_PID = 7777;

/** A pid the injected probes report as alive. */
const REPORTED_LIVE_PID = 4242;

/** Fixed so a directory name is stable across cases. */
const STARTED_AT = 1_757_000_000_000;

/** The lcov reporter's directory output, which publishing replaces whole. */
const LCOV_REPORT_DIR = "lcov-report";

/** The lcov reporter file every publish case names. */
const LCOV_INFO = "lcov.info";

/** The html reporter entry point a human opens. */
const HTML_REPORT = "index.html";

/** Body for any html artifact a case has to make real. */
const HTML_BODY = "<html></html>";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A `<root>/coverage/.runs/` tree that `afterEach` removes.
 * @returns The `coverage` directory and the `.runs` directory beneath it
 */
function coverageTree(): { readonly stable: string; readonly runs: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-cov-3950-"));
  const stable = path.join(root, "coverage");
  const runs = path.join(stable, ".runs");

  created.push(root);
  fs.mkdirSync(runs, { recursive: true });

  return { stable, runs };
}

/**
 * One run directory, populated with the files a real run would leave.
 * @param runs - The `.runs` directory
 * @param owner - Pid to name the directory after
 * @param files - Relative file paths to create inside it
 * @returns The run directory's path and its basename
 */
function runDirectory(
  runs: string,
  owner: number,
  files: readonly string[] = []
): { readonly directory: string; readonly name: string } {
  const name = runRootName(owner, STARTED_AT, "a1b2c3d4");
  const directory = path.join(runs, name);
  fs.mkdirSync(directory, { recursive: true });
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), HTML_BODY);
  }
  return { directory, name };
}

/**
 * Liveness that answers for exactly one live pid.
 * @param livePid - The pid to report as running
 * @returns A liveness probe
 */
const aliveOnly =
  (livePid: number) =>
  (owner: number): boolean =>
    owner === livePid;

describe("publishing a finished run's artifacts", () => {
  it("moves the reports up to the stable directory and drops the run", () => {
    const { stable, runs } = coverageTree();
    const { directory, name } = runDirectory(runs, REPORTED_LIVE_PID, [
      LCOV_INFO,
      HTML_REPORT,
    ]);

    expect(publishCoverageRunDirectory(directory, name)).toBe(true);

    // The path a Sonar config or a human actually names.
    expect(fs.existsSync(path.join(stable, LCOV_INFO))).toBe(true);
    expect(fs.existsSync(path.join(stable, HTML_REPORT))).toBe(true);
    expect(fs.existsSync(directory)).toBe(false);
  });

  it("replaces a previous run's artifact rather than leaving it stale", () => {
    // The whole point: the stable file has to keep MOVING. A publish that
    // declined to overwrite would leave exactly the frozen number this exists
    // to prevent.
    const { stable, runs } = coverageTree();
    fs.writeFileSync(path.join(stable, LCOV_INFO), "STALE");
    const { directory, name } = runDirectory(runs, REPORTED_LIVE_PID);
    fs.writeFileSync(path.join(directory, LCOV_INFO), "FRESH");

    expect(publishCoverageRunDirectory(directory, name)).toBe(true);
    expect(fs.readFileSync(path.join(stable, LCOV_INFO), "utf8")).toBe("FRESH");
  });

  it("replaces a directory-shaped report, not just a file", () => {
    // `lcov-report/` and the html reporter's output are directories, and a
    // rename onto an existing directory fails unless the target goes first.
    // Found by writing this case rather than by reading the code.
    const { stable, runs } = coverageTree();
    fs.mkdirSync(path.join(stable, LCOV_REPORT_DIR), { recursive: true });
    fs.writeFileSync(path.join(stable, LCOV_REPORT_DIR, "old.html"), HTML_BODY);
    const { directory, name } = runDirectory(runs, REPORTED_LIVE_PID, [
      `${LCOV_REPORT_DIR}/new.html`,
    ]);

    expect(publishCoverageRunDirectory(directory, name)).toBe(true);
    expect(fs.existsSync(path.join(stable, LCOV_REPORT_DIR, "new.html"))).toBe(
      true
    );
    expect(fs.existsSync(path.join(stable, LCOV_REPORT_DIR, "old.html"))).toBe(
      false
    );
  });

  it("never publishes the provider's scratch directory", () => {
    // `cleanAfterRun` normally removes `.tmp` first, but a run killed between
    // report generation and exit still has it. Copying a half-written
    // `coverage-<n>.json` up to the stable path would put the very files this
    // module protects somewhere another run can see them.
    const { stable, runs } = coverageTree();
    const { directory, name } = runDirectory(runs, REPORTED_LIVE_PID, [
      ".tmp/coverage-0.json",
      LCOV_INFO,
    ]);

    expect(publishCoverageRunDirectory(directory, name)).toBe(true);
    expect(fs.existsSync(path.join(stable, ".tmp"))).toBe(false);
    expect(fs.existsSync(path.join(stable, LCOV_INFO))).toBe(true);
  });

  it("refuses a directory this run did not mint", () => {
    // Publishing a foreign directory would move another run's in-flight
    // reports. Ownership is decided by a name only this process could produce.
    const { runs } = coverageTree();
    const { directory } = runDirectory(runs, REPORTED_DEAD_PID, [LCOV_INFO]);

    expect(
      publishCoverageRunDirectory(
        directory,
        runRootName(REPORTED_LIVE_PID, STARTED_AT, "a1b2c3d4")
      )
    ).toBe(false);
    expect(fs.existsSync(path.join(directory, LCOV_INFO))).toBe(true);
  });

  it("reports nothing published when the directory is already gone", () => {
    const { runs } = coverageTree();
    const name = runRootName(REPORTED_LIVE_PID, STARTED_AT, "a1b2c3d4");

    expect(publishCoverageRunDirectory(path.join(runs, name), name)).toBe(
      false
    );
  });
});

describe("removing a run's own directory", () => {
  it("removes the directory whose name this run minted", () => {
    const { runs } = coverageTree();
    const { directory, name } = runDirectory(runs, REPORTED_LIVE_PID, [
      HTML_REPORT,
    ]);

    expect(removeOwnCoverageRunDirectory(directory, name)).toBe(true);
    expect(fs.existsSync(directory)).toBe(false);
  });

  it("refuses a directory this run did not mint", () => {
    const { runs } = coverageTree();
    const { directory } = runDirectory(runs, REPORTED_DEAD_PID);

    expect(
      removeOwnCoverageRunDirectory(
        directory,
        runRootName(REPORTED_LIVE_PID, STARTED_AT, "a1b2c3d4")
      )
    ).toBe(false);
    expect(fs.existsSync(directory)).toBe(true);
  });
});

describe("reclaiming directories left by runs that died", () => {
  it("removes a dead run's directory and keeps a live one", () => {
    // The control, in one case: two directories differing only in whether
    // their owner is alive. Removing both would destroy a running peer's
    // reports; removing neither leaves killed runs to accrue forever.
    const { runs } = coverageTree();
    const dead = runDirectory(runs, REPORTED_DEAD_PID);
    const live = runDirectory(runs, REPORTED_LIVE_PID);

    const removed = reclaimAbandonedCoverageRunDirectories(
      runs,
      aliveOnly(REPORTED_LIVE_PID)
    );

    expect(removed).toEqual([dead.name]);
    expect(fs.existsSync(dead.directory)).toBe(false);
    expect(fs.existsSync(live.directory)).toBe(true);
  });

  it("leaves anything that is not a run directory alone", () => {
    // `.runs/` holds only run directories today, but the parser is what makes
    // that safe rather than the convention — an unrecognised name is not a run
    // and is never removed.
    const { runs } = coverageTree();
    fs.writeFileSync(path.join(runs, "README"), HTML_BODY);
    fs.mkdirSync(path.join(runs, "not-a-run"), { recursive: true });

    expect(
      reclaimAbandonedCoverageRunDirectories(runs, aliveOnly(REPORTED_LIVE_PID))
    ).toEqual([]);
    expect(fs.existsSync(path.join(runs, "README"))).toBe(true);
    expect(fs.existsSync(path.join(runs, "not-a-run"))).toBe(true);
  });

  it("reclaims nothing when the runs directory does not exist", () => {
    const { stable } = coverageTree();

    expect(
      reclaimAbandonedCoverageRunDirectories(
        path.join(stable, "never-created"),
        aliveOnly(REPORTED_LIVE_PID)
      )
    ).toEqual([]);
  });

  it("reclaims an owner that really exited", () => {
    // The gap the injected probes leave: every case above decides liveness by
    // injection, so all of them would pass against a probe that never reports
    // anything dead. This one spawns a process, waits for it to exit, and
    // hands that pid to the DEFAULT probe — the only case here that fails if
    // `isProcessAlive` is wrong.
    //
    // `process.execPath` rather than a bare command name: an absolute path
    // guaranteed to exist, and nothing resolved through PATH.
    //
    // Through `boundedSpawnSync` because every synchronous child start in this
    // tree carries a deadline: an unbounded one makes the per-case budget
    // unenforceable, and a child killed from outside returns empty streams, so
    // the failure would read as a content mismatch rather than as a kill.
    // `childMayExitBeforeReading` is a claim about THIS child and a true one —
    // a child that has already exited is the entire point of the case.
    const { runs } = coverageTree();
    const exited = boundedSpawnSync({
      label: "exited-owner probe",
      command: process.execPath,
      args: ["-e", ""],
      childMayExitBeforeReading: true,
    });
    const { directory, name } = runDirectory(runs, exited.pid ?? 1);

    expect(reclaimAbandonedCoverageRunDirectories(runs)).toEqual([name]);
    expect(fs.existsSync(directory)).toBe(false);
  });

  it("keeps a directory owned by this very process", () => {
    // The other direction on the default probe: a pid that is certainly alive
    // must survive. A default that reported everything dead would delete live
    // peers' reports.
    const { runs } = coverageTree();
    const { directory } = runDirectory(runs, process.pid);

    expect(reclaimAbandonedCoverageRunDirectories(runs)).toEqual([]);
    expect(fs.existsSync(directory)).toBe(true);
  });
});
