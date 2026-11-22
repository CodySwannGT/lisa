/**
 * Proofs that go through a real commit and a real push
 * (CodySwannGT/lisa#4996).
 *
 * In the disposable copy a proof is not the check's command started on its
 * own: the planted change is staged and committed, or committed and pushed,
 * so what answers is git's hook, the carrier, the gate runner and then the
 * check. These cases run that whole chain against fixture repositories.
 * @module tests/unit/controls/proof-copy-workspace
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProofCopy } from "../../../src/controls/proof-copy.js";
import {
  ACCEPTS_EVERYTHING,
  buildProofFixture,
  checks,
  F_NONE_SOURCE,
  FAILURE_TEXT,
  NEVER_FINISHES,
  proofFiles,
  proofPatches,
  provedGates,
  REJECTS_EVERYTHING,
} from "../../helpers/control-proofs.js";
import type { GatesBlock } from "../../helpers/control-register.js";
import {
  gitIn,
  hookEnvironment,
  proveInCopy,
  removeScratch,
  type CopyRun,
} from "./support/proof-copy-run.js";
import { keep, removeFixtures } from "./support/report-check-run.js";

/** The register entry of the check declared at commit. */
const STYLE_ENTRY = "code-style@.";

const PATCHES = proofPatches("F-none", F_NONE_SOURCE);
const AT_COMMIT = provedGates([{ command: checks(F_NONE_SOURCE) }]);
const AT_PUSH = provedGates(
  [{ command: checks(F_NONE_SOURCE), name: "tests" }],
  "test-correctness",
  ["push"]
);
const FILES = { ...proofFiles(PATCHES), ...proofFiles(PATCHES, "tests") };

/**
 * Prove every control of F-none, declared a given way, through the hooks of
 * a disposable copy.
 * @param gates - The gates block
 * @param prepare - Changes the repository before it is copied
 * @returns The results and the copy
 */
async function proved(
  gates: GatesBlock,
  prepare: (repoPath: string) => void = () => undefined
): Promise<CopyRun> {
  const { repoPath } = keep(buildProofFixture(gates, FILES));
  prepare(repoPath);
  return proveInCopy(repoPath);
}

/**
 * Expect a copy to be exactly as it was before any proof ran.
 * @param copy - The copy
 */
function expectReset(copy: ProofCopy): void {
  expect(gitIn(copy.clone, "rev-parse", "HEAD")).toBe(copy.base);
  expect(
    gitIn(copy.clone, "status", "--porcelain", "--ignored", "--untracked-files")
  ).toBe("");
  expect(gitIn(copy.remote, "rev-parse", `refs/heads/${copy.pushBranch}`)).toBe(
    copy.base
  );
  expect(
    gitIn(copy.clone, "rev-parse", `refs/remotes/origin/${copy.pushBranch}`)
  ).toBe(copy.base);
}

beforeEach(() => {
  hookEnvironment();
});

afterEach(() => {
  removeScratch();
  removeFixtures();
});

