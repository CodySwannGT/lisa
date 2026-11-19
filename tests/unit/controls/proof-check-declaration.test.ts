/**
 * `lisa controls proof-check`: what is settled by reading a part's
 * declaration and its patch files, before any change is tried
 * (CodySwannGT/lisa#5011).
 *
 * The questions are asked in a fixed order and the first problem is the one
 * reported: are both patch files named, are they there and readable, do they
 * differ, and is failure text declared. A part that names no patch file at
 * all is listed and does not fail the command.
 * @module tests/unit/controls/proof-check-declaration
 */
import { symlinkSync, unlinkSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PROOF_CHECK_EXIT } from "../../../src/controls/commands/proof-check.js";
import { planPart } from "../../../src/controls/proof-check-plan.js";
import { generateControlRegister } from "../../../src/controls/register.js";
import {
  checks,
  F_NONE_SOURCE,
  proofFiles,
  proofPatches,
  PROOFS,
  provedGates,
} from "../../helpers/control-proofs.js";
import {
  checkedPart,
  declared,
  onlyPart,
  proofCheck,
} from "./support/proof-check-run.js";
import { removeScratch } from "./support/proof-copy-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const LINTER = checks(F_NONE_SOURCE);
const NOT_READY = "not-ready";
const VIOLATION_PATCH = `${PROOFS}/lint.violation.patch`;
const CLEAN_PATCH = `${PROOFS}/lint.clean.patch`;
const OUTSIDE_EFFECT = "posts to a chat channel";
const PATCHES = proofPatches("F-none", F_NONE_SOURCE);

afterEach(() => {
  removeScratch();
  removeFixtures();
});

describe("a part that names no patch file", () => {
  it("reads no-proof, is listed, and does not fail the command", async () => {
    const { run, part } = await checkedPart(
      provedGates([{ command: LINTER, without: ["violation", "clean"] }])
    );

    expect(run.code).toBe(PROOF_CHECK_EXIT.READY);
    expect(part).toMatchObject({
      result: "no-proof",
      reason: "no-proof",
      halves: [],
    });
    expect(part.detail).toBe(
      "This check declares no paired proof, so it stays unproved. Write a violating change and a clean change as patch files under .lisa/controls/proofs/ and name them in the part's proof (proof.violation and proof.clean), with the failure text in proof.failure_shape."
    );
    expect(run.result).toMatchObject({
      outcome: "nothing-to-check",
      copy: null,
      reason:
        "None of the 1 declared check has a paired proof, so there was nothing to check and each stays unproved.",
    });
  });
});

describe("a part whose pair cannot be read", () => {
  it.each([
    {
      name: "no clean change",
      part: { command: LINTER, without: ["clean"] as const },
      files: undefined,
      reason: "half-not-declared",
      detail:
        "This check declares a violating change and no clean change. A proof needs both. Write the clean change as a patch file under .lisa/controls/proofs/ and name it in proof.clean.",
    },
    {
      name: "no violating change",
      part: { command: LINTER, without: ["violation"] as const },
      files: undefined,
      reason: "half-not-declared",
      detail:
        "This check declares a clean change and no violating change. A proof needs both. Write the violating change as a patch file under .lisa/controls/proofs/ and name it in proof.violation.",
    },
    {
      name: "a patch file that is not there",
      part: { command: LINTER },
      files: { [CLEAN_PATCH]: PATCHES.clean },
      reason: "patch-missing",
      detail: `The patch file ${VIOLATION_PATCH} (proof.violation) does not exist. Write the violating change to that file, or correct the path in proof.violation.`,
    },
    {
      name: "two patch files holding the same change",
      part: { command: LINTER },
      files: proofFiles({ violation: PATCHES.clean, clean: PATCHES.clean }),
      reason: "patches-identical",
      detail: `The violating change and the clean change are the same change: ${VIOLATION_PATCH} and ${CLEAN_PATCH} hold the same patch. Make one a change that breaks the rule and the other a change the check accepts.`,
    },
    {
      name: "no failure text",
      part: { command: LINTER, failure_shape: null },
      files: undefined,
      reason: "no-failure-text",
      detail:
        "This check declares no failure text (proof.failure_shape), so a real rejection could never be told apart from a broken tool. Add the text the tool prints when it finds the rule broken.",
    },
  ])(
    "reads not-ready for $name, exits 1, and tries nothing",
    async ({ part: declaredAs, files, reason, detail }) => {
      const { run, part } = await checkedPart(provedGates([declaredAs]), files);

      expect(run.code).toBe(PROOF_CHECK_EXIT.NOT_READY);
      expect(part).toMatchObject({
        result: NOT_READY,
        reason,
        detail,
        halves: [],
      });
      expect(run.result?.copy).toBeNull();
    }
  );

  it("does not follow a patch file that is a link", async () => {
    const repo = declared(provedGates([{ command: LINTER }]));
    unlinkSync(path.join(repo, CLEAN_PATCH));
    symlinkSync(path.join(repo, F_NONE_SOURCE), path.join(repo, CLEAN_PATCH));

    const part = onlyPart(await proofCheck(repo));

    expect(part).toMatchObject({
      result: NOT_READY,
      reason: "patch-unreadable",
    });
    expect(part.detail).toBe(
      `The clean change could not be read. ${CLEAN_PATCH} is not an ordinary file (it may be a link), so it was not read. Replace it with the patch file itself.`
    );
  });

  it("reports the missing failure text only once both patch files are there", async () => {
    const { part } = await checkedPart(
      provedGates([{ command: LINTER, failure_shape: null }]),
      { [VIOLATION_PATCH]: PATCHES.violation }
    );

    expect(part.reason).toBe("patch-missing");
  });
});

