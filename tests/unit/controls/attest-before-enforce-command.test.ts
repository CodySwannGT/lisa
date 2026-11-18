/**
 * `lisa controls attest --before-enforce` as a command: what it prints, what
 * it refuses, how it exits, and that it leaves nothing behind
 * (CodySwannGT/lisa#5001).
 *
 * The promise under test is that this run is a diagnosis and nothing more.
 * It writes no evidence, no register and no verdict, so nothing it finds can
 * be read as a Level 1 result, and the repository it was pointed at is
 * exactly as it was afterwards.
 * @module tests/unit/controls/attest-before-enforce-command
 */
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BEFORE_ENFORCE_EXIT } from "../../../src/controls/commands/attest-before-enforce.js";
import { PROOF_SCRATCH_PREFIX } from "../../../src/controls/commands/attest-workspace.js";
import { runAttest } from "../../../src/controls/commands/attest.js";
import {
  BEFORE_ENFORCE_MODE,
  BEFORE_ENFORCE_RESULTS,
  type BeforeEnforceRun,
} from "../../../src/controls/before-enforce-types.js";
import {
  checks,
  F_NONE_SOURCE,
  provedGates,
} from "../../helpers/control-proofs.js";
import { buildFNone } from "../../helpers/control-audit-fixtures.js";
import {
  ATTEST_RESULT_FILES,
  pathStandings,
  repositoryState,
  withUncommittedWork,
} from "../../support/repository-state.js";
import { beforeEnforce, declared } from "./support/before-enforce-run.js";
import { ownTemporaryFolder, removeScratch } from "./support/proof-copy-run.js";
import { steppingClock } from "./support/proof-run.js";
import { keep, removeFixtures } from "./support/report-check-run.js";

const LINTER_AT_COMMIT = provedGates([{ command: checks(F_NONE_SOURCE) }]);
const NAME = "attest --before-enforce";

afterEach(() => {
  removeScratch();
  removeFixtures();
});

describe("what a before-enforce run leaves behind", () => {
  it("writes no evidence, register or verdict, changes nothing in the repository, and removes its clone", async () => {
    const repoPath = declared(LINTER_AT_COMMIT);
    const tmp = ownTemporaryFolder();
    const before = repositoryState(repoPath);

    const run = await beforeEnforce(repoPath);

    expect(run.result).toMatchObject({ outcome: "findings", wrote: [] });
    expect(repositoryState(repoPath)).toEqual(before);
    expect(Object.values(pathStandings(repoPath, ATTEST_RESULT_FILES))).toEqual(
      ATTEST_RESULT_FILES.map(() => "missing")
    );
    expect(
      readdirSync(tmp).filter(name => name.startsWith(PROOF_SCRATCH_PREFIX))
    ).toEqual([]);
  });

  it("leaves uncommitted work and the stash alone, and says the run does not use them", async () => {
    const repoPath = declared(LINTER_AT_COMMIT);
    withUncommittedWork(repoPath, F_NONE_SOURCE);
    const before = repositoryState(repoPath);

    const run = await beforeEnforce(repoPath);

    expect(run.code).toBe(BEFORE_ENFORCE_EXIT.ANSWERED);
    expect(repositoryState(repoPath)).toEqual(before);
    expect(run.result?.copy).toMatchObject({ uncommitted_work: true });
    expect(run.stderr.join("\n")).toContain(
      "attest: note. This repository has changes that are not committed. This run does not use them"
    );
    expect(run.stderr.join("\n")).toContain(
      "Nothing is written in this repository."
    );
  });
});

