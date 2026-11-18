/**
 * The digest evidence is bound to: what it covers, and where each file is
 * read.
 *
 * A verdict is about the checks as they were proved. So an attest run takes
 * one digest over everything that defines the checks, in the copy the
 * proofs ran in, and `lisa controls attest --check` takes it again from the
 * repository as it is. It is taken from content alone: no folder in this
 * suite is a git repository, and none needs to be.
 */
import { rmSync, symlinkSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  bindChecks,
  bindingDifferences,
  digestOfCovered,
} from "../../../src/controls/checks-binding.js";
import {
  CLEAN_PATCH,
  COMMIT_HOOK,
  DECLARATION,
  declarationOf,
  DEFINING_FILES,
  definingFolder,
  emptyFolder,
  GATES,
  gatesDigestOf,
  PLACED,
  put,
  RECORD,
  recordOf,
  removeFolders,
  RUNNER,
  sha256Of,
  VIOLATION_PATCH,
} from "./support/binding-folders.js";

const HUSKY_HOOK = ".husky/pre-commit";

/** A file outside the folder, for a link to point at. */
const OUTSIDE_FILE = "runner.mjs";

/** What the sample folder's gate runner holds. */
const RUNNER_CONTENT = DEFINING_FILES[RUNNER] ?? "";
const NO_CHANGE = { added: [], changed: [], gone: [] };

/**
 * The digest of one covered path.
 * @param root - The folder
 * @param file - The path
 * @returns Its digest, or `undefined` when the path is not covered
 */
async function digestAt(
  root: string,
  file: string
): Promise<string | undefined> {
  const { covered } = await bindChecks({ repository: root });
  return covered.find(each => each.path === file)?.sha256;
}

afterEach(() => {
  removeFolders();
});

