/**
 * Validation of `evidence` on one entry of a gate's `parts`.
 *
 * A part is declared because something supports it: the audit found the check
 * in the repository, or a person answered a question the audit asked.
 * `evidence` is where the declaration says which. The gate registry checks
 * only how it is written, because it ships to repositories and never reads an
 * audit report; the control register is where a part without it is refused
 * (CodySwannGT/lisa#4984).
 *
 * Every refusal here is read by an operator, so each assertion checks that the
 * message names the gate and the key at fault.
 * @module tests/unit/scripts/lisa-gates-parts-evidence
 */
import { describe, expect, it, vi } from "vitest";

import {
  PART_EVIDENCE_FIELDS,
  PART_EVIDENCE_LOCATOR_FIELDS,
  resolveMoment,
  validateGates,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

/** A gate this project invented, so the registry has no opinion about it. */
const GATE = "x-lint";

/** Where every problem about the part's evidence is reported. */
const EVIDENCE = `gates."${GATE}".parts[0].evidence`;

const FILE = "api/ruff.toml";
const LOCATOR = { path: FILE, line: 1 };
const NOT_A_PATH = "expected the path of a file";
const REFUSED_WHEN = "is refused when it is %s";

/**
 * A gates block holding one custom gate with one part.
 * @param evidence - The part's `evidence` value; `undefined` leaves it off
 * @returns The gates block
 */
const blockWith = (evidence: unknown): Record<string, unknown> => ({
  [GATE]: {
    commit: "required",
    parts: [
      {
        scope: "api",
        command: ["ruff", "check", "."],
        ...(evidence === undefined ? {} : { evidence }),
      },
    ],
  },
});

/**
 * The problems reported for a part whose evidence is the given value.
 * @param evidence - The part's `evidence` value
 * @returns Every problem validation reports
 */
const problemsFor = (evidence: unknown): string[] =>
  validateGates(blockWith(evidence));

describe("the evidence keys", () => {
  // The lists are built while the module loads; a fresh copy inside the test
  // body is what makes an altered list fail here rather than nowhere.
  it("are published as closed sets a later reader builds against", async () => {
    vi.resetModules();
    const fresh =
      await import("../../../all/copy-overwrite/scripts/lisa-gates.mjs");

    expect(fresh.PART_FIELDS).toContain("evidence");
    expect(fresh.PART_EVIDENCE_FIELDS).toEqual(["locators", "questions"]);
    expect(fresh.PART_EVIDENCE_LOCATOR_FIELDS).toEqual(["path", "line"]);
    expect(Object.isFrozen(PART_EVIDENCE_FIELDS)).toBe(true);
    expect(Object.isFrozen(PART_EVIDENCE_LOCATOR_FIELDS)).toBe(true);
  });
});

describe("evidence on a part", () => {
  it("is optional: the commands that run a part never read it", () => {
    expect(problemsFor(undefined)).toEqual([]);
  });

  it.each([
    ["a place the audit found the check", { locators: [LOCATOR] }],
    ["a question a person answered", { questions: ["coverage-floor"] }],
    [
      "both, several of each",
      {
        locators: [LOCATOR, { path: FILE, line: 4 }],
        questions: ["coverage-floor", "tracker"],
      },
    ],
    [
      "a key of the project's own beside them",
      { locators: [LOCATOR], "x-reviewed-by": "Platform team" },
    ],
    [
      "a file whose name has a space and a letter outside ASCII",
      { locators: [{ path: "docs/règles de style.md", line: 12 }] },
    ],
  ])("validates when it names %s", (_what, evidence) => {
    expect(problemsFor(evidence)).toEqual([]);
  });

  it.each([
    ["a string", `${FILE}:1`],
    ["a list", [LOCATOR]],
    ["null", null],
  ])(REFUSED_WHEN, (_what, evidence) => {
    expect(problemsFor(evidence)).toEqual([
      `${EVIDENCE} is ${JSON.stringify(evidence)}; expected an object such as { "locators": [{ "path": "api/ruff.toml", "line": 1 }] }.`,
    ]);
  });

  it("is refused when it names neither a place nor a question", () => {
    expect(problemsFor({})).toEqual([
      `${EVIDENCE} names neither a place the audit found this check ("locators") nor a question a person answered ("questions"), so the part looks supported while pointing at nothing. Give one of them, for example { "locators": [{ "path": "api/ruff.toml", "line": 1 }] }.`,
    ]);
    expect(problemsFor({ "x-note": "seen in review" })).toHaveLength(1);
  });

  it("is refused when it carries a key Lisa does not read, naming the nearest one", () => {
    const [problem, ...rest] = problemsFor({ locator: [LOCATOR] });

    expect(problem).toMatch(
      /^gates\."x-lint"\.parts\[0\]\.evidence\.locator is not a key Lisa reads here\. Did you mean "locators"\? The keys it reads are locators, questions\./u
    );
    expect(rest).toHaveLength(1);
    expect(rest[0]).toContain("names neither a place");
  });

  it.each([
    ["locators", {}, "a list of the places the audit found this check"],
    ["questions", "tracker", "a list of the ids of the audit questions"],
  ])("refuses %s that is not a list", (key, value, expected) => {
    const [problem, ...rest] = problemsFor({ [key]: value });

    expect(problem).toContain(
      `${EVIDENCE}.${key} is ${JSON.stringify(value)}; expected ${expected}`
    );
    expect(rest).toEqual([]);
  });

  it.each(["locators", "questions"])(
    "refuses an empty %s, which says nothing while looking filled in",
    key => {
      const [problem, ...rest] = problemsFor({ [key]: [] });

      expect(problem).toMatch(
        new RegExp(
          String.raw`^gates\."x-lint"\.parts\[0\]\.evidence\.${key} is empty, so it says nothing while looking filled in\. Remove it, or give a list of `,
          "u"
        )
      );
      expect(rest).toEqual([]);
    }
  );
});

describe("a place in a part's evidence", () => {
  /**
   * The problems reported for one place.
   * @param locator - The place as declared
   * @returns Every problem validation reports
   */
  const problemsForLocator = (locator: unknown): string[] =>
    problemsFor({ locators: [locator] });

  const WHERE = `${EVIDENCE}.locators[0]`;

  it.each([
    ["a string", `${FILE}:1`],
    ["a list", [FILE, 1]],
  ])(REFUSED_WHEN, (_what, locator) => {
    expect(problemsForLocator(locator)).toEqual([
      `${WHERE} is ${JSON.stringify(locator)}; expected an object such as { "path": "api/ruff.toml", "line": 1 }.`,
    ]);
  });

  it.each([
    ["missing", undefined, NOT_A_PATH],
    ["blank", "  ", NOT_A_PATH],
    ["a number", 7, NOT_A_PATH],
    [
      "the whole repository",
      ".",
      "which is the whole repository rather than a file in it",
    ],
    ["outside the repository", "../other/ruff.toml", 'contains ".."'],
    ["an absolute path", "/etc/ruff.toml", "starts at the top of the disk"],
    ["written with a backslash", String.raw`api\ruff.toml`, "uses a backslash"],
    [
      "written a longer way",
      `./${FILE}`,
      'is "api/ruff.toml" written a longer way',
    ],
  ])("refuses a path that is %s", (_what, file, reason) => {
    const problems = problemsForLocator(
      file === undefined ? { line: 1 } : { path: file, line: 1 }
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${WHERE}.path is `);
    expect(problems[0]).toContain(reason);
  });

  it.each([
    ["missing", undefined],
    ["zero", 0],
    ["negative", -3],
    ["a fraction", 1.5],
    ["text", "1"],
  ])("refuses a line that is %s", (_what, line) => {
    expect(
      problemsForLocator(
        line === undefined ? { path: LOCATOR.path } : { ...LOCATOR, line }
      )
    ).toEqual([
      `${WHERE}.line is ${JSON.stringify(line)}; expected the number of the line in that file, counted from 1.`,
    ]);
  });

  it("refuses a key it does not read", () => {
    expect(problemsForLocator({ ...LOCATOR, column: 3 })[0]).toContain(
      `${WHERE}.column is not a key Lisa reads here`
    );
  });

  it("refuses the same place twice, and accepts two lines of one file", () => {
    expect(problemsFor({ locators: [LOCATOR, { ...LOCATOR }] })).toEqual([
      `${EVIDENCE}.locators[1] repeats ${EVIDENCE}.locators[0]. List each one once.`,
    ]);
    expect(
      problemsFor({ locators: [LOCATOR, { ...LOCATOR, line: 2 }] })
    ).toEqual([]);
  });
});

describe("a question in a part's evidence", () => {
  it.each([
    ["blank", " "],
    ["a number", 3],
    ["an object", { id: "tracker" }],
  ])(REFUSED_WHEN, (_what, id) => {
    expect(problemsFor({ questions: [id] })).toEqual([
      `${EVIDENCE}.questions[0] is ${JSON.stringify(id)}; expected the id of an audit question, written exactly as the audit report writes it.`,
    ]);
  });

  it("is refused when it is listed twice", () => {
    expect(problemsFor({ questions: ["tracker", "tracker"] })).toEqual([
      `${EVIDENCE}.questions[1] repeats ${EVIDENCE}.questions[0]. List each one once.`,
    ]);
  });
});

describe("resolution of a part that carries evidence", () => {
  it("is the same as without it: evidence is recorded, never run", () => {
    const resolve = (evidence: unknown): unknown =>
      resolveMoment({
        gates: blockWith(evidence),
        moment: "commit",
        runner: "npm run",
        scripts: null,
      });

    expect(resolve({ locators: [LOCATOR] })).toEqual(resolve(undefined));
  });

  it("is refused while the evidence is malformed", () => {
    expect(() =>
      resolveMoment({
        gates: blockWith({ locators: [] }),
        moment: "commit",
        runner: "npm run",
        scripts: null,
      })
    ).toThrow(/Invalid gates configuration:/u);
  });
});
