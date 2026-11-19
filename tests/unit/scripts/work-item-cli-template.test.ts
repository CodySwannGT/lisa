/**
 * The work-item fixture repository must not start git housekeeping in the
 * background.
 *
 * CodySwannGT/lisa#5035. A push-gate run failed one case of 26,038 with
 * `ENOENT, No such file or directory '<fixture>/.git/objects'`, raised by the
 * `cpSync` that copies the shared template into a fresh fixture. Nothing had
 * deleted the fixture: it was still on disk, its `.git/objects` complete. Node's
 * native `cpSync` names the destination folder when a source FILE vanishes, and
 * the file was `objects/maintenance.lock`. `git commit` starts
 * `git maintenance run --auto --detach`, which takes that lock and releases it
 * from the background after `commit` has returned — measured still held after
 * 29 of 40 commits here, and copied mid-release under push-gate load.
 *
 * The template therefore switches that housekeeping off in its own config, which
 * every fixture copy inherits, as `src/controls/proof-copy.ts` already does for
 * its copies. The probe below reads only the repository's own config, so the
 * machine's global settings cannot make it pass.
 * @module tests/unit/scripts/work-item-cli-template
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";
import {
  cleanupFixtures,
  cleanupTemplates,
  createFixture,
} from "../../support/work-item-cli.js";

// Builds a real git template and runs a real `git commit`.
useIoLatencyBudget();

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

describe("the work-item fixture repository", () => {
  it("never starts background git maintenance", () => {
    const { root } = createFixture();

    const result = boundedSpawnSync({
      label: "git commit in a work-item fixture, traced",
      command: resolveGit(),
      args: ["commit", "--allow-empty", "-q", "-m", "probe"],
      cwd: root,
      env: cleanGitEnv(process.env, {
        GIT_AUTHOR_EMAIL: "lisa@example.test",
        GIT_AUTHOR_NAME: "Lisa Test",
        GIT_COMMITTER_EMAIL: "lisa@example.test",
        GIT_COMMITTER_NAME: "Lisa Test",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TRACE: "1",
      }),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("built-in: git commit");
    expect(result.stderr).not.toContain("maintenance run --auto");
  });
});
