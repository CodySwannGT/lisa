/**
 * `lisa controls protect` without permission to change merge protection, and
 * without being told to change it.
 *
 * Changing what a repository requires before a merge is hard to undo and is
 * often not Lisa's to do. So the safe result is the default: the command reads
 * the platform, compares, and writes a file an administrator can act on. It
 * sends a change only when it was asked to with `--apply` and a read has
 * confirmed the signed-in account may make it. Every case here asserts the
 * request log, not only the conclusion (CodySwannGT/lisa#4993).
 */
import { afterEach, describe, expect, it } from "vitest";

import { MERGE_PROTECTION_CHANGE_PATH } from "../../../src/controls/protect-types.js";
import type { ControlAuditFixture } from "../../helpers/control-audit-fixtures.js";
import { fakeGithub, statusCheckRuleset } from "./support/fake-github.js";
import {
  LINT_CHECK,
  REPO,
  handover,
  protect,
  protectFixture,
  type ProtectFixtureOptions,
} from "./support/protect-fixture.js";

const QUALITY_RULESET = "quality checks";
const fixtures: ControlAuditFixture[] = [];

/**
 * Build a fixture that is removed after the case.
 * @param options - How it differs from F-mixed with its declaration
 * @returns The repository root
 */
function repository(options: ProtectFixtureOptions = {}): string {
  const built = protectFixture(options);
  fixtures.push(built);
  return built.repoPath;
}

afterEach(() => {
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

describe("lisa controls protect with read-only credentials", () => {
  it("writes the handover file, reports blocked and sends no write", async () => {
    const repoPath = repository();
    const github = fakeGithub({ repo: REPO, admin: false });

    const result = await protect(repoPath, github);

    expect(result.outcome).toBe("blocked");
    expect(result.handover).toEqual({
      path: MERGE_PROTECTION_CHANGE_PATH,
      action: "written",
    });
    expect(handover(repoPath)).toContain(LINT_CHECK);
    expect(github.writes()).toEqual([]);
    expect(github.log.map(request => request.method)).toEqual(["GET", "GET"]);
    expect(result.requests.every(request => request.method === "GET")).toBe(
      true
    );
  });

  it("sends no write even when told to apply", async () => {
    const repoPath = repository();
    const github = fakeGithub({ repo: REPO, admin: false });

    const result = await protect(repoPath, github, { apply: true });

    expect(result.mode).toBe("apply");
    expect(result.outcome).toBe("blocked");
    expect(result.permission.can_change).toBe(false);
    expect(result.reason).toMatch(/administrator/u);
    expect(github.writes()).toEqual([]);
    expect(handover(repoPath)).not.toBeNull();
  });

  it("treats a permission the platform did not state as no permission", async () => {
    const repoPath = repository();
    const github = fakeGithub({ repo: REPO, admin: null });

    const result = await protect(repoPath, github, { apply: true });

    expect(result.permission.can_change).toBeNull();
    expect(result.outcome).toBe("blocked");
    expect(github.writes()).toEqual([]);
  });

  it("reports every entry and requirement as blocked, with the reason", async () => {
    const repoPath = repository();
    const github = fakeGithub({ repo: REPO, admin: false });

    const result = await protect(repoPath, github, { apply: true });

    expect(result.entries.map(entry => entry.id)).toEqual([
      "code-style@api",
      "code-style@web",
    ]);
    result.entries.forEach(entry => {
      expect(entry.outcome).toBe("blocked");
      expect(entry.checks).toEqual([LINT_CHECK]);
      expect(entry.criteria).toEqual([
        { criterion: "SI7", outcome: "blocked", reason: entry.reason },
      ]);
      expect(entry.reason).toMatch(/administrator/u);
    });
  });
});

describe("lisa controls protect without --apply", () => {
  it("changes nothing even when the account could", async () => {
    const repoPath = repository();
    const github = fakeGithub({ repo: REPO, admin: true });

    const result = await protect(repoPath, github);

    expect(result.mode).toBe("read-only");
    expect(result.permission.can_change).toBe(true);
    expect(result.outcome).toBe("blocked");
    expect(result.reason).toMatch(/--apply/u);
    expect(github.writes()).toEqual([]);
    expect(result.differences).toEqual([
      `\`${LINT_CHECK}\` is not required on \`main\`.`,
    ]);
  });

  it("reports wired, with no handover, when the checks are already required", async () => {
    const repoPath = repository();
    const github = fakeGithub({
      repo: REPO,
      admin: false,
      rulesets: [statusCheckRuleset(7, QUALITY_RULESET, [LINT_CHECK])],
    });

    const result = await protect(repoPath, github);

    expect(result.outcome).toBe("wired");
    expect(result.differences).toEqual([]);
    expect(result.entries.map(entry => entry.outcome)).toEqual([
      "wired",
      "wired",
    ]);
    expect(result.handover.action).toBe("none");
    expect(handover(repoPath)).toBeNull();
    expect(github.writes()).toEqual([]);
  });

  it("does not count a ruleset that is not enforced on the branch", async () => {
    const repoPath = repository();
    const github = fakeGithub({
      repo: REPO,
      admin: false,
      rulesets: [
        statusCheckRuleset(7, QUALITY_RULESET, [LINT_CHECK], {
          enforcement: "disabled",
        }),
        statusCheckRuleset(8, "release only", [LINT_CHECK], {
          conditions: {
            ref_name: { include: ["refs/heads/release"], exclude: [] },
          },
        }),
      ],
    });

    const result = await protect(repoPath, github);

    expect(result.outcome).toBe("blocked");
    expect(result.required_checks.map(check => check.state)).toEqual([
      "missing",
    ]);
  });

  it("removes a handover file that no longer applies", async () => {
    const repoPath = repository();
    await protect(repoPath, fakeGithub({ repo: REPO, admin: false }));
    expect(handover(repoPath)).not.toBeNull();

    const result = await protect(
      repoPath,
      fakeGithub({
        repo: REPO,
        admin: false,
        rulesets: [statusCheckRuleset(7, QUALITY_RULESET, [LINT_CHECK])],
      })
    );

    expect(result.handover.action).toBe("removed");
    expect(handover(repoPath)).toBeNull();
  });

  it("rewrites nothing on a second run with no change", async () => {
    const repoPath = repository();
    const first = await protect(
      repoPath,
      fakeGithub({ repo: REPO, admin: false })
    );
    const written = handover(repoPath);

    const second = await protect(
      repoPath,
      fakeGithub({ repo: REPO, admin: false })
    );

    expect(first.handover.action).toBe("written");
    expect(second.handover.action).toBe("unchanged");
    expect(handover(repoPath)).toBe(written);
    expect({ ...second, handover: first.handover }).toEqual(first);
  });

  it("reports blocked, and says why, when the platform cannot be read", async () => {
    const repoPath = repository();
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      readFailure: "Not Found",
    });

    const result = await protect(repoPath, github, { apply: true });

    expect(result.outcome).toBe("blocked");
    expect(result.permission.can_change).toBeNull();
    expect(result.reason).toMatch(/could not be read/u);
    expect(result.reason).toContain("Not Found");
    expect(github.writes()).toEqual([]);
    expect(handover(repoPath)).not.toBeNull();
  });
});
