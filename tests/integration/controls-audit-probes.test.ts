/**
 * An outside system the audit cannot read is reported as unreachable, with
 * the error it gave, and never as a requirement that is in place.
 *
 * These run the built CLI inside fixture repositories. **No case contacts an
 * outside system or uses a credential.** Where the built command would start
 * the hosting platform's own tool, a stub stands first on `PATH`: it holds no
 * account, reaches no network, and records every call. The remote address a
 * fixture is given is written into its git configuration and never resolved.
 * The agent's part, writing `.lisa/audit/report.json`, is played by a
 * stand-in that copies the probe the command printed.
 *
 * What this proves is everything code decides: what the read records when the
 * platform will not answer, and that the report check holds the report to it.
 * It does not prove a live probe, which only an agent with real access makes
 * (CodySwannGT/lisa#4981).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AUTHORITY,
  unreachableProbe,
  waitingOn,
  withProbes,
  type SampleProbe,
} from "../helpers/audit-probes.js";
import {
  buildFMixed,
  buildFNone,
  controlAuditGitEnv,
  runControlAuditGit,
  type ControlAuditFixture,
} from "../helpers/control-audit-fixtures.js";
import {
  amendFinding,
  completeAuditReport,
  writeAuditReport,
  type SampleReport,
} from "../helpers/control-audit-report.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import {
  installLisaCommand,
  runAuditSkillCommands,
  stepRunning,
} from "./support/audit-skill-run.js";
import {
  protectGhEnv,
  recordedGhCalls,
  type ProtectGhStub,
} from "./support/protect-gh-stub.js";
import {
  SIGNED_OUT_MESSAGE,
  writeSignedOutGh,
} from "./support/signed-out-gh-stub.js";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DIST_CLI = path.join(REPO_ROOT, "dist", "index.js");
const REPO = "example-owner/example-repo";
const GITHUB_REMOTE = `https://github.com/${REPO}.git`;
const REPORT_MD = ".lisa/audit/report.md";
const MERGE_PROTECTION = "merge-protection";
const REPORT_CHECK = "report-check";
const IN_PLACE = "exists-not-enforced";
const EVERY_FILE = [
  "status",
  "--porcelain",
  "--ignored",
  "--untracked-files=all",
];
const MIXED = [".", "api", "web"];
const SENTRY_ACCESS =
  "a Sentry token, stored under the name SENTRY_AUTH_TOKEN, that may read this project";
const ERRORS = { criterion: "SI8", scope: "api" } as const;

const fixtures: ControlAuditFixture[] = [];
const stubRoots: string[] = [];
const lisa = { folder: "", remove: (): void => undefined };

/** One run of the built CLI. */
interface Ran {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Keep a fixture so it is removed after the case.
 * @param built - The fixture
 * @param remoteUrl - An `origin` address to record; it is never contacted
 * @returns Its repository root
 */
function repositoryOf(built: ControlAuditFixture, remoteUrl?: string): string {
  fixtures.push(built);
  if (remoteUrl !== undefined) {
    runControlAuditGit(built.repoPath, ["remote", "add", "origin", remoteUrl]);
  }
  return built.repoPath;
}

/**
 * Install the stub for the platform's tool on a machine with no account.
 * @returns The stub
 */
function signedOut(): ProtectGhStub {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-audit-probe-gh-"));
  stubRoots.push(root);
  return writeSignedOutGh(root);
}

/**
 * Run a `lisa controls` subcommand of the built CLI inside a repository.
 * @param repoPath - The repository to stand in
 * @param subcommand - The subcommand
 * @param gh - The stub for the platform's tool
 * @returns Exit status and both streams
 */
function controls(
  repoPath: string,
  subcommand: string,
  gh: ProtectGhStub
): Ran {
  const child = boundedSpawnSync({
    label: `lisa controls ${subcommand} (built CLI in a fixture)`,
    command: process.execPath,
    args: [DIST_CLI, "controls", subcommand],
    cwd: repoPath,
    env: protectGhEnv(gh, {
      ...controlAuditGitEnv(),
      LISA_SKIP_UPDATE_CHECK: "1",
    }),
  });
  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

/**
 * The probe a run of `merge-protection` printed.
 * @param ran - The run
 * @returns The probe entry, or `null`
 */
function printedProbe(ran: Ran): SampleProbe | null {
  return (JSON.parse(ran.stdout) as { readonly probe: SampleProbe | null })
    .probe;
}

/**
 * Write a record and have the built CLI check it.
 * @param repoPath - The repository
 * @param report - The record
 * @param gh - The stub for the platform's tool
 * @returns The check's run
 */
function check(repoPath: string, report: SampleReport, gh: ProtectGhStub): Ran {
  writeAuditReport(repoPath, report);
  return controls(repoPath, REPORT_CHECK, gh);
}

beforeEach(() => {
  Object.assign(lisa, installLisaCommand());
});

afterEach(() => {
  lisa.remove();
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
  stubRoots.splice(0).forEach(root => {
    rmSync(root, { recursive: true, force: true });
  });
});

describe("the hosting platform with no credentials on the machine", () => {
  it("is recorded as unreachable, quoting the error, after one read and no write", () => {
    const repoPath = repositoryOf(buildFNone(), GITHUB_REMOTE);
    const gh = signedOut();

    const ran = controls(repoPath, MERGE_PROTECTION, gh);

    expect(ran.status).toBe(0);
    expect(printedProbe(ran)).toEqual({
      id: "hosting-platform",
      system:
        "GitHub, where this repository is hosted and its merge settings are kept",
      needed_by: [AUTHORITY],
      result: "unreachable",
      request: `GET repos/${REPO}/rulesets?per_page=100`,
      observed_error: SIGNED_OUT_MESSAGE,
      access_needed:
        "the GitHub command-line tool (gh) signed in with an account that can read this repository on GitHub",
    });
    expect(ran.stderr).toMatch(
      /^merge-protection: NOT REACHED\. Lisa could not reach GitHub, .*: To get started with GitHub CLI, please run: gh auth login .* To check this requirement an agent needs the GitHub command-line tool \(gh\) signed in /u
    );
    expect(recordedGhCalls(gh)).toEqual([
      `api --hostname github.com repos/${REPO}/rulesets?per_page=100`,
    ]);
    expect(runControlAuditGit(repoPath, EVERY_FILE)).toBe("");
  });

  it("leaves the requirement about skipping checks unknown, naming the permission", () => {
    const repoPath = repositoryOf(buildFNone(), GITHUB_REMOTE);
    const gh = signedOut();
    const probe = printedProbe(controls(repoPath, MERGE_PROTECTION, gh));
    const access = String(probe?.access_needed);
    const report = withProbes(
      waitingOn(completeAuditReport(), AUTHORITY, access),
      [probe]
    );

    const ran = check(repoPath, report, gh);
    const readable = readFileSync(path.join(repoPath, REPORT_MD), "utf8");

    expect(ran.stderr).toBe("");
    expect(ran.status).toBe(0);
    expect(readable).toContain("## What could not be reached");
    expect(readable).toContain(
      "- **What happened:** Lisa could not reach GitHub, where this repository is hosted and its merge settings are kept: To get started with GitHub CLI, please run: gh auth login"
    );
    expect(readable).toContain(
      `- **What is needed:** To check what depends on it, an agent needs ${access}.`
    );
    expect(readable).toMatch(
      /### Are the required checks enforced in a place the agents cannot skip, switch off or work around\?\n\n\*\*Could not be checked\*\*\n\n- \*\*What was found:\*\* Lisa could not reach GitHub/u
    );
    expect(readable).toContain(
      `- **What to do next:** To check this requirement an agent needs ${access}.`
    );
  });

  it.each([
    ["in place", { state: IN_PLACE }],
    ["missing", { state: "missing", mechanisms: [] }],
  ])(
    "refuses a report that calls that requirement %s, and renders nothing",
    (_name, change) => {
      const repoPath = repositoryOf(
        buildFNone({ extraFiles: { "ci.yml": "jobs:\n  test: {}\n" } }),
        GITHUB_REMOTE
      );
      const gh = signedOut();
      const probe = printedProbe(controls(repoPath, MERGE_PROTECTION, gh));
      const report = withProbes(
        amendFinding(completeAuditReport(), AUTHORITY, {
          mechanisms: [
            {
              tool: "pipeline",
              command: "test",
              moment: "pull-request",
              locators: [{ path: "ci.yml", line: 2 }],
            },
          ],
          ...change,
        }),
        [probe]
      );

      const ran = check(repoPath, report, gh);

      expect(ran.status).toBe(1);
      expect(ran.stdout).toBe("");
      expect(ran.stderr).toMatch(
        /^This finding depends on the outside system probed as "hosting-platform", which the audit could not reach, so nothing shows whether the requirement is met\. Change its state to "unknown" and say in "next" what access is needed\. \(requirement AC5\.1, whole repository\)\n/u
      );
      expect(ran.stderr).toMatch(/report-check: FAIL\. 1 problem in /u);
      expect(existsSync(path.join(repoPath, REPORT_MD))).toBe(false);
    }
  );

  it("refuses a report that calls it in place with no probe on record at all", () => {
    const repoPath = repositoryOf(
      buildFNone({ extraFiles: { "ci.yml": "jobs:\n  test: {}\n" } })
    );
    const report = amendFinding(completeAuditReport(), AUTHORITY, {
      state: IN_PLACE,
      mechanisms: [
        {
          tool: "pipeline",
          command: "test",
          moment: "pull-request",
          locators: [{ path: "ci.yml", line: 2 }],
        },
      ],
    });

    const ran = check(repoPath, report, signedOut());

    expect(ran.status).toBe(1);
    expect(ran.stderr).toMatch(
      /^This finding says the hosting platform enforces the required checks, but the report records no read of that platform's merge settings\./u
    );
  });
});

describe("another outside system whose credential was removed", () => {
  const sentry = unreachableProbe({
    id: "sentry",
    system: "Sentry, where the pipeline sends its error reports",
    needed_by: [ERRORS],
    request: "a read of the project's details, through the Sentry access skill",
    observed_error:
      "SENTRY_AUTH_TOKEN is not set, and no secrets provider is configured to supply it.",
    access_needed: SENTRY_ACCESS,
  });

  it("is accepted as unreachable when the finding that depends on it is unknown", () => {
    const repoPath = repositoryOf(buildFMixed());
    const report = withProbes(
      waitingOn(completeAuditReport(MIXED), ERRORS, SENTRY_ACCESS),
      [sentry]
    );

    const ran = check(repoPath, report, signedOut());
    const readable = readFileSync(path.join(repoPath, REPORT_MD), "utf8");

    expect(ran.stderr).toBe("");
    expect(ran.status).toBe(0);
    expect(readable).toContain(
      "- **What happened:** Lisa could not reach Sentry, where the pipeline sends its error reports: SENTRY_AUTH_TOKEN is not set, and no secrets provider is configured to supply it."
    );
    expect(readable).toContain("(folder api)");
  });

  it("is refused when the finding that depends on it is reported as in place", () => {
    const repoPath = repositoryOf(buildFMixed());
    const report = withProbes(
      amendFinding(completeAuditReport(MIXED), ERRORS, {
        state: IN_PLACE,
        mechanisms: [
          {
            tool: "sentry",
            command: null,
            moment: "none",
            locators: [{ path: "api/ruff.toml", line: 1 }],
          },
        ],
      }),
      [sentry]
    );

    const ran = check(repoPath, report, signedOut());

    expect(ran.status).toBe(1);
    expect(ran.stderr).toMatch(
      /^This finding depends on the outside system probed as "sentry", which the audit could not reach, .* \(requirement SI8, folder api\)\n/u
    );
  });
});

describe("the skill's own read of the hosting platform, on a first run", () => {
  it("exits 0, has no system to probe and sends nothing in a repository with no remote", () => {
    const repoPath = repositoryOf(buildFNone());

    const steps = runAuditSkillCommands(repoPath, lisa.folder, () => {
      writeAuditReport(repoPath, completeAuditReport());
    });
    const read = stepRunning(steps, "lisa controls merge-protection");

    expect(read.status).toBe(0);
    expect(JSON.parse(read.stdout)).toMatchObject({
      probe: null,
      merge_protection: null,
      requests: [],
      platform: { name: "unknown", reachable: false },
    });
    expect(read.stderr).toMatch(/^merge-protection: NO PLATFORM\. /u);
    expect(stepRunning(steps, "lisa controls report-check").status).toBe(0);
  });
});