describe("a proof that says it reaches outside the repository", () => {
  const gates = provedGates([
    { command: LINTER, external_effects: [OUTSIDE_EFFECT] },
  ]);

  it("is not run without the operator's agreement, and says how to give it", async () => {
    const { run, part } = await checkedPart(gates);

    expect(run.code).toBe(PROOF_CHECK_EXIT.NOT_READY);
    expect(part).toMatchObject({
      result: NOT_READY,
      reason: "external-effects",
      halves: [],
    });
    expect(part.detail).toBe(
      `This proof says it does something outside the repository ("${OUTSIDE_EFFECT}"), so it was not run. Run this again with --acknowledge-external-effects once the operator has agreed to that.`
    );
  });

  it("is tried once that is given", async () => {
    const run = await proofCheck(declared(gates), {
      acknowledgeExternalEffects: true,
    });

    expect(run.code).toBe(PROOF_CHECK_EXIT.READY);
    expect(onlyPart(run)).toMatchObject({ result: "ready" });
  });
});

describe("what a ready pair does not say", () => {
  it.each([
    {
      name: "a check that only runs before a merge",
      moments: { "pull-request": "required" },
      note: 'This check runs on pull requests and not at commit or push, so "lisa controls attest" tries this proof only when it is run with --pull-request-canaries.',
    },
    {
      name: "a check that only reports at commit",
      moments: { commit: "optional" },
      note: 'This check is optional at commit: it reports and never refuses, so "lisa controls attest" cannot prove it there. It counts once a failure at commit is required to stop the change.',
    },
    {
      name: "a check that runs at no moment the attest step tries",
      moments: { "post-tool": "required" },
      note: 'This check does not run at commit, at push or on pull requests, so "lisa controls attest" has no moment to try this proof at.',
    },
  ])("is noted for $name", async ({ moments, note }) => {
    const [gate] = Object.values(provedGates([{ command: LINTER }], "x", []));
    const run = await proofCheck(
      declared({ "code-style": { ...(gate as object), ...moments } })
    );
    const part = onlyPart(run);

    expect(part).toMatchObject({ result: "ready", note });
    expect(run.stderr).toContain(`proof-check: code-style@. note. ${note}`);
  });

  it("refuses a part that no command measures, whatever its patches are", async () => {
    const repo = declared(provedGates([{ command: LINTER }]));
    const generated = await generateControlRegister(repo);
    const [entry] =
      generated.problems === null ? generated.register.entries : [];
    if (entry === undefined) throw new Error("the fixture has no entry");

    const plan = await planPart(
      { ...entry, measuring_mechanism: { kind: "built-in" } },
      { root: repo, acknowledgeExternalEffects: false }
    );

    expect(plan).toMatchObject({
      check: false,
      part: {
        result: NOT_READY,
        reason: "not-a-command",
        detail:
          'What measures this check is not a command of its own (it is "built-in"), so there is nothing to run the two changes against. Declare the check as a part with a command.',
      },
    });
  });
});
