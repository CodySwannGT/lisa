/**
 * `lisa controls attest` and the pull-request moment, run as the built
 * command inside a repository Lisa was never applied to
 * (CodySwannGT/lisa#4997).
 *
 * The unit suites hand the command an in-memory platform. This one runs the
 * built artifact, which starts the real `gh` program, so a stub stands first
 * on `PATH` and records every call. It covers what an operator gets without
 * asking for canaries: the entry is recorded at the `observed` rung from
 * three reads, and nothing is created. It also covers the option's first
 * guard end to end: asked for canaries with an account that may not write,
 * the command still sends reads only.
 *
 * No case here could create anything even if the command tried: the stub
 * refuses every request that is not a read, and the real `gh`, should it
 * ever be reached, is pointed at a host that cannot exist.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SettledProofRun } from "../../src/controls/pull-request-types.js";
import {
  controlAuditGitEnv,
  runControlAuditGit,
} from "../helpers/control-audit-fixtures.js";
import { buildProofFixture, workspaceCopy } from "../helpers/control-proofs.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { statusCheckRuleset } from "../unit/controls/support/fake-github.js";
import {
  GITHUB_REMOTE,
  REPO,
} from "../unit/controls/support/protect-fixture.js";
import {
  PULL_ONLY_CHECK,
  PULL_ONLY_ENTRY,
  PULL_ONLY_GATES,
  REPOSITORY_FILES,
} from "../unit/controls/support/pull-request-run.js";
import {
  protectGhEnv,
  recordedGhCalls,
  writeProtectGh,
  type ProtectGhStub,
} from "./support/protect-gh-stub.js";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DIST_CLI = path.join(REPO_ROOT, "dist", "index.js");
const API = `repos/${REPO}`;
const CANARIES = "--pull-request-canaries";

/** The three reads the default makes, as the stub records them. */
/** The option that names a folder to run in, which makes the run a report. */
const WORKSPACE = "--workspace";

const SETTINGS_READS = [
  `api --hostname github.com ${API}/rulesets?per_page=100`,
  `api --hostname github.com ${API}/rulesets/1`,
  `api --hostname github.com ${API}`,
];

const cleanups: (() => void)[] = [];

/**
 * What the platform answers: a default branch that requires the entry's
 * check, and an account with or without write access.
 * @param push - Whether the signed-in account may write
 * @returns API path to the document a read is answered with
 */
function platform(push: boolean): Readonly<Record<string, unknown>> {
  const ruleset = statusCheckRuleset(1, "main-checks", [PULL_ONLY_CHECK]);
  return {
    [`${API}/rulesets?per_page=100`]: [
      { id: 1, name: ruleset.name, target: "branch", enforcement: "active" },
    ],
    [`${API}/rulesets/1`]: ruleset,
    [API]: {
      full_name: REPO,
      default_branch: "main",
      permissions: { admin: false, push, pull: true },
    },
  };
}

/** One run of the built command, and what the stub was asked. */
interface Ran {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Every `gh` call, in order. */
  readonly calls: readonly string[];
}

/**
 * Build a fixture repository with a pull-request gate, a disposable copy of
 * it, and a `gh` stub. All three are removed after the case.
 * @param responses - What the stub answers each read with
 * @param remote - The `origin` address, or `null` for none
 * @returns The repository, its copy and the stub
 */
function setting(
  responses: Readonly<Record<string, unknown>>,
  remote: string | null
): {
  readonly repoPath: string;
  readonly workspace: string;
  readonly stub: ProtectGhStub;
} {
  const built = buildProofFixture(PULL_ONLY_GATES, REPOSITORY_FILES);
  if (remote !== null) {
    runControlAuditGit(built.repoPath, ["remote", "add", "origin", remote]);
  }
  const copy = workspaceCopy(built.repoPath);
  const stubRoot = mkdtempSync(path.join(tmpdir(), "lisa-attest-gh-"));
  const stub = writeProtectGh(stubRoot, responses);
  cleanups.push(built.cleanup, copy.cleanup, () =>
    rmSync(stubRoot, { force: true, recursive: true })
  );
  return { repoPath: built.repoPath, workspace: copy.directory, stub };
}

/**
 * Run the built command from inside a fixture repository whose `origin`
 * names a GitHub repository, against a `gh` stub.
 * @param flags - Flags after `attest`, beside the disposable copy
 * @param responses - What the stub answers each read with
 * @param remote - The `origin` address, or `null` for none
 * @returns Exit status, both streams and the recorded calls
 */
