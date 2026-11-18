/**
 * Running `lisa controls attest` in-process against a fixture repository and
 * a hosting platform that lives in memory, for the suites that read what the
 * command prints and what it writes down about the pull-request moment
 * (CodySwannGT/lisa#4997, CodySwannGT/lisa#4998).
 *
 * No case reaches a real platform: the command is handed a request function
 * that answers from memory, a remote address that is only read as text, a
 * fixed run identifier, a pause that takes no time, and a stand-in for the
 * process's termination signals.
 * @module tests/unit/controls/support/attest-pull-request-run
 */
import {
  runAttest,
  type AttestOptions,
} from "../../../../src/controls/commands/attest.js";
import type { PullRequestDependencies } from "../../../../src/controls/pull-request-settle.js";
import type { GatesBlock } from "../../../helpers/control-register.js";
import { RUN_ID, fakeSignals } from "./canary-run.js";
import { setting, steppingClock, type ProofSetting } from "./proof-run.js";
import { GITHUB_REMOTE } from "./protect-fixture.js";
import { REPOSITORY_FILES } from "./pull-request-run.js";
import type { Run } from "./report-check-run.js";

/** When the first run of a case begins. */
export const FIRST_RUN = "2026-02-01T00:00:00.000Z";

/** When a second run of the same case begins: the next day. */
export const NEXT_DAY = "2026-02-02T00:00:00.000Z";

/** A moment after both, at which what they wrote is still current. */
export const AFTER_BOTH = new Date("2026-02-03T00:00:00.000Z");

/**
 * Build a fixture repository for a gates block, with the proof files and a
 * workflow that can report a check, and a disposable copy of it.
 * @param gates - The gates block
 * @returns The repository and its copy
 */
export function pullRequestSetting(gates: GatesBlock): ProofSetting {
  return setting(gates, { files: REPOSITORY_FILES });
}

/**
 * Run the command in-process in a repository, against the in-memory platform.
 * @param where - The repository and its disposable copy
 * @param options - The command's options
 * @param pullRequests - Collaborators for the pull-request moment
 * @param start - The first reading of the run's clock
 * @returns Exit code and printed lines
 */
export async function attestIn(
  where: ProofSetting,
  options: AttestOptions,
  pullRequests: PullRequestDependencies = {},
  start: string = FIRST_RUN
): Promise<Run> {
  const signals = fakeSignals();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runAttest(
    where.repoPath,
    { workspace: where.workspace, ...options },
    {
      clock: steppingClock(start),
      stdout: text => {
        stdout.push(text);
      },
      stderr: text => {
        stderr.push(text);
      },
      pullRequests: {
        readRemoteUrl: () => Promise.resolve(GITHUB_REMOTE),
        runId: () => RUN_ID,
        sleep: () => Promise.resolve(),
        signals: signals.source,
        terminate: signals.terminate,
        ...pullRequests,
      },
    }
  );
  return { code, stdout, stderr };
}
