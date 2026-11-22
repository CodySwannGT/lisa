/**
 * `lisa controls protect` as a command: what it prints and how it exits.
 *
 * The enforce step reads the JSON document on stdout, so stdout carries that
 * document and nothing else; the line for a person goes to stderr. The exit
 * code tells "merge protection is in place" from "it is not" from "the
 * command could not tell" (CodySwannGT/lisa#4993).
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  PROTECT_BLOCKED_EXIT_CODE,
  runProtect,
} from "../../../src/controls/commands/protect.js";
import { protectRepository } from "../../../src/controls/protect.js";
import type { ProtectOptions } from "../../../src/controls/protect-prepare.js";
import {
  MERGE_PROTECTION_CHANGE_PATH,
  type ProtectResult,
} from "../../../src/controls/protect-types.js";
import type { ControlAuditFixture } from "../../helpers/control-audit-fixtures.js";
import {
  fakeGithub,
  statusCheckRuleset,
  type FakeGithub,
} from "./support/fake-github.js";
import {
  GITHUB_REMOTE,
  LINT_CHECK,
  REPO,
  protectFixture,
} from "./support/protect-fixture.js";

const fixtures: ControlAuditFixture[] = [];

/**
 * Remember a fixture so it is removed after the case.
 * @param built - The fixture
 * @returns The same fixture
 */
function keep(built: ControlAuditFixture): ControlAuditFixture {
  fixtures.push(built);
  return built;
}

/** What one run of the command printed, and how it exited. */
interface Ran {
  readonly code: number;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}

/**
 * Run the command against a fixture and the in-memory platform.
 * @param github - The in-memory platform
 * @param options - The command's options
 * @param target - The path argument; a fresh fixture when left out
 * @returns What it printed and how it exited
 */
async function run(
  github: FakeGithub,
  options: ProtectOptions = {},
  target?: string
): Promise<Ran> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const built = keep(protectFixture());
  const code = await runProtect(target ?? built.repoPath, options, {
    stdout: text => stdout.push(text),
    stderr: line => stderr.push(line),
    protect: (root, given) =>
      protectRepository(root, given, {
        gh: github.gh,
        readRemoteUrl: () => Promise.resolve(GITHUB_REMOTE),
      }),
  });
  return { code, stdout, stderr };
}

afterEach(() => {
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

describe("lisa controls protect, as a command", () => {
  it("exits 2 and prints the whole result when an entry is blocked", async () => {
    const ran = await run(fakeGithub({ repo: REPO, admin: false }));

    expect(ran.code).toBe(PROTECT_BLOCKED_EXIT_CODE);
    expect(ran.code).toBe(2);
    expect(ran.stdout).toHaveLength(1);
    const result = JSON.parse(ran.stdout[0] ?? "") as ProtectResult;
    expect(result.schema_version).toBe(1);
    expect(result.outcome).toBe("blocked");
    expect(result.entries).toHaveLength(2);
    expect(ran.stderr).toEqual([
      `protect: BLOCKED. ${result.reason} See ${MERGE_PROTECTION_CHANGE_PATH}`,
    ]);
  });

  it("exits 0 when every derived check is required", async () => {
    const ran = await run(
      fakeGithub({
        repo: REPO,
        admin: false,
        rulesets: [statusCheckRuleset(7, "quality checks", [LINT_CHECK])],
      })
    );

    expect(ran.code).toBe(0);
    const result = JSON.parse(ran.stdout[0] ?? "") as ProtectResult;
    expect(result.outcome).toBe("wired");
    expect(ran.stderr).toEqual([`protect: PASS. ${result.reason}`]);
  });

  it("exits 0 after applying and reading back the same set", async () => {
    const github = fakeGithub({ repo: REPO, admin: true });

    const ran = await run(github, { apply: true });

    expect(ran.code).toBe(0);
    expect(github.writes()).toHaveLength(1);
  });

  it("exits 1 with nothing on stdout when the path is not a folder", async () => {
    const github = fakeGithub({ repo: REPO, admin: true });

    const ran = await run(github, { apply: true }, "/no/such/folder");

    expect(ran.code).toBe(1);
    expect(ran.stdout).toEqual([]);
    expect(ran.stderr.at(-1)).toMatch(/^protect: FAIL\./u);
    expect(github.log).toEqual([]);
  });

  it.each(["--force", "main/../../other-owner/other-repo", "main?x=1"])(
    "exits 1 and sends nothing when the branch name is not one: %j",
    async branch => {
      const github = fakeGithub({ repo: REPO, admin: true });

      const ran = await run(github, { apply: true, branch });

      expect(ran.code).toBe(1);
      expect(ran.stdout).toEqual([]);
      expect(ran.stderr[0]).toMatch(/--branch takes a branch name/u);
      expect(github.log).toEqual([]);
    }
  );

  it("exits 1 and sends nothing when the gates declaration is refused", async () => {
    const built = keep(
      protectFixture({
        gates: { "code-style": { "pull-request": "sometimes" } },
      })
    );
    const github = fakeGithub({ repo: REPO, admin: true });

    const ran = await run(github, { apply: true }, built.repoPath);

    expect(ran.code).toBe(1);
    expect(ran.stdout).toEqual([]);
    expect(github.log).toEqual([]);
  });

  it("protects the branch it is told to, not the default one", async () => {
    const github = fakeGithub({
      repo: REPO,
      admin: false,
      rulesets: [
        statusCheckRuleset(7, "release", [LINT_CHECK], {
          conditions: {
            ref_name: { include: ["refs/heads/release/*"], exclude: [] },
          },
        }),
      ],
    });

    const onRelease = await run(github, { branch: "release/1" });
    const onDefault = await run(github);

    expect(onRelease.code).toBe(0);
    expect(
      (JSON.parse(onRelease.stdout[0] ?? "") as ProtectResult).branch
    ).toBe("release/1");
    expect(onDefault.code).toBe(2);
  });
});
