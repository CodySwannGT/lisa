/**
 * The paired proof where something stands in its way (CodySwannGT/lisa#4995).
 *
 * A proof that cannot be run, or whose answer cannot be trusted, must say so
 * in a way that is never mistaken for a pass: an entry enforced only on pull
 * requests, a proof that reaches outside the repository, a change that will
 * not go in, a check that is not installed, a check that changes the files it
 * reads. None of them may stop the entries after it from being reported.
 * @module tests/unit/controls/proof-runner-edges
 */
import { appendFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { OUTPUT_EXCERPT_LIMIT } from "../../../src/controls/proof-half-run.js";
import {
  ACCEPTS_EVERYTHING,
  API_SOURCE,
  checks,
  F_NONE_SOURCE,
  FAILURE_TEXT,
  PROOFS,
  proofFiles,
  proofPatches,
  provedGates,
  WEB_SOURCE,
} from "../../helpers/control-proofs.js";
import {
  only,
  prove,
  proved,
  removeCopies,
  setting,
} from "./support/proof-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const NODE = process.execPath;
const WORKING = checks(F_NONE_SOURCE);
const GATE = "code-style";

/** A program name nothing on this machine answers to. */
const NOT_INSTALLED = "lisa-no-such-check-4995";

/** Why a half is not run once an earlier change could not be undone. */
const NOT_RESTORED = "workspace-not-restored";

/** A check that changes the file it reads, then fails as declared. */
const CHANGES_WHAT_IT_READS = [
  NODE,
  "-e",
  `require('node:fs').appendFileSync(${JSON.stringify(F_NONE_SOURCE)}, 'left behind\\n'); console.log('${FAILURE_TEXT}'); process.exit(1);`,
];

afterEach(() => {
  removeCopies();
  removeFixtures();
});

describe("an entry this runner does not exercise", () => {
  it("is unproved, never passing, when it is enforced only on pull requests", async () => {
    const run = await proved(
      provedGates([{ command: ACCEPTS_EVERYTHING }], GATE, ["pull-request"])
    );

    expect(only(run)).toMatchObject({
      outcome: "unproved",
      reason: "pull-request-moment",
      moment: null,
      halves: [],
    });
    expect(only(run).detail).toContain("hosting platform");
    expect(run.passed).toBe(false);
  });

  it("is unproved when it is enforced at neither commit nor push", async () => {
    const entry = only(
      await proved(
        provedGates([{ command: WORKING }], GATE, ["pre-deploy:production"])
      )
    );

    expect(entry).toMatchObject({
      outcome: "unproved",
      reason: "no-proof-moment",
    });
    expect(entry.detail).toContain("pre-deploy:production");
  });

  it("stands for the push moment when the entry is enforced there and not at commit", async () => {
    const entry = only(
      await proved(
        provedGates([{ command: WORKING }], GATE, ["push", "pull-request"])
      )
    );

    expect(entry).toMatchObject({ outcome: "passed", moment: "push" });
  });
});

describe("a proof that says it reaches outside the repository", () => {
  const gates = provedGates([
    {
      command: WORKING,
      external_effects: ["Opens a ticket in the tracker."],
    },
  ]);

  it("is unknown and quotes what it says it does, without running anything", async () => {
    const entry = only(await proved(gates));

    expect(entry).toMatchObject({
      outcome: "unknown",
      reason: "external-effects",
      halves: [],
    });
    expect(entry.detail).toContain("Opens a ticket in the tracker.");
  });

  it("is run once that has been agreed to", async () => {
    const run = await prove(setting(gates), {
      acknowledgeExternalEffects: true,
    });

    expect(only(run).outcome).toBe("passed");
  });
});

describe("a proof whose answer cannot be trusted", () => {
  it("is unknown when a change will not go in, and says why", async () => {
    const where = setting(provedGates([{ command: WORKING }]));
    appendFileSync(path.join(where.workspace, F_NONE_SOURCE), "drifted\n");

    const entry = only(await prove(where));

    expect(entry).toMatchObject({
      outcome: "unknown",
      reason: "patch-not-applied",
    });
    expect(entry.halves[0]).toMatchObject({
      command: null,
      exit_status: null,
      outcome: "unknown",
      reason: "patch-not-applied",
    });
    expect(entry.halves[0]?.detail).toContain("patch does not apply");
    expect(entry.halves).toHaveLength(2);
  });

  it("is unknown when a patch file is a link, which is not followed", async () => {
    const where = setting(provedGates([{ command: WORKING }]));
    const file = path.join(where.repoPath, PROOFS, "lint.clean.patch");
    rmSync(file);
    symlinkSync(path.join(where.repoPath, F_NONE_SOURCE), file);

    expect(only(await prove(where))).toMatchObject({
      outcome: "unknown",
      reason: "patch-unreadable",
      halves: [],
    });
  });

  it("is unproved, not unknown, when one patch file is a link and the other is gone", async () => {
    const where = setting(provedGates([{ command: WORKING }]));
    const clean = path.join(where.repoPath, PROOFS, "lint.clean.patch");
    rmSync(clean);
    symlinkSync(path.join(where.repoPath, F_NONE_SOURCE), clean);
    rmSync(path.join(where.repoPath, PROOFS, "lint.violation.patch"));

    expect(only(await prove(where))).toMatchObject({
      outcome: "unproved",
      reason: "half-missing",
      halves: [],
    });
  });

  it("is unknown when the check is not installed", async () => {
    const entry = only(
      await proved(provedGates([{ command: [NOT_INSTALLED] }]))
    );

    expect(entry).toMatchObject({ outcome: "unknown", reason: "not-started" });
    expect(entry.halves[0]).toMatchObject({
      command: [NOT_INSTALLED],
      exit_status: null,
    });
    expect(entry.detail).toContain(NOT_INSTALLED);
  });

  it("is unknown for exit 0 from a check that says it ran nothing", async () => {
    const entry = only(
      await proved(
        provedGates([
          {
            command: [
              NODE,
              "-e",
              "console.log('No test files found, exiting with code 0')",
            ],
          },
        ])
      )
    );

    expect(entry).toMatchObject({
      outcome: "unknown",
      reason: "nothing-measured",
    });
  });

  it("is unknown when a rejection has no declared failure text to match", async () => {
    const entry = only(
      await proved(provedGates([{ command: WORKING, failure_shape: null }]))
    );

    expect(entry).toMatchObject({
      outcome: "unknown",
      reason: "no-failure-shape",
    });
    expect(entry.halves.map(half => half.outcome)).toEqual([
      "unknown",
      "accepted",
    ]);
  });

  it("still fails with no declared failure text when the violating change is accepted", async () => {
    const entry = only(
      await proved(
        provedGates([{ command: ACCEPTS_EVERYTHING, failure_shape: null }])
      )
    );

    expect(entry).toMatchObject({
      outcome: "failed",
      failed_halves: ["violation"],
    });
  });
});

describe("a check that changes the files it reads", () => {
  it("has its own answer kept, and every half after it reported unknown without being run", async () => {
    const run = await proved({
      ...provedGates([{ command: CHANGES_WHAT_IT_READS }], GATE),
      ...provedGates([{ command: WORKING }], "type-correctness", ["push"]),
    });
    const [first, second] = run.entries;

    expect(first?.halves.map(half => [half.outcome, half.reason])).toEqual([
      ["rejected", "rejected-as-declared"],
      ["unknown", NOT_RESTORED],
    ]);
    expect(first).toMatchObject({
      outcome: "unknown",
      reason: NOT_RESTORED,
    });
    expect(second).toMatchObject({
      entry_id: "type-correctness@.",
      outcome: "unknown",
      reason: NOT_RESTORED,
    });
    expect(second?.halves.map(half => half.command)).toEqual([null, null]);
    expect(second?.detail).toContain("code-style@.");
  });
});

describe("a repository with more than one part", () => {
  const files = {
    ...proofFiles(proofPatches("F-mixed", API_SOURCE), "api"),
    ...proofFiles(proofPatches("F-mixed", WEB_SOURCE), "web"),
  };
  const gates = provedGates([
    { scope: "web", command: checks("src/index.ts"), name: "web" },
    { scope: "api", command: checks("src/api/greeting.py"), name: "api" },
  ]);

  it("proves each part with its own command in its own folder, in register order", async () => {
    const run = await proved(gates, { files, fixture: "F-mixed" });

    expect(
      run.entries.map(entry => [entry.entry_id, entry.scope, entry.outcome])
    ).toEqual([
      ["code-style@api", "api", "passed"],
      ["code-style@web", "web", "passed"],
    ]);
    expect(run.entries[0]?.halves[0]?.output_excerpt).toContain(
      "src/api/greeting.py:1: planted violation"
    );
    expect(run.counts.passed).toBe(2);
  });
});

describe("what is kept of a check's output", () => {
  it("is the end of it, with the folder it ran in taken out", async () => {
    const where = setting(
      provedGates([
        {
          command: [
            NODE,
            "-e",
            `console.log('x'.repeat(${String(OUTPUT_EXCERPT_LIMIT * 2)})); console.log('ran in ' + process.cwd()); console.log('${FAILURE_TEXT}'); process.exit(1);`,
          ],
        },
      ])
    );

    const [violation] = only(await prove(where)).halves;

    expect(violation?.output_truncated).toBe(true);
    expect(violation?.output_excerpt.length).toBeLessThanOrEqual(
      OUTPUT_EXCERPT_LIMIT
    );
    expect(violation?.output_excerpt).toBe(
      `ran in <workspace>\n${FAILURE_TEXT}\n`
    );
    expect(JSON.stringify(violation)).not.toContain(where.workspace);
    expect(
      readFileSync(path.join(where.workspace, F_NONE_SOURCE), "utf8")
    ).not.toContain("PLANTED");
  });
});
