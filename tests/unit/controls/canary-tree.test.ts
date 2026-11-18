/**
 * The commit a canary carries (CodySwannGT/lisa#4997).
 *
 * A canary must be exactly the protected branch's head with one patch
 * applied: a file that loses its executable bit, or a file that is carried
 * over from the operator's own checkout, would make the platform's check
 * answer a different question from the one the proof asks.
 * @module tests/unit/controls/canary-tree
 */
import { describe, expect, it } from "vitest";

import { canaryDoor } from "../../../src/controls/canary-door.js";
import {
  buildCanaryCommit,
  readBase,
} from "../../../src/controls/canary-tree.js";
import { recordRequests } from "../../../src/controls/protect-requests.js";
import { appendLinePatch } from "../../helpers/control-proofs.js";
import { canaryPlatform } from "./support/canary-run.js";
import type { FakeCanaryPlatform } from "./support/fake-canary-platform.js";
import { REPO } from "./support/protect-fixture.js";

const SCRIPT = "tools/deep/run.sh";
const SCRIPT_TEXT = "#!/bin/sh\necho ok\n";
const NOTES = "docs/notes.md";
const NOTES_TEXT = "one\ntwo\n";

/** The default branch: a script anyone may run, and a text file. */
const FILES = {
  [`${SCRIPT}*`]: SCRIPT_TEXT,
  [NOTES]: NOTES_TEXT,
  "README.md": "# A fixture repository\n",
};

/** A patch that adds one line to the script. */
const CHANGES_SCRIPT = appendLinePatch(SCRIPT, SCRIPT_TEXT, "echo changed");

/** What building gives for a patch that cannot be put on a canary. */
const NOT_APPLIED = { ok: false, reason: "patch-not-applied" };

/** A patch that removes {@link NOTES} and adds a new file beside it. */
const REPLACES_NOTES = [
  `--- a/${NOTES}`,
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-one",
  "-two",
  "--- /dev/null",
  "+++ b/docs/added.md",
  "@@ -0,0 +1 @@",
  "+brand new",
  "",
].join("\n");

/**
 * Build a canary commit on the in-memory platform.
 * @param patch - The patch to apply to the default branch's head
 * @param platform - The platform
 * @returns What building gave, and the platform it was built on
 */
function build(patch: string, platform = canaryPlatform({ files: FILES })) {
  const door = canaryDoor(recordRequests(platform.gh), REPO, true);
  const based = readBase(door, "main");
  if (!based.ok) throw new Error(based.problem);
  return {
    platform,
    commit: buildCanaryCommit(door, based.base, patch, "a canary"),
  };
}

/**
 * The files of a commit that was built.
 * @param built - What building gave
 * @param built.platform - The platform
 * @param built.commit - The commit, or why there is none
 * @returns The commit id, its files and their modes
 */
function contents(built: {
  readonly platform: FakeCanaryPlatform;
  readonly commit: ReturnType<typeof buildCanaryCommit>;
}) {
  if (!built.commit.ok) throw new Error(built.commit.problem);
  return {
    files: Object.fromEntries(built.platform.filesAt(built.commit.sha)),
    modes: Object.fromEntries(built.platform.modesAt(built.commit.sha)),
  };
}

describe("a canary commit", () => {
  it("is the base commit with the patch applied, and nothing else changed", () => {
    const built = contents(build(CHANGES_SCRIPT));

    expect(built.files).toEqual({
      [SCRIPT]: `${SCRIPT_TEXT}echo changed\n`,
      [NOTES]: NOTES_TEXT,
      "README.md": "# A fixture repository\n",
    });
  });

  it("keeps a patched file runnable when it was runnable", () => {
    const built = contents(build(CHANGES_SCRIPT));

    expect(built.modes).toMatchObject({
      [SCRIPT]: "100755",
      [NOTES]: "100644",
    });
  });

  it("carries a file the patch adds and drops a file the patch removes", () => {
    const built = contents(build(REPLACES_NOTES));

    expect(new Set(Object.keys(built.files))).toEqual(
      new Set(["README.md", "docs/added.md", SCRIPT])
    );
    expect(built.files["docs/added.md"]).toBe("brand new\n");
  });

  it("does not move the branch it is built on", () => {
    const platform = canaryPlatform({ files: FILES });
    const before = platform.head("main");

    build(CHANGES_SCRIPT, platform);

    expect(platform.head("main")).toBe(before);
    expect(platform.branches()).toEqual(["main"]);
  });
});

describe("a patch that cannot be put on a canary", () => {
  it("is reported with git's reason when it does not apply to the base commit", () => {
    const { commit, platform } = build(
      appendLinePatch(NOTES, "something else entirely\n", "added")
    );

    expect(commit).toMatchObject(NOT_APPLIED);
    expect(commit.ok ? "" : commit.problem).toContain(
      "git did not apply the patch"
    );
    // Nothing was stored on the platform for it.
    expect(platform.log.filter(request => request.method !== "GET")).toEqual(
      []
    );
  });

  it.each(["../outside.txt", ".git/config", "docs/../../outside.txt"])(
    "is refused when it names %s, before anything is fetched or written",
    name => {
      const { commit, platform } = build(
        ["--- /dev/null", `+++ b/${name}`, "@@ -0,0 +1 @@", "+x", ""].join("\n")
      );

      expect(commit).toMatchObject(NOT_APPLIED);
      expect(
        platform.log.filter(request => request.path.includes("/git/trees/"))
      ).toEqual([]);
    }
  );

  it("is reported when it is not a patch at all", () => {
    const { commit } = build("this is not a patch\n");

    expect(commit).toMatchObject(NOT_APPLIED);
  });

  it("is reported as the platform's failure when a file cannot be stored", () => {
    const platform = canaryPlatform({
      files: FILES,
      refuse: request =>
        request.path.endsWith("/git/blobs") ? "Server Error" : undefined,
    });

    const { commit } = build(CHANGES_SCRIPT, platform);

    expect(commit).toMatchObject({ ok: false, reason: "not-started" });
    expect(commit.ok ? "" : commit.problem).toContain("Server Error");
  });
});

describe("the commit a canary is built on", () => {
  it("is the head of the protected branch", () => {
    const platform = canaryPlatform({ files: FILES });
    const door = canaryDoor(recordRequests(platform.gh), REPO, false);

    expect(readBase(door, "main")).toMatchObject({
      ok: true,
      base: { sha: platform.head("main") },
    });
  });

  it("is reported as unreadable when the branch is not there", () => {
    const platform = canaryPlatform({ files: FILES });
    const door = canaryDoor(recordRequests(platform.gh), REPO, false);

    expect(readBase(door, "no-such-branch")).toMatchObject({ ok: false });
  });
});