describe("the digest of what defines the checks", () => {
  it("covers the gates block, the proofs, the carrier record and what it lists, the hook scripts and the gate runner, in path order", async () => {
    const root = definingFolder({
      ".lisa/hooks/lib/reach.mjs": "export {};\n",
    });

    const binding = await bindChecks({ repository: root });

    expect(binding.covered.map(file => file.path)).toEqual([
      DECLARATION,
      RECORD,
      CLEAN_PATCH,
      VIOLATION_PATCH,
      ".lisa/hooks/lib/reach.mjs",
      COMMIT_HOOK,
      RUNNER,
      PLACED,
    ]);
    expect(binding.digest).toBe(digestOfCovered(binding.covered));
    expect(binding.digest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("gives each file the digest of its bytes, and the declaration the digest of its gates block", async () => {
    const root = definingFolder();

    expect(await digestAt(root, RUNNER)).toBe(sha256Of(RUNNER_CONTENT));
    expect(await digestAt(root, DECLARATION)).toBe(gatesDigestOf(GATES));
  });

  it.each([
    ["another setting of the declaration changes", { harness: "codex" }],
    ["a setting is added to the declaration", { harness: "claude", x: 1 }],
    ["every other setting is taken out", {}],
  ])("is the same when %s", async (_name, others) => {
    const before = await bindChecks({ repository: definingFolder() });
    const after = await bindChecks({
      repository: definingFolder({
        [DECLARATION]: declarationOf(GATES, others),
      }),
    });

    expect(after.digest).toBe(before.digest);
  });

  it("is the same when the declaration is laid out differently", async () => {
    const before = await bindChecks({ repository: definingFolder() });
    const after = await bindChecks({
      repository: definingFolder({
        [DECLARATION]: JSON.stringify({ gates: GATES, harness: "claude" }),
      }),
    });

    expect(after.digest).toBe(before.digest);
  });

  it("changes when the gates block changes", async () => {
    const before = await bindChecks({ repository: definingFolder() });
    const after = await bindChecks({
      repository: definingFolder({
        [DECLARATION]: declarationOf({ "code-style": { commit: "optional" } }),
      }),
    });

    expect(bindingDifferences(before, after)).toEqual({
      ...NO_CHANGE,
      changed: [DECLARATION],
    });
  });

  it.each([VIOLATION_PATCH, CLEAN_PATCH, RECORD, COMMIT_HOOK, RUNNER, PLACED])(
    "changes when one byte of %s changes",
    async file => {
      const before = await bindChecks({ repository: definingFolder() });
      const after = await bindChecks({
        repository: definingFolder({
          [file]: `${DEFINING_FILES[file] ?? ""} `,
        }),
      });

      expect(after.digest).not.toBe(before.digest);
    }
  );

  it.each([
    ["a source file changes", "src/app.py"],
    ["the checked tool's own set-up changes", "Makefile"],
  ])("is the same when %s: that is not in what it covers", async (_n, file) => {
    const before = await bindChecks({ repository: definingFolder() });
    const after = await bindChecks({
      repository: definingFolder({ [file]: "changed\n" }),
    });

    expect(after).toEqual(before);
  });

  it("leaves out what is not there, a path into git's own folder and a path that leads out", async () => {
    const root = definingFolder({
      [RECORD]: recordOf([
        COMMIT_HOOK,
        "scripts/not-there.mjs",
        ".git/hooks/pre-commit",
        "../outside.sh",
      ]),
      ".git/hooks/pre-commit": "#!/bin/sh\n",
    });
    rmSync(path.join(root, RUNNER));

    const { covered } = await bindChecks({ repository: root });

    expect(covered.map(file => file.path)).toEqual([
      DECLARATION,
      RECORD,
      CLEAN_PATCH,
      VIOLATION_PATCH,
      COMMIT_HOOK,
    ]);
  });

  it("is of nothing but the declaration's absence in a folder that holds none of it", async () => {
    const binding = await bindChecks({ repository: emptyFolder() });

    expect(binding.covered).toEqual([]);
    expect(binding.digest).toBe(digestOfCovered([]));
  });

  it("covers a link where a file should be as a link, and reads nothing through it", async () => {
    const root = definingFolder();
    const outside = emptyFolder();
    put(outside, OUTSIDE_FILE, RUNNER_CONTENT);
    rmSync(path.join(root, RUNNER));
    symlinkSync(path.join(outside, OUTSIDE_FILE), path.join(root, RUNNER));

    const linked = await digestAt(root, RUNNER);
    put(outside, OUTSIDE_FILE, "something else entirely\n");

    expect(linked).not.toBe(sha256Of(RUNNER_CONTENT));
    expect(await digestAt(root, RUNNER)).toBe(linked);
  });
});

describe("a binding recorded in the copy the proofs ran in", () => {
  it("covers what the repository holds: a file only the copy has is the run's own equipment", async () => {
    const repository = emptyFolder();
    put(repository, DECLARATION, DEFINING_FILES[DECLARATION] ?? "");
    put(repository, VIOLATION_PATCH, DEFINING_FILES[VIOLATION_PATCH] ?? "");

    const recorded = await bindChecks({ repository, copy: definingFolder() });

    expect(recorded.covered.map(file => file.path)).toEqual([
      DECLARATION,
      VIOLATION_PATCH,
    ]);
    expect(
      bindingDifferences(recorded, await bindChecks({ repository }))
    ).toEqual(NO_CHANGE);
  });

  it("takes each file as the copy has it, so a file that differs in the repository does not match later", async () => {
    const repository = definingFolder({ [RUNNER]: "console.log('old');\n" });
    const copy = definingFolder();

    const recorded = await bindChecks({ repository, copy });

    expect(recorded.covered.find(file => file.path === RUNNER)?.sha256).toBe(
      sha256Of(RUNNER_CONTENT)
    );
    expect(
      bindingDifferences(recorded, await bindChecks({ repository }))
    ).toEqual({ ...NO_CHANGE, changed: [RUNNER] });
  });

  it("leaves out a file the repository holds and the copy does not, so it shows as new later", async () => {
    const repository = definingFolder({ ".lisa/hooks/extra": "x\n" });

    const recorded = await bindChecks({ repository, copy: definingFolder() });

    expect(
      bindingDifferences(recorded, await bindChecks({ repository }))
    ).toEqual({ ...NO_CHANGE, added: [".lisa/hooks/extra"] });
  });

  it("reads the repository's own hook files in the repository, whatever the copy holds there", async () => {
    const repository = definingFolder({ [HUSKY_HOOK]: "in the repository\n" });
    const copy = definingFolder({ [HUSKY_HOOK]: "in the copy\n" });

    const recorded = await bindChecks({
      repository,
      copy,
      hostHooks: () => Promise.resolve([HUSKY_HOOK]),
    });

    expect(
      recorded.covered.find(file => file.path === HUSKY_HOOK)?.sha256
    ).toBe(sha256Of("in the repository\n"));
  });

  it("is read again later over the paths it covered, with no hook file looked for", async () => {
    const repository = definingFolder({ [HUSKY_HOOK]: "call\n" });
    const recorded = await bindChecks({
      repository,
      hostHooks: () => Promise.resolve([HUSKY_HOOK]),
    });
    const also = recorded.covered.map(file => file.path);

    expect(await bindChecks({ repository, also })).toEqual(recorded);
    put(repository, HUSKY_HOOK, "call\nexit 0\n");
    expect(
      bindingDifferences(recorded, await bindChecks({ repository, also }))
    ).toEqual({ ...NO_CHANGE, changed: [HUSKY_HOOK] });
    rmSync(path.join(repository, HUSKY_HOOK));
    expect(
      bindingDifferences(recorded, await bindChecks({ repository, also }))
    ).toEqual({ ...NO_CHANGE, gone: [HUSKY_HOOK] });
  });
});
