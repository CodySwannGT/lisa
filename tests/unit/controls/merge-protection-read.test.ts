/**
 * Reading a repository's merge protection for the audit, without changing or
 * writing anything.
 *
 * The audit has to say whether required checks can be skipped, and that is a
 * setting the hosting platform holds. This read is the audit's probe of the
 * platform: it only ever sends reads, it writes no file, and what it returns
 * is a probe entry ready for the report, whether the platform answered, would
 * not answer, or was never asked.
 *
 * No case reaches a platform. Each one hands the read the in-memory stand-in
 * of `./support/fake-github.ts`, or a function that fails the way the
 * platform's own tool does, and asserts the requests it received
 * (CodySwannGT/lisa#4981).
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  HOSTING_PLATFORM_PROBE_ID,
  SERVER_SIDE_AUTHORITY,
} from "../../../src/controls/audit-report.js";
import {
  MERGE_PROTECTION_NOTE,
  readMergeProtection,
  type MergeProtectionRead,
} from "../../../src/controls/merge-protection-read.js";
import {
  SIGNED_OUT_ERROR,
  waitingOn,
  withProbes,
} from "../../helpers/audit-probes.js";
import {
  buildFNone,
  runControlAuditGit,
  type ControlAuditFixture,
} from "../../helpers/control-audit-fixtures.js";
import {
  amendFinding,
  completeAuditReport,
} from "../../helpers/control-audit-report.js";
import { LINTER, violationsOf } from "./audit-report-facts.js";
import {
  fakeGithub,
  statusCheckRuleset,
  type FakeGhResult,
} from "./support/fake-github.js";

const REPO = "example-owner/example-repo";
const GITHUB_REMOTE = `https://github.com/${REPO}.git`;
const STATUS = ["status", "--porcelain", "--ignored"];
const RULESET = "main checks";
const CHECK = "CI / test";
const SYSTEM =
  "GitHub, where this repository is hosted and its merge settings are kept";
const fixtures: ControlAuditFixture[] = [];

/**
 * Build a repository Lisa never touched, removed after the case.
 * @returns The repository root
 */
function repository(): string {
  const built = buildFNone();
  fixtures.push(built);
  return built.repoPath;
}

/**
 * Read with a fixed remote address and a stand-in for the platform's tool.
 * @param remote - The remote address, or `null` for none
 * @param gh - What stands in for the platform's tool
 * @returns What the read returned
 */
function read(
  remote: string | null,
  gh: (args: readonly string[]) => FakeGhResult
): Promise<MergeProtectionRead> {
  return readMergeProtection(repository(), {
    gh,
    readRemoteUrl: () => Promise.resolve(remote),
  });
}

/**
 * A stand-in for the platform's tool that must never be called.
 * @returns A function that fails the case when anything is sent
 */
function nothingMayBeSent(): (args: readonly string[]) => FakeGhResult {
  return args => {
    throw new Error(`a request was sent: ${args.join(" ")}`);
  };
}

