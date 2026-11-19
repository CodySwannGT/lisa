/**
 * Validation of a gate's `parts` list, of keys Lisa does not read on a part,
 * and of a part's paired proof.
 *
 * Split from `lisa-gates-parts.test.ts`, which says what `parts` is for. Every
 * refusal here is read by an operator, so each assertion checks that the
 * message names the gate and the key at fault.
 * @module tests/unit/controls/lisa-gates-parts-proof
 */
import { describe, expect, it } from "vitest";

import { PROOF_DIRECTORY } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  API_COMMAND,
  CLEAN,
  PARTS,
  problemsFor,
  problemsForParameter,
  problemsForPart,
  problemsForProof,
  REFUSED_WHEN,
  VIOLATION,
  WEB_COMMAND,
} from "./support/lisa-gates-parts-helpers.js";

describe("the parts list", () => {
  it.each([
    ["an object", { scope: "api", command: API_COMMAND }, /expected a list/u],
    ["a string", "api", /expected a list/u],
    ["null", null, /expected a list/u],
    ["empty", [], /is empty/u],
  ])(REFUSED_WHEN, (_name, parts, expected) => {
    const problems = problemsFor(parts);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(PARTS);
    expect(problems[0]).toMatch(expected);
  });

  it.each([
    ["a string", "api"],
    ["a list", ["api"]],
    ["null", null],
  ])("refuses an entry that is %s", (_name, entry) => {
    const problems = problemsFor([
      { scope: "web", command: WEB_COMMAND },
      entry,
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${PARTS}[1] is ${JSON.stringify(entry)}`);
    expect(problems[0]).toMatch(/expected an object/u);
  });

  it("reports every problem in every part, not only the first", () => {
    const problems = problemsFor([
      { scope: "../api", command: "go vet" },
      { scope: "web" },
    ]);

    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain(`${PARTS}[0].scope`);
    expect(problems[1]).toContain(`${PARTS}[0].command`);
    expect(problems[2]).toContain(`${PARTS}[1].command is missing`);
  });
});

describe("a key Lisa does not read on a part", () => {
  it("is refused, with the nearest key it does read", () => {
    const problems = problemsForPart({ comand: API_COMMAND });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${PARTS}[0].comand`);
    expect(problems[0]).toContain('Did you mean "command"?');
    expect(problems[0]).toContain("scope, command, parameters, proof");
  });

  it("is refused without a suggestion when nothing is close", () => {
    const problems = problemsForPart({ notifications: true });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${PARTS}[0].notifications`);
    expect(problems[0]).not.toContain("Did you mean");
  });

  it("passes through untouched when the project marks it as its own", () => {
    expect(problemsForPart({ "x-team-channel": "#api" })).toEqual([]);
    expect(problemsForProof({ "x-reviewed": true })).toEqual([]);
    expect(problemsForParameter({ value: 80, "x-source": "measured" })).toEqual(
      []
    );
  });

  it("is refused inside a proof and inside a parameter too", () => {
    const proof = problemsForProof({ violaton: VIOLATION });
    const parameter = problemsForParameter({ value: 80, directon: "floor" });

    expect(proof).toHaveLength(1);
    expect(proof[0]).toContain(`${PARTS}[0].proof.violaton`);
    expect(proof[0]).toContain('Did you mean "violation"?');
    expect(parameter).toHaveLength(1);
    expect(parameter[0]).toContain(
      `${PARTS}[0].parameters."coverage".directon`
    );
    expect(parameter[0]).toContain('Did you mean "direction"?');
  });
});

describe("a part's proof", () => {
  it.each([
    ["a string", VIOLATION],
    ["a list", [VIOLATION, CLEAN]],
    ["null", null],
  ])(REFUSED_WHEN, (_name, proof) => {
    const problems = problemsForProof(proof);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${PARTS}[0].proof is`);
    expect(problems[0]).toMatch(/expected an object/u);
  });

  it.each(["violation", "clean"])(
    "refuses a %s file outside the proofs folder",
    half => {
      const problems = problemsForProof({ [half]: "patches/bad.patch" });

      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(
        `${PARTS}[0].proof.${half} is "patches/bad.patch"`
      );
      expect(problems[0]).toContain(`not a file under ${PROOF_DIRECTORY}`);
    }
  );

  it.each([
    [`${PROOF_DIRECTORY}../../../etc/passwd`, /contains "\.\."/u],
    [`/${PROOF_DIRECTORY}a.patch`, /starts at the top of the disk/u],
    [".lisa/controls/proofs", /not a file under/u],
    [".lisa/controls/proofs/", /Write it as/u],
    [".lisa/controls/proofsx/a.patch", /not a file under/u],
    ["", /expected the path of a patch file/u],
    [7, /expected the path of a patch file/u],
  ])("refuses the proof file %j", (file, expected) => {
    const problems = problemsForProof({ violation: file });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${PARTS}[0].proof.violation`);
    expect(problems[0]).toMatch(expected);
    // Every refusal says where a proof file belongs, with an example.
    expect(problems[0]).toContain(
      `for example "${PROOF_DIRECTORY}lint.violation.patch"`
    );
  });

  it("refuses one file standing in for both halves", () => {
    const problems = problemsForProof({ violation: CLEAN, clean: CLEAN });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${PARTS}[0].proof.clean`);
    expect(problems[0]).toContain(`${PARTS}[0].proof.violation`);
    expect(problems[0]).toMatch(/same file/u);
  });

  it.each([
    ["a bare string", "lint failed", /expected a list of literal/u],
    ["an empty list", [], /is empty/u],
    ["a blank entry", ["  "], /is blank/u],
    ["a number", [3], /expected a literal/u],
  ])("refuses a failure shape that is %s", (_name, shape, expected) => {
    const problems = problemsForProof({ failure_shape: shape });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${PARTS}[0].proof.failure_shape`);
    expect(problems[0]).toMatch(expected);
  });

  it.each([0, -5, 1.5, "30", null, Number.NaN])(
    "refuses the time limit %j",
    timeout => {
      const problems = problemsForProof({ timeout_seconds: timeout });

      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(`${PARTS}[0].proof.timeout_seconds`);
      expect(problems[0]).toMatch(/whole number of seconds above zero/u);
    }
  );

  it("accepts a time limit of one second", () => {
    expect(problemsForProof({ timeout_seconds: 1 })).toEqual([]);
  });

  it.each([
    ["a string", "Raises an alert", /expected a list/u],
    ["an object", { alert: true }, /expected a list/u],
  ])("refuses external effects written as %s", (_name, effects, expected) => {
    const problems = problemsForProof({ external_effects: effects });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${PARTS}[0].proof.external_effects`);
    expect(problems[0]).toMatch(expected);
  });

  it("names each external effect that says nothing", () => {
    const problems = problemsForProof({
      external_effects: ["Opens a ticket", "", 4],
    });

    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain(`${PARTS}[0].proof.external_effects[1]`);
    expect(problems[1]).toContain(`${PARTS}[0].proof.external_effects[2]`);
  });
});