function attest(
  flags: readonly string[],
  responses: Readonly<Record<string, unknown>>,
  remote: string | null = GITHUB_REMOTE
): Ran {
  const { repoPath, workspace, stub } = setting(responses, remote);
  const child = boundedSpawnSync({
    label: "lisa controls attest (built CLI, stubbed gh)",
    command: process.execPath,
    // A run that opens canaries records what it finds, so it cannot be the
    // report-only run a named folder gives: it makes its own copy.
    args: [
      DIST_CLI,
      "controls",
      "attest",
      ...(flags.includes(CANARIES) && !flags.includes(WORKSPACE)
        ? []
        : [WORKSPACE, workspace]),
      ...flags.filter(flag => flag !== WORKSPACE),
    ],
    cwd: repoPath,
    env: protectGhEnv(stub, {
      ...controlAuditGitEnv(),
      LISA_SKIP_UPDATE_CHECK: "1",
    }),
  });
  return {
    status: child.status,
    stdout: child.stdout,
    stderr: child.stderr,
    calls: recordedGhCalls(stub),
  };
}

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => {
    cleanup();
  });
});

describe("built lisa controls attest and the pull-request moment", () => {
  it("records the entry at the observed rung from three reads, and creates nothing", () => {
    const run = attest(["--json"], platform(true));

    const document = JSON.parse(run.stdout) as SettledProofRun;
    expect(document.entries).toEqual([
      expect.objectContaining({
        entry_id: PULL_ONLY_ENTRY,
        moment: "pull-request",
        outcome: "unproved",
        reason: "observed-required",
        rung: "observed",
      }),
    ]);
    expect(document.pull_request).toMatchObject({
      mode: "observed",
      branch: "main",
      canaries: [],
      points: [
        {
          entry_id: PULL_ONLY_ENTRY,
          rung: "observed",
          observed: "required",
          checks: [{ context: PULL_ONLY_CHECK, state: "required" }],
        },
      ],
    });
    expect(run.calls).toEqual(SETTINGS_READS);
    expect(run.status).toBe(1);
  });

  it("says what was observed in the table an operator reads", () => {
    const run = attest([], platform(true));

    expect(run.stdout).toMatch(
      /^unproved +code-style@\. +pull-request +not run$/mu
    );
    expect(run.stdout).toContain("Observed, not exercised.");
    expect(run.stdout).toContain(CANARIES);
  });

  it("sends reads only when canaries are asked for and the account may not write", () => {
    const run = attest(["--json", CANARIES], platform(false));

    const document = JSON.parse(run.stdout) as SettledProofRun;
    expect(document.entries[0]).toMatchObject({
      outcome: "unknown",
      reason: "canary-permission-missing",
      rung: "observed",
    });
    expect(document.entries[0]?.detail).toContain(
      `Opening one needs write access to ${REPO} (the push permission)`
    );
    expect(document.pull_request).toMatchObject({
      mode: "canaries",
      permission: { can_write: false },
      canaries: [],
    });
    // The three reads of the settings, then the probe of write access.
    expect(run.calls).toEqual([
      ...SETTINGS_READS,
      `api --hostname github.com ${API}`,
    ]);
    expect(run.status).toBe(1);
  });

  it("asks nothing of any platform in a repository with no remote", () => {
    const run = attest(["--json", CANARIES], platform(true), null);

    const document = JSON.parse(run.stdout) as SettledProofRun;
    expect(document.entries[0]).toMatchObject({
      outcome: "unknown",
      reason: "platform-not-reached",
      rung: "observed",
    });
    expect(run.calls).toEqual([]);
  });

  it("opens no pull request for a run in a folder the operator named", () => {
    const run = attest([WORKSPACE, "--json", CANARIES], platform(true));

    expect(run.stdout).toBe("");
    expect(run.stderr).toContain(
      "--workspace cannot be combined with --pull-request-canaries"
    );
    expect(run.calls).toEqual([]);
    expect(run.status).toBe(2);
  });

  it("lists both options in its help", () => {
    const child = boundedSpawnSync({
      label: "lisa controls attest --help",
      command: process.execPath,
      args: [DIST_CLI, "controls", "attest", "--help"],
      cwd: REPO_ROOT,
      env: { ...controlAuditGitEnv(), LISA_SKIP_UPDATE_CHECK: "1" },
    });

    expect(child.stdout).toContain(CANARIES);
    expect(child.stdout).toContain("--acknowledge-external-effects");
    // The help text is wrapped, so the words may be on two lines.
    expect(child.stdout).toMatch(/never\s+merged/u);
  });
});
