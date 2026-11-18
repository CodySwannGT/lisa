/**
 * The temporary folder `lisa controls attest` makes is removed on every way
 * out (CodySwannGT/lisa#4996).
 *
 * The run finishes, the copy cannot be built, or something throws: in each
 * case the folder is gone afterwards and nothing of the run is left
 * listening in the process. What a signal does is in
 * `./attest-interruption.test.ts`.
 * @module tests/unit/controls/attest-workspace
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TERMINATION_SIGNALS } from "../../../src/controls/commands/attest-interruption.js";
import {
  openAttestWorkspace,
  PROOF_SCRATCH_PREFIX,
  proofScratchFolder,
} from "../../../src/controls/commands/attest-workspace.js";
import {
  ATTEST_EXIT,
  runAttest,
} from "../../../src/controls/commands/attest.js";
import { buildProofCopy } from "../../../src/controls/proof-copy.js";
import { loadProofTools } from "../../../src/controls/proof-tools.js";
import type { ProofRun } from "../../../src/controls/proof-types.js";
import { openDirectProofWorkspace } from "../../../src/controls/proof-workspace.js";
import {
  buildProofFixture,
  checks,
  F_NONE_SOURCE,
  provedGates,
} from "../../helpers/control-proofs.js";
import {
  ATTEST_RESULT_FILES,
  pathStandings,
  repositoryState,
  withUncommittedWork,
} from "../../support/repository-state.js";
import { attest } from "./support/attest-run.js";
import {
  hookEnvironment,
  ownTemporaryFolder,
  removeScratch,
  scratchFolder,
} from "./support/proof-copy-run.js";
import {
  processSignalListeners,
  recordedSignals,
} from "./support/recorded-signals.js";
import { keep, removeFixtures } from "./support/report-check-run.js";

const WORKING = provedGates([{ command: checks(F_NONE_SOURCE) }]);

/**
 * Build F-none with a working check declared and committed.
 * @returns The repository's path
 */
function repository(): string {
  return keep(buildProofFixture(WORKING)).repoPath;
}

beforeEach(() => {
  hookEnvironment();
});

afterEach(() => {
  removeScratch();
  removeFixtures();
});

describe("the disposable copy lisa controls attest opens for itself", () => {
  it("is made in the machine's temporary folder under a name no other run has", () => {
    const tmp = ownTemporaryFolder();

    const [first, second] = [proofScratchFolder(), proofScratchFolder()];

    expect(path.dirname(first)).toBe(tmp);
    expect(path.basename(first).startsWith(PROOF_SCRATCH_PREFIX)).toBe(true);
    expect(first).not.toBe(second);
    expect(readdirSync(tmp)).toEqual([]);
  });

  it("is removed by close(), which can be called again, and leaves nothing listening", async () => {
    const repoPath = repository();
    const folder = scratchFolder();
    const signals = recordedSignals();

    const opening = await openAttestWorkspace(
      { root: repoPath, named: undefined, tools: await loadProofTools() },
      { signals, scratch: () => folder }
    );

    if (opening.problem !== null) throw new Error(opening.problem);
    expect(opening.workspace.root).toBe(path.join(folder, "clone"));
    expect(signals.listeners()).toBe(TERMINATION_SIGNALS.length);
    await opening.close();
    expect(existsSync(folder)).toBe(false);
    expect(signals.listeners()).toBe(0);
    await opening.close();
    expect(existsSync(folder)).toBe(false);
  });

  it("is removed when it cannot be built, and the reason is handed back", async () => {
    const folder = scratchFolder();
    const signals = recordedSignals();

    const opening = await openAttestWorkspace(
      {
        root: path.join(repository(), "src"),
        named: undefined,
        tools: await loadProofTools(),
      },
      {
        signals,
        scratch: () => folder,
        build: async (root, where) => {
          mkdirSync(where);
          return buildProofCopy(root, path.join(where, "inner"));
        },
      }
    );

    expect(opening.problem).toContain("is not the top folder");
    expect(existsSync(folder)).toBe(false);
    expect(signals.listeners()).toBe(0);
  });

  it("is removed when building it throws", async () => {
    const folder = scratchFolder();
    const signals = recordedSignals();

    await expect(
      openAttestWorkspace(
        { root: repository(), named: undefined, tools: await loadProofTools() },
        {
          signals,
          scratch: () => folder,
          build: async (_root, where) => {
            mkdirSync(path.join(where, "clone"), { recursive: true });
            throw new Error("the disk is full");
          },
        }
      )
    ).rejects.toThrow("the disk is full");

    expect(existsSync(folder)).toBe(false);
    expect(signals.listeners()).toBe(0);
  });

  it("is not what a named folder gets: that opener still refuses when no folder is named", async () => {
    const opening = await openDirectProofWorkspace({
      root: repository(),
      named: undefined,
      tools: await loadProofTools(),
    });

    expect(opening.problem).toContain("--workspace <folder>");
  });
});

