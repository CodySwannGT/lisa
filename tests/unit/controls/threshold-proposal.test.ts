/**
 * Proposing a threshold from what a repository measures today.
 *
 * On a stack Lisa ships no checks for, a threshold is the host's to declare.
 * The configure step measures the current value with the host's own tool and
 * proposes exactly that value; what happens to the measurement is decided by
 * code, so no number of Lisa's own can reach the declaration
 * (CodySwannGT/lisa#4984).
 */
import { describe, expect, it } from "vitest";

import {
  PROPOSE_THRESHOLD_COMMAND,
  runProposeThreshold,
  type ProposeThresholdOptions,
} from "../../../src/controls/commands/propose-threshold.js";
import {
  parseMeasuredValue,
  proposeThreshold,
} from "../../../src/controls/threshold-proposal.js";
import { buildOf, entryOf, registerOf } from "./support/register-build.js";

const COVERAGE = "minimum-coverage";

/** What one run of the command printed and returned. */
interface Run {
  readonly code: number;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}

/**
 * Run the command in-process and capture what it prints.
 * @param options - The options as an operator would type them
 * @returns Exit code and printed lines
 */
function run(options: ProposeThresholdOptions): Run {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = runProposeThreshold(options, {
    stdout: line => {
      stdout.push(line);
    },
    stderr: line => {
      stderr.push(line);
    },
  });
  return { code, stdout, stderr };
}

/**
 * Parse what a passing run printed.
 * @param printed - The run
 * @returns The one JSON document on stdout
 */
function documentOf(printed: Run): Record<string, unknown> {
  expect(printed.stderr).toEqual([]);
  expect(printed.code).toBe(0);
  expect(printed.stdout).toHaveLength(1);
  return JSON.parse(String(printed.stdout[0])) as Record<string, unknown>;
}

describe("reading a measured value", () => {
  it.each([
    ["41", 41],
    ["41%", 41],
    [" 41.5 % ", 41.5],
    ["0", 0],
    ["-3", -3],
    [".5", 0.5],
    ["100", 100],
  ])("reads %j as %d", (text, value) => {
    expect(parseMeasuredValue(text)).toBe(value);
  });

  it.each(["", " ", "about 40", "40-45", "41%%", "forty-one", "1e3", "NaN"])(
    "refuses %j, which is not one number",
    text => {
      expect(parseMeasuredValue(text)).toBeNull();
    }
  );
});

describe("a proposed threshold", () => {
  it("is the measured value itself, with the direction it may move in", () => {
    expect(
      proposeThreshold({ name: COVERAGE, measured: 41, direction: "floor" })
    ).toEqual({
      name: COVERAGE,
      measured: 41,
      parameters: { [COVERAGE]: { value: 41, direction: "floor" } },
      question:
        "It measures 41 today. Shall 41 be the lowest it may go from now on?",
      yes_means:
        "A change that takes it below 41 is refused. The number may be raised later and may not be lowered.",
    });
  });

  it.each([0, 3, 41.37, 87.5, 99.99, 100])(
    "is never rounded or raised to a target: %d stays %d",
    measured => {
      const { parameters } = proposeThreshold({
        name: COVERAGE,
        measured,
        direction: "floor",
      });

      expect(parameters[COVERAGE]?.value).toBe(measured);
    }
  );

  it("says what a highest allowed value means", () => {
    const proposal = proposeThreshold({
      name: "max-warnings",
      measured: 12,
      direction: "ceiling",
    });

    expect(proposal.parameters).toEqual({
      "max-warnings": { value: 12, direction: "ceiling" },
    });
    expect(proposal.question).toBe(
      "It measures 12 today. Shall 12 be the highest it may go from now on?"
    );
    expect(proposal.yes_means).toBe(
      "A change that takes it above 12 is refused. The number may be lowered later and may not be raised."
    );
  });
});

