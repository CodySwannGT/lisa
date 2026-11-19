/**
 * What a push changes, as the gate runner reads it (CodySwannGT/lisa#4988).
 *
 * At push the change is the difference between what the remote holds and
 * what is being sent, one ref at a time. Git tells the push hook both ends of
 * every ref on standard input, and the runner is handed that list. Wherever
 * the list is missing, or one end of a ref is not there to compare, the
 * answer is "not known" and every part runs.
 * @module tests/unit/controls/changed-paths-push
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  changeAt,
  parsePushRefs,
} from "../../../all/copy-overwrite/scripts/lib/changed-paths.mjs";
import {
  buildFMixed,
  type ControlAuditFixture,
  controlAuditGitEnv,
  runControlAuditGit,
} from "../../helpers/control-audit-fixtures.js";
import {
  type Change,
  changeIn,
  commitFiles,
  MAIN_REF,
  NO_OBJECT,
  pushLine,
  pushRefsFile,
} from "../../support/part-scope-change.js";

const PUSH = "push";
const API_FILE = "api/src/fixture_mixed_api/new_module.py";
const WEB_FILE = "web/src/new.ts";
const OTHER_REF = "refs/heads/other";
const EVERY_PART = "Every part runs at push";

let fixture: ControlAuditFixture;
let seed: string;

beforeEach(() => {
  fixture = buildFMixed();
  seed = runControlAuditGit(fixture.repoPath, ["rev-parse", "HEAD"]);
});
afterEach(() => fixture.cleanup());

/**
 * Ask what a push changes, given the lines git handed the hook.
 * @param lines - The lines, as `pushLine` writes them
 * @returns What the runner knows
 */
function pushed(lines: readonly string[]): Change {
  return changeIn(fixture.repoPath, PUSH, {
    pushRefs: pushRefsFile(fixture.repoPath, lines),
  });
}

/**
 * Assert that a change is "not known", for a stated reason.
 * @param change - What the runner knows
 * @param reason - Words the operator must be given
 */
function expectEveryPart(change: Change, reason: string): void {
  expect(change.paths).toBeNull();
  expect(change.note).toContain(EVERY_PART);
  expect(change.note).toContain(reason);
}

describe("reading the refs git hands a push hook", () => {
  it("reads one update per line", () => {
    const local = "a".repeat(40);
    const remote = "b".repeat(40);

    expect(parsePushRefs(pushLine({ local, remote }))).toEqual([
      {
        localOid: local,
        localRef: MAIN_REF,
        remoteOid: remote,
        remoteRef: MAIN_REF,
      },
    ]);
  });

  it("reads a last line that has no line ending, and no lines at all", () => {
    const line = pushLine({ local: "a".repeat(40), remote: "b".repeat(40) });

    expect(parsePushRefs(line.trimEnd())).toHaveLength(1);
    expect(parsePushRefs("")).toEqual([]);
  });

  it.each([
    [
      "a line with a field missing",
      `${MAIN_REF} ${"a".repeat(40)} ${MAIN_REF}\n`,
    ],
    [
      "an object name that is not one",
      `${MAIN_REF} HEAD ${MAIN_REF} ${"b".repeat(40)}\n`,
    ],
    [
      "a range in place of an object name",
      `${MAIN_REF} ${"a".repeat(40)} ${MAIN_REF} main...other\n`,
    ],
    [
      "an option in place of an object name",
      `${MAIN_REF} --output=x ${MAIN_REF} ${"b".repeat(40)}\n`,
    ],
    ["text that is not a list of refs", "nothing to see here\n"],
  ])("refuses %s rather than guessing", (_name, text) => {
    expect(parsePushRefs(text)).toBeNull();
  });
});