describe("lisa controls attest with no --workspace", () => {
  it("proves through a real commit in its own copy, changes nothing in the repository but the three files of results, and leaves no folder and no listener", async () => {
    const repoPath = repository();
    withUncommittedWork(repoPath, F_NONE_SOURCE);
    const tmp = ownTemporaryFolder();
    const before = repositoryState(repoPath);
    const listening = processSignalListeners();

    const run = await attest(repoPath, { json: true });

    expect(run.code).toBe(ATTEST_EXIT.PASSED);
    const [entry] = (JSON.parse(run.stdout.join("\n")) as ProofRun).entries;
    expect(entry?.halves[0]?.command?.slice(0, 2)).toEqual(["git", "commit"]);
    // Everything but the three named files is as it was. `before` was taken
    // with nothing left out, so none of the three was there to begin with.
    expect(repositoryState(repoPath, { except: ATTEST_RESULT_FILES })).toEqual(
      before
    );
    expect(pathStandings(repoPath, ATTEST_RESULT_FILES)).toEqual({
      ".lisa/controls/evidence.json": "untracked",
      ".lisa/controls/register.json": "untracked",
      ".lisa/controls/verdict.json": "untracked",
    });
    expect(readdirSync(tmp)).toEqual([]);
    expect(processSignalListeners()).toBe(listening);
  });

  it("says that work which is not committed is not part of the proof", async () => {
    const repoPath = repository();
    withUncommittedWork(repoPath, F_NONE_SOURCE);
    ownTemporaryFolder();

    const run = await attest(repoPath);

    expect(run.code).toBe(ATTEST_EXIT.PASSED);
    expect(run.stderr).toEqual([
      expect.stringMatching(
        /^attest: note\. This repository has changes that are not committed\. The proofs do not use them: they run in a temporary copy of the last commit \([0-9a-f]{7}\), which is removed afterwards\. The proofs change nothing in this repository\. What they find is then written here, to \.lisa\/controls\/evidence\.json, \.lisa\/controls\/register\.json and \.lisa\/controls\/verdict\.json\.$/u
      ),
    ]);
  });

  it("names the files it does take from the working copy", async () => {
    const repoPath = repository();
    appendFileSync(path.join(repoPath, ".lisa.config.json"), "\n");
    ownTemporaryFolder();

    const run = await attest(repoPath);

    expect(run.code).toBe(ATTEST_EXIT.PASSED);
    expect(run.stderr.at(-2)).toBe(
      "attest: note. The copy does take this file as it is in your working copy, because it describes the checks themselves: .lisa.config.json."
    );
    // The results name the last commit, which does not hold that file as it
    // was proved, and the operator is told what that leads to.
    expect(run.stderr.at(-1)).toMatch(
      /^attest: note\. The results are recorded against commit [0-9a-f]{7}, which does not hold that file as it is now\. After you commit it, "lisa controls attest --check" will find that the checks changed since that commit and will not pass\. To have a verdict that stays checkable, commit that file first, then run this again and commit the three files of results\.$/u
    );
  });

  it("says nothing extra when everything is committed", async () => {
    const repoPath = repository();
    ownTemporaryFolder();

    const run = await attest(repoPath);

    expect(run.code).toBe(ATTEST_EXIT.PASSED);
    expect(run.stderr).toEqual([]);
  });

  it("removes its copy and stops listening when the run cannot finish", async () => {
    const repoPath = repository();
    const tmp = ownTemporaryFolder();
    const listening = processSignalListeners();
    const tools = await loadProofTools();
    const stderr: string[] = [];

    const code = await runAttest(
      repoPath,
      {},
      {
        stdout: () => undefined,
        stderr: line => stderr.push(line),
        loadTools: async () => ({
          ...tools,
          judge: () => {
            throw new Error("the judge is broken");
          },
        }),
      }
    );

    expect(code).toBe(ATTEST_EXIT.NOT_RUN);
    expect(stderr.join("\n")).toContain("the judge is broken");
    // No results, so none of the three files of results is written.
    expect(Object.values(pathStandings(repoPath, ATTEST_RESULT_FILES))).toEqual(
      ["missing", "missing", "missing"]
    );
    expect(readdirSync(tmp)).toEqual([]);
    expect(processSignalListeners()).toBe(listening);
  });
});