describe("what a before-enforce run prints", () => {
  it("prints exactly one JSON document that calls itself before-enforce and reports the clone as measured", async () => {
    const run = await beforeEnforce(declared(LINTER_AT_COMMIT));

    expect(run.stdout).toHaveLength(1);
    expect(run.result).toMatchObject({
      schema_version: 1,
      mode: BEFORE_ENFORCE_MODE,
      copy: {
        branch: "main",
        carriers_installed: false,
        hooks_path: null,
        hooks: [],
        uncommitted_work: false,
      },
    });
    expect(Object.keys(run.result?.counts ?? {})).toEqual([
      ...BEFORE_ENFORCE_RESULTS,
    ]);
    expect(run.stderr.at(-1)).toMatch(
      /^attest --before-enforce: FINDINGS\. 1 of 1 entry exists and is not enforced/u
    );
  });

  it("uses none of a proof run's words for an entry's result", async () => {
    const run = await beforeEnforce(declared(LINTER_AT_COMMIT));
    const document = run.result as BeforeEnforceRun &
      Readonly<Record<string, unknown>>;

    expect(document.passed).toBeUndefined();
    expect(document.entries.map(entry => Object.keys(entry))).toEqual([
      expect.not.arrayContaining(["outcome", "halves", "failed_halves"]),
    ]);
  });

  it("prints a table that says what a fresh clone has and that nothing was written", async () => {
    const run = await beforeEnforce(declared(LINTER_AT_COMMIT), {
      json: false,
    });
    const printed = run.stdout.join("\n");

    expect(run.stdout[0]).toMatch(/^RESULT\s+ENTRY\s+MOMENT\s+CHANGE\s+TOOL$/u);
    expect(run.stdout[1]).toMatch(
      /^not-enforced\s+code-style@\.\s+commit\s+accepted \(exit 0\)\s+rejected \(exit 1\)$/u
    );
    expect(printed).toContain(
      `${NAME}: note. The changes were tried in a fresh clone of the last commit`
    );
    expect(printed).toContain(
      "It has no hook: git copies commits into a clone, and never the hook settings or hook files of the checkout it was cloned from."
    );
    expect(printed).toContain(`${NAME}: wrote nothing.`);
    expect(printed).toContain('under "entries[].canary"');
    expect(run.stdout.at(-1)).toMatch(/^attest --before-enforce: FINDINGS\. /u);
  });

  it("says there is nothing to try when nothing is declared, and makes no clone", async () => {
    const { repoPath } = keep(buildFNone());
    const tmp = ownTemporaryFolder();

    const run = await beforeEnforce(repoPath);

    expect(run.code).toBe(BEFORE_ENFORCE_EXIT.ANSWERED);
    expect(run.result).toMatchObject({
      outcome: "nothing-declared",
      entries: [],
      copy: null,
    });
    expect(run.result?.reason).toContain("Declare the checks first");
    expect(readdirSync(tmp)).toEqual([]);
  });
});

describe("when a before-enforce run gives no result", () => {
  it.each([
    ["--check", { check: true }],
    ["--workspace", { workspace: "/somewhere/else" }],
    ["--pull-request-canaries", { pullRequestCanaries: true }],
  ])("refuses to be combined with %s", async (flag, options) => {
    const repoPath = declared(LINTER_AT_COMMIT);
    const before = repositoryState(repoPath);

    const run = await beforeEnforce(repoPath, options);

    expect(run.code).toBe(BEFORE_ENFORCE_EXIT.NOT_RUN);
    expect(run.stdout).toEqual([]);
    expect(run.stderr[0]).toContain(`cannot be combined with ${flag}`);
    expect(run.stderr.at(-1)).toBe(
      `${NAME}: FAIL. Nothing was tried. Run it on its own`
    );
    expect(repositoryState(repoPath)).toEqual(before);
  });

  it("exits 2 for a path that is not a folder", async () => {
    const run = await beforeEnforce(
      path.join(keep(buildFNone()).repoPath, "no-such-folder")
    );

    expect(run.code).toBe(BEFORE_ENFORCE_EXIT.NOT_RUN);
    expect(run.stdout).toEqual([]);
    expect(run.stderr[0]).toContain("is not a folder.");
  });

  it("exits 2 and tries nothing when the gates declaration is refused", async () => {
    const { repoPath } = keep(buildFNone());
    writeFileSync(
      path.join(repoPath, ".lisa.config.json"),
      JSON.stringify({ gates: { "code-style": { commit: "sometimes" } } })
    );

    const run = await beforeEnforce(repoPath);

    expect(run.code).toBe(BEFORE_ENFORCE_EXIT.NOT_RUN);
    expect(run.stdout).toEqual([]);
    expect(run.stderr.at(-1)).toContain("was refused, so nothing was tried");
  });
});

describe("lisa controls attest with the before-enforce option", () => {
  it("runs the diagnosis in place of the proofs, and writes none of the three result files", async () => {
    const repoPath = declared(LINTER_AT_COMMIT);
    const stdout: string[] = [];

    const code = await runAttest(
      repoPath,
      { beforeEnforce: true, json: true },
      {
        clock: steppingClock(),
        stdout: line => {
          stdout.push(line);
        },
        stderr: () => undefined,
      }
    );

    expect(code).toBe(BEFORE_ENFORCE_EXIT.ANSWERED);
    expect(JSON.parse(stdout[0] ?? "null")).toMatchObject({
      mode: BEFORE_ENFORCE_MODE,
      outcome: "findings",
    });
    expect(
      ATTEST_RESULT_FILES.filter(file => existsSync(path.join(repoPath, file)))
    ).toEqual([]);
  });
});
