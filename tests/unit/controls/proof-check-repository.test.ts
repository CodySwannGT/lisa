/**
 * `lisa controls proof-check` and the repository it is pointed at
 * (CodySwannGT/lisa#5011).
 *
 * The command is run by an agent in the middle of setting a repository up:
 * nothing is installed yet, the declaration and the patch files may not be
 * committed, and the operator may have work of their own in progress. So it
 * tries every change in a temporary copy of the last commit, takes the
 * declaration and the patch files from the working copy as they are, and
 * changes nothing in the repository whatever it finds. A token a tool prints
 * is not shown.
 * @module tests/unit/controls/proof-check-repository
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { PROOF_SCRATCH_PREFIX } from "../../../src/controls/commands/attest-workspace.js";
import { PROOF_CHECK_EXIT } from "../../../src/controls/commands/proof-check.js";
import {
  buildFNone,
  buildFPaved,
} from "../../helpers/control-audit-fixtures.js";
import {
  ACCEPTS_EVERYTHING,
  checks,
  F_NONE_SOURCE,
  FAILURE_TEXT,
  proofFiles,
  proofPatches,
  PROOFS,
  provedGates,
  VIOLATION_MARK,
  workspaceCopy,
} from "../../helpers/control-proofs.js";
import { configFile } from "../../helpers/control-register.js";
import { fakeGithubToken } from "../../helpers/fake-credentials.js";
import {
  repositoryState,
  withUncommittedWork,
} from "../../support/repository-state.js";
import { declared, onlyPart, proofCheck } from "./support/proof-check-run.js";
import { ownTemporaryFolder, removeScratch } from "./support/proof-copy-run.js";
import { keep, removeFixtures } from "./support/report-check-run.js";

const LINTER = checks(F_NONE_SOURCE);
const GATES = provedGates([{ command: LINTER }]);
const NOT_READY = "not-ready";
const TOKEN_VARIABLE = "LISA_PROOF_CHECK_TEST_TOKEN";
const cleanups: (() => void)[] = [];

/** Fails with the declared text and, beside it, a token from its environment. */
const ECHOES_A_TOKEN: readonly string[] = [
  process.execPath,
  "-e",
  [
    `const bad = require('node:fs').readFileSync(${JSON.stringify(F_NONE_SOURCE)}, 'utf8').includes('${VIOLATION_MARK}');`,
    `if (bad) { console.log('${FAILURE_TEXT}, GITHUB_TOKEN=' + process.env.${TOKEN_VARIABLE}); process.exit(1); }`,
  ].join(" "),
];

/**
 * The run folders left in a temporary folder.
 * @param tmp - The temporary folder
 * @returns Their names
 */
function runFolders(tmp: string): readonly string[] {
  return readdirSync(tmp).filter(name => name.startsWith(PROOF_SCRATCH_PREFIX));
}

afterEach(() => {
  removeScratch();
  removeFixtures();
  cleanups.splice(0).forEach(cleanup => {
    cleanup();
  });
});

describe("a repository with work in progress", () => {
  it.each([
    {
      name: "a pair that is ready",
      gates: GATES,
      code: PROOF_CHECK_EXIT.READY,
    },
    {
      name: "a pair that is not",
      gates: provedGates([{ command: ACCEPTS_EVERYTHING }]),
      code: PROOF_CHECK_EXIT.NOT_READY,
    },
  ])(
    "is identical after checking $name: working tree, index, branches and stash",
    async ({ gates, code }) => {
      const repo = declared(gates);
      withUncommittedWork(repo, F_NONE_SOURCE);
      const tmp = ownTemporaryFolder();
      const before = repositoryState(repo);

      const run = await proofCheck(repo);

      expect(run.code).toBe(code);
      expect(repositoryState(repo)).toEqual(before);
      expect(runFolders(tmp)).toEqual([]);
    }
  );

  it("tries the changes on the last commit, not on the uncommitted work, and says so", async () => {
    const repo = declared(GATES);
    withUncommittedWork(repo, F_NONE_SOURCE);

    const run = await proofCheck(repo);

    expect(onlyPart(run).result).toBe("ready");
    expect(run.result?.copy).toMatchObject({ uncommitted_work: true });
    expect(run.stderr[0]).toMatch(
      /^proof-check: note\. This repository has changes that are not committed\. This run does not use them: it works in a temporary copy of the last commit \([0-9a-f]+\), which is removed afterwards\. Nothing is written in this repository\.$/u
    );
  });

  it("checks a declaration and patch files that are not committed yet", async () => {
    const { repoPath } = keep(buildFNone());
    const files = {
      ".lisa.config.json": configFile(GATES),
      ...proofFiles(proofPatches("F-none", F_NONE_SOURCE)),
    };
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(repoPath, file)), { recursive: true });
      writeFileSync(path.join(repoPath, file), content);
    }
    const before = repositoryState(repoPath);

    const run = await proofCheck(repoPath);

    expect(run.code).toBe(PROOF_CHECK_EXIT.READY);
    expect(onlyPart(run).result).toBe("ready");
    expect(run.result?.copy?.carried).toEqual([
      ".lisa.config.json",
      `${PROOFS}/lint.clean.patch`,
      `${PROOFS}/lint.violation.patch`,
    ]);
    expect(repositoryState(repoPath)).toEqual(before);
  });
});

