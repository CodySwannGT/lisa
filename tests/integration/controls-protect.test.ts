/**
 * `lisa controls protect`, run as the built command inside a repository Lisa
 * was never applied to.
 *
 * The unit suites hand the command an in-memory platform. This one runs the
 * built artifact, which starts the real `gh` program — so a stub stands first
 * on `PATH` and records every call. It covers the read-only half of the
 * command end to end: with credentials that may not change merge protection
 * the handover file exists, the outcome is blocked, and no write was sent;
 * on another platform nothing is sent at all; and a second run changes
 * nothing (CodySwannGT/lisa#4993).
 *
 * The built command is never given a platform it could change: the stub
 * refuses every request that is not a read.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  controlAuditGitEnv,
  runControlAuditGit,
  type ControlAuditFixture,
} from "../helpers/control-audit-fixtures.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import {
  LINT_CHECK,
  REPO,
  protectFixture,
} from "../unit/controls/support/protect-fixture.js";
import { statusCheckRuleset } from "../unit/controls/support/fake-github.js";
import {
  protectGhEnv,
  recordedGhCalls,
  writeProtectGh,
  type ProtectGhStub,
} from "./support/protect-gh-stub.js";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DIST_CLI = path.join(REPO_ROOT, "dist", "index.js");
const HANDOVER = ".lisa/controls/merge-protection-change.md";
const STATUS = ["status", "--porcelain"] as const;
const API = `repos/${REPO}`;
const READ_ONLY_REPOSITORY = {
  full_name: REPO,
  default_branch: "main",
  permissions: { admin: false, push: true, pull: true },
};

const fixtures: ControlAuditFixture[] = [];
const stubRoots: string[] = [];

/** One run of the built command. */
interface Ran {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Build F-mixed with its declaration and an `origin` remote address.
 * @param remoteUrl - The address; it is recorded, never contacted
 * @returns The repository root
 */
function repository(remoteUrl: string): string {
  const built = protectFixture();
  fixtures.push(built);
  runControlAuditGit(built.repoPath, ["remote", "add", "origin", remoteUrl]);
  return built.repoPath;
}

/**
 * Install a `gh` stub that answers reads from canned documents.
 * @param responses - API path to the document a read is answered with
 * @returns The stub
 */
function stub(responses: Readonly<Record<string, unknown>>): ProtectGhStub {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-protect-gh-"));
  stubRoots.push(root);
  return writeProtectGh(root, responses);
}

/**
 * Run the built command from inside a repository.
 * @param repoPath - The repository to stand in
 * @param gh - The `gh` stub
 * @param flags - Flags after `protect`
 * @returns Exit status and both streams
 */
function protect(
  repoPath: string,
  gh: ProtectGhStub,
  flags: readonly string[] = []
): Ran {
  const child = boundedSpawnSync({
    label: "lisa controls protect (built CLI in a fixture)",
    command: process.execPath,
    args: [DIST_CLI, "controls", "protect", ...flags],
    cwd: repoPath,
    env: protectGhEnv(gh, {
      ...controlAuditGitEnv(),
      LISA_SKIP_UPDATE_CHECK: "1",
    }),
  });
  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

afterEach(() => {
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
  stubRoots.splice(0).forEach(root => {
    rmSync(root, { recursive: true, force: true });
  });
});

describe("built lisa controls protect with read-only credentials", () => {
  it.each([[[] as string[]], [["--apply"]]])(
    "writes the handover, reports blocked and sends no write with flags %j",
    flags => {
      const repoPath = repository(`https://github.com/${REPO}.git`);
      const gh = stub({ [`${API}/rulesets`]: [], [API]: READ_ONLY_REPOSITORY });

      const ran = protect(repoPath, gh, flags);

      expect(ran.status).toBe(2);
      const result = JSON.parse(ran.stdout) as {
        readonly outcome: string;
        readonly requests: readonly { readonly method: string }[];
        readonly entries: readonly { readonly outcome: string }[];
      };
      expect(result.outcome).toBe("blocked");
      expect(result.entries.map(entry => entry.outcome)).toEqual([
        "blocked",
        "blocked",
      ]);
      expect(readFileSync(path.join(repoPath, HANDOVER), "utf8")).toContain(
        LINT_CHECK
      );
      expect(recordedGhCalls(gh)).toEqual([
        `api ${API}/rulesets`,
        `api ${API}`,
      ]);
      expect(result.requests.map(request => request.method)).toEqual([
        "GET",
        "GET",
      ]);
      expect(ran.stderr).toMatch(/^protect: BLOCKED\./u);
    }
  );

  it("changes nothing on a second run", () => {
    const repoPath = repository(`https://github.com/${REPO}.git`);
    const gh = stub({ [`${API}/rulesets`]: [], [API]: READ_ONLY_REPOSITORY });
    protect(repoPath, gh);
    const written = readFileSync(path.join(repoPath, HANDOVER), "utf8");
    const before = runControlAuditGit(repoPath, STATUS);

    const second = protect(repoPath, gh);

    expect(second.status).toBe(2);
    expect(readFileSync(path.join(repoPath, HANDOVER), "utf8")).toBe(written);
    expect(runControlAuditGit(repoPath, STATUS)).toBe(before);
    expect(before).toBe("?? .lisa/");
  });

  it("reports wired and writes nothing when the checks are already required", () => {
    const repoPath = repository(`https://github.com/${REPO}.git`);
    const ruleset = statusCheckRuleset(7, "quality checks", [LINT_CHECK]);
    const gh = stub({
      [`${API}/rulesets`]: [
        { id: 7, name: "quality checks", target: "branch" },
      ],
      [`${API}/rulesets/7`]: ruleset,
      [API]: READ_ONLY_REPOSITORY,
    });

    const ran = protect(repoPath, gh);

    expect(ran.status).toBe(0);
    expect((JSON.parse(ran.stdout) as { outcome: string }).outcome).toBe(
      "wired"
    );
    expect(existsSync(path.join(repoPath, HANDOVER))).toBe(false);
    expect(runControlAuditGit(repoPath, STATUS)).toBe("");
  });
});

describe("built lisa controls protect on another platform", () => {
  it("never starts gh, and hands the change over", () => {
    const repoPath = repository("https://gitlab.com/group/project.git");
    const gh = stub({});

    const ran = protect(repoPath, gh, ["--apply"]);

    expect(ran.status).toBe(2);
    expect(recordedGhCalls(gh)).toEqual([]);
    expect(
      (JSON.parse(ran.stdout) as { platform: { name: string } }).platform.name
    ).toBe("gitlab");
    expect(readFileSync(path.join(repoPath, HANDOVER), "utf8")).toContain(
      "- Platform: GitLab"
    );
  });

  it("never starts gh in a repository with no remote", () => {
    const built = protectFixture();
    fixtures.push(built);
    const gh = stub({});

    const ran = protect(built.repoPath, gh, ["--apply"]);

    expect(ran.status).toBe(2);
    expect(recordedGhCalls(gh)).toEqual([]);
  });
});

describe("built lisa controls protect --help", () => {
  it("says that the command only reads unless --apply is given", () => {
    const built = protectFixture();
    fixtures.push(built);

    const ran = protect(built.repoPath, stub({}), ["--help"]);

    expect(ran.status).toBe(0);
    expect(ran.stdout).toContain("Reads only, unless --apply is given");
    expect(ran.stdout).toContain("--apply");
    expect(ran.stdout).toMatch(/2 {2}at least one register entry is blocked/u);
  });
});