describe(`lisa controls ${PROPOSE_THRESHOLD_COMMAND}`, () => {
  it("proposes a floor of 41 for a coverage measured at 41 percent", () => {
    const document = documentOf(run({ name: COVERAGE, measured: "41%" }));

    expect(Object.keys(document)).toEqual([
      "schema_version",
      "name",
      "measured",
      "parameters",
      "question",
      "yes_means",
    ]);
    expect(document).toMatchObject({
      schema_version: 1,
      name: COVERAGE,
      measured: 41,
      parameters: { [COVERAGE]: { value: 41, direction: "floor" } },
    });
  });

  it("puts nothing in the proposal but what it was given", () => {
    const printed = String(
      run({ name: COVERAGE, measured: "41", direction: "floor" }).stdout[0]
    );

    const [version, ...numbers] = printed.match(/\d+(?:\.\d+)?/gu) ?? [];

    expect(version).toBe("1");
    expect(numbers.length).toBeGreaterThan(1);
    expect([...new Set(numbers)]).toEqual(["41"]);
  });

  it("proposes a ceiling when asked for one", () => {
    expect(
      documentOf(
        run({ name: "max-warnings", measured: "12", direction: "ceiling" })
      ).parameters
    ).toEqual({ "max-warnings": { value: 12, direction: "ceiling" } });
  });

  it.each([
    ["no name", { measured: "41" }, "Give the name the number goes by"],
    ["a blank name", { name: " ", measured: "41" }, "Give the name"],
    ["no measurement", { name: COVERAGE }, "Give the value measured today"],
    [
      "a measurement that is not a number",
      { name: COVERAGE, measured: "about 40" },
      '--measured is "about 40", which is not one number.',
    ],
    [
      "a direction that is neither",
      { name: COVERAGE, measured: "41", direction: "up" },
      '--direction is "up"; expected floor',
    ],
  ])(
    "refuses %s and assumes no number in its place",
    (_what, options, said) => {
      const printed = run(options);

      expect(printed.code).toBe(1);
      expect(printed.stdout).toEqual([]);
      expect(printed.stderr[0]).toContain(said);
      expect(printed.stderr.at(-1)).toBe(
        "propose-threshold: FAIL. Nothing was proposed, and no number was assumed in its place"
      );
    }
  );

  it("tells whoever could not measure to ask the operator, not to guess", () => {
    expect(run({ name: COVERAGE, measured: "unknown" }).stderr[0]).toContain(
      "If it could not be measured, do not guess a number: ask the operator."
    );
  });
});

describe("a confirmed threshold in the register", () => {
  /**
   * The declaration configure writes for a coverage check on a stack Lisa
   * ships nothing for, with the proposed threshold taken as it was printed.
   * @param parameters - The `parameters` the proposal printed
   * @returns The `gates` block
   */
  const declared = (parameters: unknown): Record<string, unknown> => ({
    "coverage-adequacy": {
      "pull-request": "required",
      criteria: ["SI2"],
      parts: [
        {
          scope: ".",
          command: ["python", "-m", "pytest", "--cov"],
          parameters,
          evidence: { locators: [{ path: ".coveragerc", line: 1 }] },
        },
      ],
    },
  });

  it("is the host's value and nothing else: no default is added to the entry", async () => {
    const { parameters } = documentOf(run({ name: COVERAGE, measured: "41" }));

    const entry = entryOf(
      await registerOf(declared(parameters)),
      "coverage-adequacy@."
    );

    expect(entry.parameters).toEqual({
      [COVERAGE]: { value: 41, direction: "floor" },
    });
    expect(
      JSON.stringify(entry)
        .match(/\d+(?:\.\d+)?/gu)
        ?.filter(number => !["41", "1", "2"].includes(number))
    ).toEqual([]);
  });

  it("is left off entirely when the operator declines, with no value filled in", async () => {
    const built = await buildOf(declared(undefined));

    expect(built.problems).toBeNull();
    expect(
      built.problems === null
        ? entryOf(built.register, "coverage-adequacy@.").parameters
        : null
    ).toEqual({});
  });
});