afterEach(() => {
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

describe("reading merge protection on GitHub", () => {
  it("records the platform as reachable, with every request it made", async () => {
    const github = fakeGithub({
      repo: REPO,
      admin: null,
      rulesets: [statusCheckRuleset(7, RULESET, [CHECK])],
    });

    const result = await read(GITHUB_REMOTE, github.gh);

    expect(result.probe).toEqual({
      id: HOSTING_PLATFORM_PROBE_ID,
      system: SYSTEM,
      needed_by: [SERVER_SIDE_AUTHORITY],
      result: "reachable",
      request: `GET repos/${REPO}/rulesets; GET repos/${REPO}/rulesets/7; GET repos/${REPO}`,
    });
    expect(result.branch).toBe("main");
    expect(result.merge_protection).toEqual({
      rulesets: [RULESET],
      required_checks: [{ context: CHECK, ruleset: RULESET }],
      note: MERGE_PROTECTION_NOTE,
    });
    expect(github.writes()).toEqual([]);
    expect(github.log.map(request => request.method)).toEqual([
      "GET",
      "GET",
      "GET",
    ]);
    expect(result.requests).toEqual(
      github.log.map(({ method, path }) => ({ method, path, sent: true }))
    );
  });

  it("reports no required check when no ruleset is enforced on the default branch", async () => {
    const github = fakeGithub({
      repo: REPO,
      admin: null,
      rulesets: [
        statusCheckRuleset(7, "switched off", [CHECK], {
          enforcement: "disabled",
        }),
      ],
    });

    const result = await read(GITHUB_REMOTE, github.gh);

    expect(result.probe?.result).toBe("reachable");
    expect(result.merge_protection).toEqual({
      rulesets: [],
      required_checks: [],
      note: MERGE_PROTECTION_NOTE,
    });
  });

  it("writes nothing into the repository", async () => {
    const repoPath = repository();
    const github = fakeGithub({ repo: REPO, admin: null });

    await readMergeProtection(repoPath, {
      gh: github.gh,
      readRemoteUrl: () => Promise.resolve(GITHUB_REMOTE),
    });

    expect(runControlAuditGit(repoPath, STATUS)).toBe("");
  });

  it("hands back a probe the report check accepts as it is", async () => {
    const github = fakeGithub({
      repo: REPO,
      admin: null,
      rulesets: [statusCheckRuleset(7, RULESET, [CHECK])],
    });

    const { probe } = await read(GITHUB_REMOTE, github.gh);
    const report = amendFinding(completeAuditReport(), SERVER_SIDE_AUTHORITY, {
      state: "exists-not-enforced",
      mechanisms: [LINTER],
    });

    expect(violationsOf(withProbes(report, [probe]))).toEqual([]);
  });
});

describe("reading merge protection without access to GitHub", () => {
  it("records the platform as unreachable and quotes the error as received", async () => {
    const sent: string[] = [];

    const result = await read(GITHUB_REMOTE, args => {
      sent.push(args.join(" "));
      return { ok: false, stdout: "", stderr: `${SIGNED_OUT_ERROR}\n` };
    });

    expect(result.probe).toEqual({
      id: HOSTING_PLATFORM_PROBE_ID,
      system: SYSTEM,
      needed_by: [SERVER_SIDE_AUTHORITY],
      result: "unreachable",
      request: `GET repos/${REPO}/rulesets`,
      observed_error: SIGNED_OUT_ERROR,
      access_needed:
        "the GitHub command-line tool (gh) signed in with an account that can read this repository on GitHub",
    });
    expect(result.merge_protection).toBeNull();
    expect(result.branch).toBeNull();
    expect(sent).toEqual([`api repos/${REPO}/rulesets`]);
  });

  it("says the tool is needed when it is not installed", async () => {
    const result = await read(GITHUB_REMOTE, () => ({
      ok: false,
      stdout: "",
      stderr: "spawnSync gh ENOENT",
      missing: true,
    }));

    expect(result.probe?.result).toBe("unreachable");
    expect(result.probe?.observed_error).toBe("spawnSync gh ENOENT");
    expect(result.probe?.access_needed).toBe(
      "the GitHub command-line tool (gh) installed on this machine and signed in with an account that can read this repository on GitHub"
    );
  });

  it("says read access is needed when the platform refuses the read", async () => {
    const github = fakeGithub({
      repo: REPO,
      admin: null,
      readFailure: "Not Found",
    });

    const result = await read(GITHUB_REMOTE, github.gh);

    expect(result.probe?.result).toBe("unreachable");
    expect(result.probe?.observed_error).toContain("gh: Not Found (HTTP 404)");
    expect(result.probe?.access_needed).toBe(
      "read access to this repository on GitHub for the account the GitHub command-line tool (gh) is signed in with"
    );
  });

  it("hands back a probe that leaves the finding unknown, naming the access", async () => {
    const { probe } = await read(GITHUB_REMOTE, () => ({
      ok: false,
      stdout: "",
      stderr: SIGNED_OUT_ERROR,
    }));
    const access = String(probe?.access_needed);
    const waiting = waitingOn(
      completeAuditReport(),
      SERVER_SIDE_AUTHORITY,
      access
    );

    expect(violationsOf(withProbes(waiting, [probe]))).toEqual([]);
    expect(
      violationsOf(withProbes(completeAuditReport(), [probe])).map(
        violation => violation.rule
      )
    ).toEqual(["probe-dependents"]);
  });
});

describe("reading merge protection anywhere else", () => {
  it.each([
    ["https://gitlab.com/group/project.git", "GitLab"],
    ["git@bitbucket.org:team/project.git", "Bitbucket"],
    ["https://github.example.com/team/project.git", "GitHub (self-hosted)"],
  ])(
    "sends nothing for %s and says what access is needed",
    async (remote, label) => {
      const result = await read(remote, nothingMayBeSent());

      expect(result.probe).toEqual({
        id: HOSTING_PLATFORM_PROBE_ID,
        system: `${label}, where this repository is hosted and its merge settings are kept`,
        needed_by: [SERVER_SIDE_AUTHORITY],
        result: "not-attempted",
        reason: `Lisa has no built-in way to read merge settings on ${label}, so no request was sent.`,
        access_needed: `a way to read this repository's protected-branch settings on ${label}, such as that platform's own command-line tool signed in with an account that can see them`,
      });
      expect(result.requests).toEqual([]);
      expect(result.merge_protection).toBeNull();
    }
  );

  it("sends nothing when a GitHub address does not name one repository", async () => {
    const result = await read(
      "https://github.com/example-owner",
      nothingMayBeSent()
    );

    expect(result.probe?.result).toBe("not-attempted");
    expect(result.probe?.reason).toMatch(/does not name one repository/u);
    expect(result.requests).toEqual([]);
  });

  it.each([[null], ["../elsewhere"], ["https://code.example.invalid/a/b.git"]])(
    "has no probe to hand back when the remote %j names no known platform",
    async remote => {
      const result = await read(remote, nothingMayBeSent());

      expect(result.probe).toBeNull();
      expect(result.platform.name).toBe("unknown");
      expect(result.merge_protection).toBeNull();
      expect(result.requests).toEqual([]);
    }
  );
});
