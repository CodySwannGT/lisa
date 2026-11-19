/**
 * Validation of a part's named parameters, and of a gate that has parts and
 * also names another prover.
 *
 * Split from `lisa-gates-parts.test.ts`, which says what `parts` is for. Every
 * refusal here is read by an operator, so each assertion checks that the
 * message names the gate and the key at fault.
 * @module tests/unit/controls/lisa-gates-parts-parameters
 */
import { describe, expect, it } from "vitest";

import {
  PARAMETER_DIRECTIONS,
  validateGates,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  API_COMMAND,
  GATE,
  PARTS,
  problemsFor,
  problemsForParameter,
  problemsForPart,
} from "./support/lisa-gates-parts-helpers.js";

describe("a part's parameters", () => {
  const COVERAGE = `${PARTS}[0].parameters."coverage"`;

  it.each([
    ["a list", [{ value: 80 }]],
    ["a string", "coverage=80"],
    ["null", null],
  ])("are refused when they are %s", (_name, parameters) => {
    const problems = problemsForPart({ parameters });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${PARTS}[0].parameters is`);
    expect(problems[0]).toMatch(/expected an object/u);
  });

  it.each([
    ["a bare number", 80],
    ["a list", [80]],
    ["null", null],
  ])("refuses a parameter written as %s", (_name, parameter) => {
    const problems = problemsForParameter(parameter);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${COVERAGE} is`);
    expect(problems[0]).toContain('{ "value": 80, "direction": "floor" }');
  });

  it("refuses a parameter with no value", () => {
    const problems = problemsForParameter({ direction: "floor" });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${COVERAGE}.value is missing`);
    expect(problems[0]).toContain('{ "value": 80, "direction": "floor" }');
  });

  it.each([
    ["a list", [80]],
    ["an object", { percent: 80 }],
    ["null", null],
    ["not a finite number", Number.POSITIVE_INFINITY],
  ])("refuses a value that is %s", (_name, value) => {
    const problems = problemsForParameter({ value });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${COVERAGE}.value is`);
    expect(problems[0]).toMatch(/expected a number, text, or true or false/u);
  });

  it("refuses a direction that is neither a floor nor a ceiling", () => {
    const problems = problemsForParameter({ value: 80, direction: "up" });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${COVERAGE}.direction is "up"`);
    expect(problems[0]).toContain("floor");
    expect(problems[0]).toContain("ceiling");
  });

  it("refuses a direction on a value that is not a number", () => {
    const problems = problemsForParameter({
      value: "high",
      direction: "floor",
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${COVERAGE}.direction is "floor"`);
    expect(problems[0]).toContain(`${COVERAGE}.value is "high"`);
  });

  it.each(PARAMETER_DIRECTIONS)("accepts a number held to a %s", direction => {
    expect(problemsForParameter({ value: 0, direction })).toEqual([]);
  });
});

describe("a gate that has parts and another prover", () => {
  it("is refused when it also names one task for the whole gate", () => {
    const problems = problemsFor([{ scope: "api", command: API_COMMAND }], {
      run: "lint",
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`gates."${GATE}".run`);
    expect(problems[0]).toContain("parts");
  });

  it.each([
    ["run", "lint"],
    ["await", "Review Bot"],
  ])("is refused when one moment declares %s", (key, value) => {
    const problems = validateGates({
      [GATE]: {
        commit: "required",
        "pull-request": { level: "required", [key]: value },
        parts: [{ scope: "api", command: API_COMMAND }],
      },
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`gates."${GATE}"."pull-request".${key}`);
    expect(problems[0]).toContain("parts");
  });

  it("is refused when the gate stops an action before it happens", () => {
    const problems = validateGates({
      "verification-bypass": {
        "pre-tool": "required",
        parts: [{ scope: "api", command: API_COMMAND }],
      },
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('gates."verification-bypass".parts');
    expect(problems[0]).toMatch(/cannot be handed to a command/u);
  });
});
