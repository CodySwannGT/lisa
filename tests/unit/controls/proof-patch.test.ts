/**
 * Planting a proof's change, and taking it back out (CodySwannGT/lisa#4995).
 *
 * A patch file is content somebody committed. Applying it must do exactly
 * what it says or nothing at all, must say so plainly when it cannot, and
 * must never reach a file outside the folder it was told to work in —
 * whatever the patch names and whatever repository the environment points
 * at.
 * @module tests/unit/controls/proof-patch
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyProofPatch,
  readProofPatch,
} from "../../../src/controls/proof-patch.js";
import { runControlAuditGit } from "../../helpers/control-audit-fixtures.js";
import { appendLinePatch, PROOFS } from "../../helpers/control-proofs.js";
import { createSymlink } from "../../support/borrowed-node-modules.mjs";

const SOURCE = "src/thing.txt";
const BEFORE = "one\ntwo\n";
/** The header of a patch that creates a file. */
const FROM_NOTHING = "--- /dev/null";

/** The hunk header of a one-line new file. */
const ONE_NEW_LINE = "@@ -0,0 +1 @@";

const ADDS_THREE = appendLinePatch(SOURCE, BEFORE, "three");

/**
 * A patch that creates one file.
 * @param file - The path the patch names
 * @returns The patch file's content
 */
function creates(file: string): string {
  return [FROM_NOTHING, `+++ ${file}`, ONE_NEW_LINE, "+planted", ""].join("\n");
}

describe("planting a change", () => {
  let sandbox: string;
  let workspace: string;
  let outside: string;

  beforeEach(() => {
    sandbox = realpathSync(mkdtempSync(path.join(tmpdir(), "lisa-patch-")));
    workspace = path.join(sandbox, "workspace");
    outside = path.join(sandbox, "outside");
    mkdirSync(path.join(workspace, "src"), { recursive: true });
    mkdirSync(outside);
    writeFileSync(path.join(workspace, SOURCE), BEFORE);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(sandbox, { force: true, recursive: true });
  });

  it("makes the change in a folder that is not a git repository", () => {
    expect(applyProofPatch(workspace, ADDS_THREE)).toEqual({ problem: null });
    expect(readFileSync(path.join(workspace, SOURCE), "utf8")).toBe(
      `${BEFORE}three\n`
    );
  });

  it("takes the change back out, leaving the file as it was", () => {
    applyProofPatch(workspace, ADDS_THREE);

    expect(applyProofPatch(workspace, ADDS_THREE, { reverse: true })).toEqual({
      problem: null,
    });
    expect(readFileSync(path.join(workspace, SOURCE), "utf8")).toBe(BEFORE);
  });

  it("makes the change in a git repository without touching what is staged", () => {
    runControlAuditGit(workspace, ["init", "--quiet"]);
    runControlAuditGit(workspace, ["add", "--all"]);

    expect(applyProofPatch(workspace, ADDS_THREE)).toEqual({ problem: null });
    expect(runControlAuditGit(workspace, ["status", "--short"])).toBe(
      `AM ${SOURCE}`
    );
  });

  it("says why a change that does not fit was not made, and changes nothing", () => {
    writeFileSync(path.join(workspace, SOURCE), "something else\n");

    const outcome = applyProofPatch(workspace, ADDS_THREE);

    expect(outcome.problem).toContain("patch does not apply");
    expect(outcome.problem).toContain(SOURCE);
    expect(readFileSync(path.join(workspace, SOURCE), "utf8")).toBe(
      "something else\n"
    );
  });

  it("makes none of a change when one file of it does not fit", () => {
    const both = `${creates("b/src/new.txt")}${appendLinePatch("src/absent.txt", BEFORE, "three")}`;

    expect(applyProofPatch(workspace, both).problem).not.toBeNull();
    expect(readdirSync(path.join(workspace, "src"))).toEqual(["thing.txt"]);
  });

  it.each([
    ["nothing at all", ""],
    ["text that is not a patch", "this is not a patch\n"],
  ])("refuses a patch file holding %s", (_, patch) => {
    expect(applyProofPatch(workspace, patch).problem).toContain(
      "No valid patches"
    );
  });

  it.each([
    ["a path that climbs out of the folder", "b/../outside/planted.txt"],
    ["a path into the folder's own .git", "b/.git/hooks/pre-commit"],
  ])("refuses %s", (_, file) => {
    const outcome = applyProofPatch(workspace, creates(file));

    expect(outcome.problem).toContain("invalid path");
    expect(readdirSync(outside)).toEqual([]);
    expect(existsSync(path.join(workspace, ".git"))).toBe(false);
  });

  it("refuses a path that goes through a link out of the folder", () => {
    createSymlink(outside, path.join(workspace, "link"));

    const outcome = applyProofPatch(workspace, creates("b/link/planted.txt"));

    expect(outcome.problem).toContain("beyond a symbolic link");
    expect(readdirSync(outside)).toEqual([]);
  });

  it("refuses a change that makes such a link and then writes through it", () => {
    const patch = [
      "diff --git a/link b/link",
      "new file mode 120000",
      FROM_NOTHING,
      "+++ b/link",
      ONE_NEW_LINE,
      "+../outside",
      "\\ No newline at end of file",
      "diff --git a/link/planted.txt b/link/planted.txt",
      "new file mode 100644",
      FROM_NOTHING,
      "+++ b/link/planted.txt",
      ONE_NEW_LINE,
      "+planted",
      "",
    ].join("\n");

    expect(applyProofPatch(workspace, patch).problem).toContain(
      "beyond a symbolic link"
    );
    expect(readdirSync(outside)).toEqual([]);
    expect(existsSync(path.join(workspace, "link"))).toBe(false);
  });

  it("keeps a path written from the top of the disk inside the folder", () => {
    const target = path.join(outside, "planted.txt");

    applyProofPatch(workspace, creates(target));

    expect(existsSync(target)).toBe(false);
    expect(readdirSync(outside)).toEqual([]);
  });

  it("works in the folder it was given when the environment points git at another repository", () => {
    const other = path.join(sandbox, "other");
    mkdirSync(path.join(other, "src"), { recursive: true });
    writeFileSync(path.join(other, SOURCE), BEFORE);
    runControlAuditGit(other, ["init", "--quiet"]);
    vi.stubEnv("GIT_DIR", path.join(other, ".git"));
    vi.stubEnv("GIT_WORK_TREE", other);
    vi.stubEnv("GIT_INDEX_FILE", path.join(other, ".git", "index"));

    expect(applyProofPatch(workspace, ADDS_THREE)).toEqual({ problem: null });
    expect(readFileSync(path.join(other, SOURCE), "utf8")).toBe(BEFORE);
    expect(readFileSync(path.join(workspace, SOURCE), "utf8")).toBe(
      `${BEFORE}three\n`
    );
  });

  it("works in the folder it was given when that folder sits inside a repository", () => {
    writeFileSync(path.join(sandbox, "thing.txt"), BEFORE);
    mkdirSync(path.join(sandbox, "src"));
    writeFileSync(path.join(sandbox, SOURCE), BEFORE);
    runControlAuditGit(sandbox, ["init", "--quiet"]);

    expect(applyProofPatch(workspace, ADDS_THREE)).toEqual({ problem: null });
    expect(readFileSync(path.join(sandbox, SOURCE), "utf8")).toBe(BEFORE);
    expect(readFileSync(path.join(workspace, SOURCE), "utf8")).toBe(
      `${BEFORE}three\n`
    );
  });
});