describe("what a tool prints", () => {
  it("is shown without the value of a token the tool echoed", async () => {
    const token = fakeGithubToken();
    vi.stubEnv(TOKEN_VARIABLE, token);

    const run = await proofCheck(
      declared(provedGates([{ command: ECHOES_A_TOKEN }]))
    );
    const printed = [...run.stdout, ...run.stderr].join("\n");
    const violation = onlyPart(run).halves[0]?.run;

    expect(violation?.outcome).toBe("rejected");
    expect(violation?.output_excerpt).toContain(FAILURE_TEXT);
    expect(violation?.output_excerpt).toContain("[REDACTED:");
    expect(violation?.matched_lines.join("\n")).toContain("[REDACTED:");
    expect(printed).not.toContain(token);
  });
});

describe("a repository with nothing to check", () => {
  it("says so plainly and exits 0 when its checks come with the project type and none is a part", async () => {
    const { repoPath } = keep(buildFPaved());
    writeFileSync(
      path.join(repoPath, ".lisa.config.json"),
      configFile({ "code-style": { commit: "required" } })
    );

    const run = await proofCheck(repoPath);

    expect(run.code).toBe(PROOF_CHECK_EXIT.READY);
    expect(run.result).toMatchObject({
      outcome: "nothing-to-check",
      copy: null,
      parts: [],
      counts: { ready: 0, [NOT_READY]: 0, "no-proof": 0 },
    });
    expect(run.stderr).toEqual([
      "proof-check: NOTHING TO CHECK. No paired proof is declared in .lisa.config.json. The project type supplies 1 check that still needs a paired proof.",
    ]);
  });

  it("says so plainly and exits 0 when nothing is declared at all", async () => {
    const run = await proofCheck(keep(buildFNone()).repoPath);

    expect(run.code).toBe(PROOF_CHECK_EXIT.READY);
    expect(run.result).toMatchObject({
      outcome: "nothing-to-check",
      parts: [],
    });
    expect(run.stderr).toEqual([
      "proof-check: NOTHING TO CHECK. No check is declared in .lisa.config.json, so there is no paired proof to check.",
    ]);
  });
});

describe("a repository that cannot be checked", () => {
  it("exits 2 and prints no document when the path is not a folder", async () => {
    const run = await proofCheck(path.join(declared(GATES), "no-such-folder"));

    expect(run.code).toBe(PROOF_CHECK_EXIT.NOT_CHECKED);
    expect(run.stdout).toEqual([]);
    expect(run.stderr.at(-1)).toBe(
      "proof-check: FAIL. Give the path of the repository to look at"
    );
  });

  it("exits 2 and prints the refusal when the declaration is refused", async () => {
    const run = await proofCheck(
      declared({
        "code-style": {
          commit: "required",
          parts: [{ scope: ".", command: [...LINTER] }],
        },
      })
    );

    expect(run.code).toBe(PROOF_CHECK_EXIT.NOT_CHECKED);
    expect(run.stdout).toEqual([]);
    expect(run.stderr.length).toBeGreaterThan(1);
    expect(run.stderr.at(-1)).toBe(
      "proof-check: FAIL. The gates declaration in .lisa.config.json was refused, so nothing was checked. Fix the declaration, then run this again"
    );
  });

  it("exits 2 when there is no commit to put a change on", async () => {
    const copy = workspaceCopy(declared(GATES), false);
    cleanups.push(copy.cleanup);

    const run = await proofCheck(copy.directory);

    expect(run.code).toBe(PROOF_CHECK_EXIT.NOT_CHECKED);
    expect(run.stdout).toEqual([]);
    expect(run.stderr.at(-1)).toBe(
      "proof-check: FAIL. No temporary copy of the repository to try the changes in, so nothing was checked"
    );
  });
});