describe("a proof through the commit hook", () => {
  it("passes when the hook refuses the violating commit for the declared reason and lets the clean one through", async () => {
    const { run, copy } = await proved(AT_COMMIT);

    const [entry] = run.entries;
    expect(run.passed).toBe(true);
    expect(entry).toMatchObject({
      entry_id: STYLE_ENTRY,
      moment: "commit",
      outcome: "passed",
      reason: "proved",
    });
    const [violation, clean] = entry?.halves ?? [];
    const command = [
      "git",
      "commit",
      "--quiet",
      "-m",
      "chore: control proof for code-style@.",
    ];
    expect(violation).toMatchObject({
      command,
      exit_status: 1,
      outcome: "rejected",
      reason: "rejected-as-declared",
    });
    expect(clean).toMatchObject({
      command,
      exit_status: 0,
      outcome: "accepted",
    });
    // What was judged is the hook's own output: the gate runner's report
    // line for this check, with the check's failure text above it.
    expect(violation?.output_excerpt).toMatch(
      /^ {2}FAILED +required +code-style in \. /mu
    );
    expect(violation?.matched_lines.join("\n")).toContain(FAILURE_TEXT);
    expect(clean?.output_excerpt).toMatch(
      /^ {2}PASSED +required +code-style in \. /mu
    );
    expectReset(copy);
  });

  it("fails a control whose check lets the violating commit through, and takes the commit back out", async () => {
    const { run, copy } = await proved(
      provedGates([{ command: ACCEPTS_EVERYTHING }])
    );

    expect(run.entries[0]).toMatchObject({
      outcome: "failed",
      failed_halves: ["violation"],
      reason: "violation-accepted",
    });
    expectReset(copy);
  });

  it("gives no answer for a check stopped at its time limit, and is still fit for the next proof", async () => {
    const { run, copy } = await proved({
      ...provedGates([{ command: NEVER_FINISHES, timeout_seconds: 1 }]),
      ...AT_PUSH,
    });

    expect(
      run.entries.map(entry => [entry.entry_id, entry.outcome, entry.reason])
    ).toEqual([
      [STYLE_ENTRY, "unknown", "timed-out"],
      ["test-correctness@.", "passed", "proved"],
    ]);
    expectReset(copy);
  });

  it("works from a repository that is on no branch", async () => {
    const { run, copy } = await proved(AT_COMMIT, repoPath => {
      gitIn(repoPath, "checkout", "--quiet", "--detach");
    });

    expect(run.passed).toBe(true);
    expectReset(copy);
  });
});

describe("a proof through the push hook", () => {
  it("passes when the push of the violating change is refused and the clean change arrives in the stand-in remote", async () => {
    const { run, copy } = await proved(AT_PUSH);

    const [entry] = run.entries;
    expect(run.passed).toBe(true);
    expect(entry).toMatchObject({
      entry_id: "test-correctness@.",
      moment: "push",
      outcome: "passed",
    });
    const [violation, clean] = entry?.halves ?? [];
    const command = [
      "git",
      "push",
      "--quiet",
      "origin",
      "HEAD:refs/heads/main",
    ];
    expect(violation).toMatchObject({ command, exit_status: 1 });
    expect(clean).toMatchObject({ command, exit_status: 0 });
    expect(violation?.output_excerpt).toMatch(
      /^ {2}FAILED +required +test-correctness in \. /mu
    );
    expectReset(copy);
  });

  it("never keeps the path of the run's temporary folder in what it reports", async () => {
    const { run, copy } = await proved({ ...AT_COMMIT, ...AT_PUSH });

    const kept = JSON.stringify(run);
    expect(run.passed).toBe(true);
    expect(kept).not.toContain(copy.folder);
    expect(kept).toContain("failed to push some refs to '<proof-remote>'");
  });

  it("fails a control whose check turns the clean push away", async () => {
    const { run, copy } = await proved(
      provedGates(
        [{ command: REJECTS_EVERYTHING, name: "tests" }],
        "test-correctness",
        ["push"]
      )
    );

    expect(run.entries[0]).toMatchObject({
      outcome: "failed",
      failed_halves: ["clean"],
      reason: "clean-rejected",
    });
    expectReset(copy);
  });

  it("proves an entry at its first local moment only, and gives the same results on a second run", async () => {
    const both = provedGates(
      [{ command: checks(F_NONE_SOURCE) }],
      "code-style",
      ["commit", "push"]
    );
    const { repoPath } = keep(buildProofFixture(both, FILES));

    const first = await proveInCopy(repoPath);
    const second = await proveInCopy(repoPath);

    const summary = (results: CopyRun): unknown =>
      results.run.entries.map(entry => [
        entry.entry_id,
        entry.moment,
        entry.outcome,
        entry.halves.map(half => [half.half, half.outcome, half.exit_status]),
      ]);
    expect(summary(first)).toEqual([
      [
        STYLE_ENTRY,
        "commit",
        "passed",
        [
          ["violation", "rejected", 1],
          ["clean", "accepted", 0],
        ],
      ],
    ]);
    expect(summary(second)).toEqual(summary(first));
  });
});
