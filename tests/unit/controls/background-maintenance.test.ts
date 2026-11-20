/**
 * No repository the control suites build, and no disposable copy Lisa makes,
 * leaves git housekeeping running in the background (CodySwannGT/lisa#5100).
 *
 * `git commit` and `git fetch` start `git maintenance run --auto --detach`,
 * which takes `.git/objects/maintenance.lock` and releases it after the
 * command has returned. A CI run failed `proof-determinism` with `ENOENT ...
 * lstat '<fixture>/.git/objects/maintenance.lock'`: `workspaceCopy` was
 * copying a control-audit fixture's `.git` while that lock went away. Lisa's
 * own head copy fetched into its temporary folder the same way, before it
 * switched housekeeping off, and so could still be written to while it was
 * removed. Same class as #5035, which fixed the work-item fixture.
 *
 * Each case traces real git with `GIT_TRACE`, which logs every command git
 * starts before it starts it, so the assertion is about what git was asked to
 * do and does not depend on winning a race.
 * @module tests/unit/controls/background-maintenance
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildHeadCopy } from "../../../src/controls/enforce-head-copy.js";
import {
  buildControlAuditFixture,
  CONTROL_AUDIT_FIXTURE_NAMES,
  controlAuditGitEnv,
  runControlAuditGit,
} from "../../helpers/control-audit-fixtures.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { GIT_BIN } from "../../support/git-executable.js";

/** What git logs when it starts background housekeeping. */
const BACKGROUND_MAINTENANCE = "maintenance run --auto";

const removals: (() => void)[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  removals.splice(0).forEach(remove => {
    remove();
  });
});

/**
 * A new temporary folder, removed after the case.
 * @param prefix - The folder name's start
 * @returns Its real path
 */
function scratchFolder(prefix: string): string {
  const folder = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  removals.push(() => {
    rmSync(folder, { force: true, recursive: true });
  });
  return folder;
}

describe("the control-audit fixture repository", () => {
  it.each(CONTROL_AUDIT_FIXTURE_NAMES)(
    "%s starts no background git maintenance on a commit",
    name => {
      const fixture = buildControlAuditFixture(name);
      removals.push(fixture.cleanup);

      const result = boundedSpawnSync({
        label: "git commit in a control-audit fixture, traced",
        command: GIT_BIN,
        args: ["commit", "--allow-empty", "--quiet", "--message", "probe"],
        cwd: fixture.repoPath,
        env: { ...controlAuditGitEnv(), GIT_TRACE: "1" },
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toContain("built-in: git commit");
      expect(result.stderr).not.toContain(BACKGROUND_MAINTENANCE);
    }
  );
});

describe("Lisa's head copy", () => {
  it("starts no background git maintenance while it is built", async () => {
    const fixture = buildControlAuditFixture("F-none");
    removals.push(fixture.cleanup);
    const commit = runControlAuditGit(fixture.repoPath, ["rev-parse", "HEAD"]);
    const home = scratchFolder("lisa-head-copy-trace-");
    const trace = path.join(home, "git-trace.log");
    vi.stubEnv("GIT_TRACE", trace);

    const built = await buildHeadCopy(
      fixture.repoPath,
      path.join(home, "copy"),
      {
        branch: "main",
        ref: "refs/heads/main",
        commit,
        chosen_by: "current-branch",
      }
    );

    expect(built.problem).toBeNull();
    const traced = readFileSync(trace, "utf8");
    expect(traced).toContain("built-in: git fetch");
    expect(traced).not.toContain(BACKGROUND_MAINTENANCE);
  });
});
