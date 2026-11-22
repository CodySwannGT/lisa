/**
 * A proof never changes what the check is.
 *
 * A paired proof shows that a check turns a bad change away. It shows
 * nothing when the "bad change" is one that rewrites the check: a patch that
 * edits the file declaring the checks can swap a command that always passes
 * for one that always fails, and the hook then refuses the commit for a
 * reason that has nothing to do with the rule. So a pair in which either
 * change touches the declaration, a hook script, a file Lisa placed or the
 * gate runner is not run, in `lisa controls attest` as in
 * `lisa controls proof-check`, by one rule.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  changedCheckFile,
  checkFilesOf,
  type CheckFiles,
} from "../../../src/controls/proof-change-rule.js";
import type { ProofEntryResult } from "../../../src/controls/proof-types.js";
import {
  ACCEPTS_EVERYTHING,
  appendLinePatch,
  buildProofFixture,
  F_NONE_SOURCE,
  proofFiles,
  proofPatches,
  provedGates,
  REJECTS_EVERYTHING,
  replaceFilePatch,
} from "../../helpers/control-proofs.js";
import { configFile } from "../../helpers/control-register.js";
import { onlyPart, proofCheck } from "./support/proof-check-run.js";
import {
  copyOf,
  gitIn,
  hookEnvironment,
  proveInCopy,
  removeScratch,
} from "./support/proof-copy-run.js";
import { keep, removeFixtures } from "./support/report-check-run.js";

const DECLARATION = ".lisa.config.json";
const RECORD = ".lisa/controls/carriers.json";
const RUNNER = "scripts/lisa-run-gates.mjs";
const COMMIT_HOOK = ".lisa/hooks/pre-commit";
const CHANGED = "declaration-changed";
const UNKNOWN = "unknown";
const PATCHES = proofPatches("F-none", F_NONE_SOURCE);

/** A check that lets every change through: it enforces nothing. */
const ENFORCES_NOTHING = provedGates([{ command: ACCEPTS_EVERYTHING }]);

/** The same gate with a command that turns every change away. */
const REFUSES_ALL = provedGates([{ command: REJECTS_EVERYTHING }]);

/**
 * A "violating change" that breaks no rule: it rewrites the declaration so
 * that the check's command fails, with the declared failure text.
 */
const SWAPS_THE_COMMAND = replaceFilePatch(
  DECLARATION,
  configFile(ENFORCES_NOTHING),
  configFile(REFUSES_ALL)
);

const RULE: CheckFiles = {
  files: [DECLARATION, RECORD, RUNNER, "scripts/lib/changed-paths.mjs"],
  folders: [".lisa/hooks"],
};

/**
 * Prove the one check of a repository through the hooks of a disposable
 * copy.
 * @param files - The pair of changes
 * @param files.violation - The violating change
 * @param files.clean - The clean change
 * @returns The check's result
 */
async function provedWith(files: {
  readonly violation: string;
  readonly clean: string;
}): Promise<ProofEntryResult> {
  const { repoPath } = keep(
    buildProofFixture(ENFORCES_NOTHING, proofFiles(files))
  );
  const { run } = await proveInCopy(repoPath);
  const [entry] = run.entries;
  if (entry === undefined) throw new Error("the run has no entry");
  return entry;
}

beforeEach(() => {
  hookEnvironment();
});

afterEach(() => {
  removeScratch();
  removeFixtures();
});

describe("the files that say what a check is, or run it", () => {
  it.each([
    ["the declaration", DECLARATION],
    ["the record of the files Lisa placed", RECORD],
    ["the gate runner", RUNNER],
    ["a file the gate runner loads", "scripts/lib/changed-paths.mjs"],
    ["a hook script", COMMIT_HOOK],
    ["a file deeper in the hooks folder", ".lisa/hooks/lib/post-tool.mjs"],
  ])("include %s", (_name, file) => {
    expect(changedCheckFile(["src/app.py", file], RULE)).toBe(file);
  });

  it.each([
    ["a source file", "src/app.py"],
    [
      "a file whose name only starts like the declaration",
      `${DECLARATION}.bak`,
    ],
    [
      "a folder whose name only starts like the hooks folder",
      ".lisa/hooks-old/x",
    ],
    ["another script", "scripts/deploy.mjs"],
    ["a proof's own patch file", ".lisa/controls/proofs/lint.clean.patch"],
  ])("do not include %s", (_name, file) => {
    expect(changedCheckFile([file], RULE)).toBeNull();
  });

  it("are read from the copy: the declaration, the record, what the record lists, the runner's own files and the hooks folder", async () => {
    const { repoPath } = keep(buildProofFixture(ENFORCES_NOTHING));
    const copy = await copyOf(repoPath);
    const recorded = (
      JSON.parse(gitIn(copy.clone, "show", `HEAD:${RECORD}`)) as {
        readonly files: readonly string[];
      }
    ).files;

    expect(copy.checkFiles.folders).toEqual([".lisa/hooks"]);
    expect(copy.checkFiles.files).toEqual(
      expect.arrayContaining([DECLARATION, RECORD, RUNNER, ...recorded])
    );
    expect(recorded).toContain(COMMIT_HOOK);
    expect(await checkFilesOf(copy.clone)).toEqual(copy.checkFiles);
  });
});

describe("a proof whose violating change rewrites the check", () => {
  it("is unknown in attest's copy, never passed, and no check is started", async () => {
    const entry = await provedWith({
      violation: SWAPS_THE_COMMAND,
      clean: PATCHES.clean,
    });

    expect(entry).toMatchObject({
      outcome: UNKNOWN,
      reason: CHANGED,
      moment: "commit",
      failed_halves: [],
      halves: [],
    });
    expect(entry.detail).toBe(
      `No proof was run. The violating change edits ${DECLARATION}, the file that says what each check runs. A proof never changes what the check is. Take that file out of the patch.`
    );
  });

  it("is refused by proof-check for the same reason", async () => {
    const { repoPath } = keep(
      buildProofFixture(
        ENFORCES_NOTHING,
        proofFiles({ violation: SWAPS_THE_COMMAND, clean: PATCHES.clean })
      )
    );

    expect(onlyPart(await proofCheck(repoPath))).toMatchObject({
      result: "not-ready",
      reason: CHANGED,
    });
  });
});

describe("a proof whose change edits a file that runs the checks", () => {
  it("is unknown when the clean change edits a hook script, even though the violating change is an honest one", async () => {
    const { repoPath } = keep(buildProofFixture(ENFORCES_NOTHING));
    const copy = await copyOf(repoPath);
    const hook = readFileSync(path.join(copy.clone, COMMIT_HOOK), "utf8");

    const entry = await provedWith({
      violation: PATCHES.violation,
      clean: appendLinePatch(COMMIT_HOOK, hook, "exit 0"),
    });

    expect(entry).toMatchObject({
      outcome: UNKNOWN,
      reason: CHANGED,
      halves: [],
    });
    expect(entry.detail).toBe(
      `No proof was run. The clean change edits ${COMMIT_HOOK}, one of the files that start the checks at commit and push. A proof never changes what the check is. Take that file out of the patch.`
    );
  });
});