describe("the paths a push changes", () => {
  it("is what differs between the remote's commit and the pushed one", () => {
    const head = commitFiles(fixture.repoPath, [API_FILE]);

    const change = pushed([pushLine({ local: head, remote: seed })]);

    expect(change.paths).toEqual([API_FILE]);
    expect(change.note).toContain("1 path");
  });

  it("covers every commit in the range, not only the last", () => {
    commitFiles(fixture.repoPath, [API_FILE]);
    const head = commitFiles(fixture.repoPath, [WEB_FILE]);

    expect(pushed([pushLine({ local: head, remote: seed })]).paths).toEqual([
      API_FILE,
      WEB_FILE,
    ]);
  });

  it("compares the two ends of a force push that rewrote the branch", () => {
    const before = commitFiles(fixture.repoPath, [API_FILE]);
    runControlAuditGit(fixture.repoPath, ["reset", "--quiet", "--hard", seed]);
    const after = commitFiles(fixture.repoPath, [WEB_FILE]);

    expect(pushed([pushLine({ local: after, remote: before })]).paths).toEqual([
      API_FILE,
      WEB_FILE,
    ]);
  });

  it("adds up the paths of every ref pushed together", () => {
    const api = commitFiles(fixture.repoPath, [API_FILE]);
    runControlAuditGit(fixture.repoPath, ["reset", "--quiet", "--hard", seed]);
    const web = commitFiles(fixture.repoPath, [WEB_FILE]);

    const change = pushed([
      pushLine({ local: api, remote: seed }),
      pushLine({ local: web, ref: OTHER_REF, remote: seed }),
    ]);

    expect(change.paths).toEqual([API_FILE, WEB_FILE]);
  });

  it("takes nothing from a ref that is being deleted", () => {
    const head = commitFiles(fixture.repoPath, [API_FILE]);

    const change = pushed([
      pushLine({ local: NO_OBJECT, ref: OTHER_REF, remote: seed }),
      pushLine({ local: head, remote: seed }),
    ]);

    expect(change.paths).toEqual([API_FILE]);
  });

  it("reads the file the shipped push hook names in the environment", () => {
    const head = commitFiles(fixture.repoPath, [API_FILE]);
    const file = pushRefsFile(fixture.repoPath, [
      pushLine({ local: head, remote: seed }),
    ]);

    const change = changeIn(fixture.repoPath, PUSH, {
      env: { LISA_PUSHED_REFS_FILE: file },
    });

    expect(change.paths).toEqual([API_FILE]);
  });

  it("prefers the file the caller named to the one in the environment", () => {
    const head = commitFiles(fixture.repoPath, [API_FILE]);
    const named = pushRefsFile(fixture.repoPath, [
      pushLine({ local: head, remote: seed }),
    ]);

    const change = changeIn(fixture.repoPath, PUSH, {
      env: { LISA_PUSHED_REFS_FILE: "no-such-file" },
      pushRefs: named,
    });

    expect(change.paths).toEqual([API_FILE]);
  });

  it("reads standard input when the caller names it", () => {
    const head = commitFiles(fixture.repoPath, [API_FILE]);
    const sources: string[] = [];

    const change = changeAt({
      env: controlAuditGitEnv(),
      moment: PUSH,
      pushRefs: "-",
      read: (source: string) => {
        sources.push(source);
        return pushLine({ local: head, remote: seed });
      },
      root: fixture.repoPath,
    }) as Change;

    expect(sources).toEqual(["-"]);
    expect(change.paths).toEqual([API_FILE]);
  });
});

describe("a push whose changed paths are not known", () => {
  it("is every part when the caller did not say what is being pushed", () => {
    commitFiles(fixture.repoPath, [API_FILE]);

    expectEveryPart(changeIn(fixture.repoPath, PUSH), "--push-refs");
  });

  it("is every part when the named file cannot be read", () => {
    expectEveryPart(
      changeIn(fixture.repoPath, PUSH, { pushRefs: "no-such-file" }),
      "could not be read"
    );
  });

  it("is every part when git handed the hook no refs", () => {
    expectEveryPart(pushed([]), "is empty");
  });

  it("is every part when a line is not one git writes", () => {
    expectEveryPart(pushed(["not a ref line\n"]), "not written the way git");
  });

  it("is every part when a branch is new on the remote", () => {
    const head = commitFiles(fixture.repoPath, [API_FILE]);

    expectEveryPart(
      pushed([pushLine({ local: head, ref: OTHER_REF, remote: NO_OBJECT })]),
      `"${OTHER_REF}" is new on the remote`
    );
  });

  it("is every part when a tag is pushed for the first time", () => {
    const head = commitFiles(fixture.repoPath, [API_FILE]);

    expectEveryPart(
      pushed([
        pushLine({ local: head, ref: "refs/tags/v1", remote: NO_OBJECT }),
      ]),
      "is new on the remote"
    );
  });

  it("is every part when one ref of several cannot be compared", () => {
    const head = commitFiles(fixture.repoPath, [API_FILE]);

    expectEveryPart(
      pushed([
        pushLine({ local: head, remote: seed }),
        pushLine({ local: head, ref: OTHER_REF, remote: NO_OBJECT }),
      ]),
      "is new on the remote"
    );
  });

  it("is every part when the remote's commit is not in this repository", () => {
    const head = commitFiles(fixture.repoPath, [API_FILE]);

    expectEveryPart(
      pushed([pushLine({ local: head, remote: "1".repeat(40) })]),
      "could not compare"
    );
  });

  it("is every part when the push changes no file", () => {
    expectEveryPart(
      pushed([pushLine({ local: NO_OBJECT, ref: OTHER_REF, remote: seed })]),
      "changes no path"
    );
  });

  it("is every part when the push edits the declaration itself", () => {
    const head = commitFiles(fixture.repoPath, [API_FILE, ".lisa.config.json"]);

    expectEveryPart(
      pushed([pushLine({ local: head, remote: seed })]),
      ".lisa.config.json"
    );
  });

  it("is every part when more refs are pushed than it will compare", () => {
    const head = commitFiles(fixture.repoPath, [API_FILE]);
    const many = Array.from({ length: 101 }, (_unused, index) =>
      pushLine({ local: head, ref: `refs/heads/b${index}`, remote: seed })
    );

    expectEveryPart(pushed(many), "101 refs");
  });
});
