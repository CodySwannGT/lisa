/**
 * The administrator handover never carries a secret's value.
 *
 * The handover is committed and passed to someone outside the team, and
 * part of what it says is read from outside the repository: the remote
 * address, the branch, the names a hosting platform gave its checks. A
 * value shaped like a credential is taken out as the file is written, and
 * the command goes on, because nobody typed that text and nobody can be
 * asked to correct it.
 *
 * Every credential-shaped value in this suite is made up when the test runs.
 * None is written in this file (CodySwannGT/lisa#4999).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { syncHandover } from "../../../src/controls/protect-handover-file.js";
import { MERGE_PROTECTION_CHANGE_PATH } from "../../../src/controls/protect-types.js";
import { credentialKinds } from "../../../src/controls/secret-scan.js";
import type { ControlAuditFixture } from "../../helpers/control-audit-fixtures.js";
import { fakeGithubToken } from "../../helpers/fake-credentials.js";
import { fakeGithub } from "./support/fake-github.js";
import {
  LINT_CHECK,
  REPO,
  handover,
  protect,
  protectFixture,
} from "./support/protect-fixture.js";

const TOKEN = fakeGithubToken();
const roots: string[] = [];
const fixtures: ControlAuditFixture[] = [];

/**
 * Make an empty folder that is removed after the case.
 * @returns Its path
 */
function emptyRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-handover-secret-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  roots.splice(0).forEach(root => {
    rmSync(root, { recursive: true, force: true });
  });
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

describe("writing the handover", () => {
  it("takes a credential-shaped value out and writes the rest", async () => {
    const root = emptyRoot();
    const text = `# Merge protection change needed\n\n- Repository: https://ci:${TOKEN}@example.invalid/example/widgets\n`;

    const synced = await syncHandover(root, text);
    const written = readFileSync(
      path.join(root, MERGE_PROTECTION_CHANGE_PATH),
      "utf8"
    );

    expect(synced).toMatchObject({ handover: { action: "written" } });
    expect(written).toBe(
      "# Merge protection change needed\n\n- Repository: https://[REDACTED:URL_CREDENTIALS]@example.invalid/example/widgets\n"
    );
    expect(written).not.toContain(TOKEN);
  });

  it("finds the file unchanged on a second run with the same facts", async () => {
    const root = emptyRoot();
    const text = `Checks reported by ${TOKEN}.\n`;
    await syncHandover(root, text);

    const again = await syncHandover(root, text);

    expect(again).toMatchObject({ handover: { action: "unchanged" } });
  });

  it("writes text that holds no such value exactly as it was given", async () => {
    const root = emptyRoot();
    const text = "# Merge protection change needed\n\n- Branch: `main`\n";

    await syncHandover(root, text);

    expect(
      readFileSync(path.join(root, MERGE_PROTECTION_CHANGE_PATH), "utf8")
    ).toBe(text);
  });
});

describe("the handover a repository gets when its remote address carries a token", () => {
  it("names the checks to require and holds nothing shaped like a credential", async () => {
    const built = protectFixture();
    fixtures.push(built);
    const github = fakeGithub({ repo: REPO, admin: false });

    const result = await protect(
      built.repoPath,
      github,
      {},
      {
        readRemoteUrl: () =>
          Promise.resolve(
            `https://x-access-token:${TOKEN}@github.com/${REPO}.git`
          ),
      }
    );
    const text = handover(built.repoPath) ?? "";

    expect(result.handover.action).toBe("written");
    expect(text).toContain(LINT_CHECK);
    expect(text).not.toContain(TOKEN);
    expect(credentialKinds(text)).toEqual([]);
  });
});