describe("reading a proof's patch file", () => {
  const file = `${PROOFS}/lint.violation.patch`;
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "lisa-patch-read-")));
    mkdirSync(path.join(root, PROOFS), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it("returns the file's content", async () => {
    writeFileSync(path.join(root, file), ADDS_THREE);

    expect(await readProofPatch(root, file)).toEqual({
      kind: "text",
      text: ADDS_THREE,
    });
  });

  it("says a file that is not there is missing", async () => {
    expect(await readProofPatch(root, file)).toEqual({ kind: "missing" });
  });

  it("says a file is missing when its folder is", async () => {
    rmSync(path.join(root, ".lisa"), { recursive: true });

    expect(await readProofPatch(root, file)).toEqual({ kind: "missing" });
  });

  it("does not read a link in place of the file", async () => {
    const elsewhere = path.join(root, "elsewhere.patch");
    writeFileSync(elsewhere, ADDS_THREE);
    createSymlink(elsewhere, path.join(root, file));

    expect(await readProofPatch(root, file)).toMatchObject({
      kind: "unreadable",
      problem: expect.stringContaining("not an ordinary file"),
    });
  });

  it("does not read through a link in place of the proofs folder", async () => {
    const elsewhere = path.join(root, "elsewhere");
    mkdirSync(elsewhere);
    writeFileSync(path.join(elsewhere, "lint.violation.patch"), ADDS_THREE);
    rmSync(path.join(root, PROOFS), { recursive: true });
    createSymlink(elsewhere, path.join(root, PROOFS));

    expect(await readProofPatch(root, file)).toMatchObject({
      kind: "unreadable",
      problem: expect.stringContaining("not an ordinary folder"),
    });
  });

  it.each([
    "proofs/lint.violation.patch",
    `${PROOFS}/../../../outside.patch`,
    `${PROOFS}/`,
  ])(
    "does not read %j, which is not a file under the proofs folder",
    async named => {
      expect(await readProofPatch(root, named)).toMatchObject({
        kind: "unreadable",
        problem: expect.stringContaining(PROOFS),
      });
    }
  );
});
