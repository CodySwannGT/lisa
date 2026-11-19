/**
 * Validation of the control keys a gate may declare: `criteria`, `owner`,
 * `tier` and `parts`.
 *
 * A repository with more than one part — an API in one folder, a web client in
 * another — proves the same property with a different command in each. `parts`
 * is where a gate says so: one entry per folder, each naming its scope and the
 * argument list that checks it. The other three keys say which requirements
 * the gate serves, who answers for it, and whether the author of a change can
 * get around it.
 *
 * Every refusal here is read by an operator, so each assertion checks that the
 * message names the gate and the key at fault.
 * @module tests/unit/scripts/lisa-gates-parts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import {
  CRITERION_ID_PATTERN,
  GATE_FIELDS,
  PARAMETER_DIRECTIONS,
  PARAMETER_FIELDS,
  PART_FIELDS,
  PROOF_DIRECTORY,
  PROOF_FIELDS,
  TIERS,
  validateGates,
  WHOLE_REPOSITORY,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);

/** A gate this project invented, so the registry has no opinion about it. */
const GATE = "x-lint";

/** Where every problem about that gate's parts is reported. */
const PARTS = `gates."${GATE}".parts`;

/** The accountable party the examples name. */
const OWNER = "Platform team";

/** The title shared by every table of malformed values. */
const REFUSED_WHEN = "is refused when it is %s";

const API_COMMAND = ["go", "vet", "./..."];
const WEB_COMMAND = ["npm", "run", "lint"];
const VIOLATION = `${PROOF_DIRECTORY}x-lint-api.violation.patch`;
const CLEAN = `${PROOF_DIRECTORY}x-lint-api.clean.patch`;

/** One part of the repository, as a gate declares it. */
type Part = Record<string, unknown>;

/**
 * A gates block holding one custom gate with the given parts.
 * @param parts - The gate's `parts` value, well-formed or not
 * @param extra - Further keys for the gate entry
 * @returns The gates block
 */
const blockWith = (
  parts: unknown,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  [GATE]: { commit: "required", parts, ...extra },
});

/**
 * The problems reported for one custom gate with the given parts.
 * @param parts - The gate's `parts` value
 * @param extra - Further keys for the gate entry
 * @returns Every problem validation reports
 */
const problemsFor = (
  parts: unknown,
  extra: Record<string, unknown> = {}
): string[] => validateGates(blockWith(parts, extra));

/**
 * The problems reported for a single part that is otherwise well-formed.
 * @param overrides - Keys to set on the part; `undefined` removes one
 * @returns Every problem validation reports
 */
const problemsForPart = (overrides: Part): string[] => {
  const part: Part = { scope: "api", command: API_COMMAND, ...overrides };
  const declared = Object.fromEntries(
    Object.entries(part).filter(([, value]) => value !== undefined)
  );
  return problemsFor([declared]);
};

/**
 * The problems reported for a part whose proof block is the given value.
 * @param proof - The part's `proof` value
 * @returns Every problem validation reports
 */
const problemsForProof = (proof: unknown): string[] =>
  problemsForPart({ proof });

/**
 * The problems reported for a part with one named parameter.
 * @param parameter - The parameter's declared value
 * @returns Every problem validation reports
 */
const problemsForParameter = (parameter: unknown): string[] =>
  problemsForPart({ parameters: { coverage: parameter } });

/**
 * The problems reported for a gate-level key on an otherwise valid gate.
 * @param key - The gate-level key
 * @param value - Its declared value
 * @returns Every problem validation reports
 */
const problemsForGateKey = (key: string, value: unknown): string[] =>
  validateGates({ [GATE]: { run: "lint", commit: "required", [key]: value } });

describe("the control keys on a gate", () => {
  // These sets are built while the module LOADS, and per-test mutation
  // coverage credits load-time code to whichever test imported the module
  // first. Loading a fresh copy inside the test body is what makes an altered
  // list fail here rather than nowhere.
  it("publishes the closed sets a later reader builds against", async () => {
    vi.resetModules();
    const fresh =
      await import("../../../all/copy-overwrite/scripts/lisa-gates.mjs");

    expect(fresh.TIERS).toEqual(["authoritative", "advisory"]);
    expect(fresh.PART_FIELDS).toEqual([
      "scope",
      "command",
      "parameters",
      "proof",
      "evidence",
    ]);
    expect(fresh.PROOF_FIELDS).toEqual([
      "violation",
      "clean",
      "failure_shape",
      "timeout_seconds",
      "external_effects",
    ]);
    expect(fresh.PARAMETER_FIELDS).toEqual(["value", "direction"]);
    expect(fresh.PARAMETER_DIRECTIONS).toEqual(["floor", "ceiling"]);
    expect(fresh.PROOF_DIRECTORY).toBe(".lisa/controls/proofs/");
    expect(fresh.WHOLE_REPOSITORY).toBe(".");
    expect(fresh.CRITERION_ID_PATTERN.source).toBe(
      String.raw`^(?:AC[1-9]\d*\.[1-9]\d*|(?:SI|DP|UX)[1-9]\d*)$`
    );
  });

  it("cannot be added to by a caller", () => {
    for (const closed of [
      TIERS,
      PART_FIELDS,
      PROOF_FIELDS,
      PARAMETER_FIELDS,
      PARAMETER_DIRECTIONS,
    ]) {
      expect(Object.isFrozen(closed)).toBe(true);
    }
  });

  it("are settings, so none of them is refused as a misspelt moment", () => {
    expect(
      [...GATE_FIELDS].filter(field =>
        ["criteria", "owner", "tier", "parts"].includes(field)
      )
    ).toHaveLength(4);
    expect(
      validateGates({
        [GATE]: {
          run: "lint",
          commit: "required",
          criteria: ["SI7"],
          owner: OWNER,
          tier: "advisory",
        },
      })
    ).toEqual([]);
  });
});

describe("a gate with parts", () => {
  it("validates when two parts cover different folders", () => {
    expect(
      problemsFor([
        { scope: "api", command: API_COMMAND },
        { scope: "web", command: WEB_COMMAND },
      ])
    ).toEqual([]);
  });

  it("validates on a gate Lisa knows, with every optional key filled in", () => {
    const problems = validateGates({
      "code-style": {
        commit: "required",
        "pull-request": { level: "required", failure_shape: ["✖ lint"] },
        criteria: ["SI7", "AC5.4"],
        owner: OWNER,
        tier: "authoritative",
        parts: [
          {
            scope: WHOLE_REPOSITORY,
            command: ["make", "lint", ""],
            parameters: {
              "max-warnings": { value: 0, direction: "ceiling" },
              coverage: { value: 41.5, direction: "floor" },
              config: { value: ".golangci.yml" },
              strict: { value: true },
            },
            proof: {
              violation: VIOLATION,
              clean: CLEAN,
              failure_shape: ["lint failed"],
              timeout_seconds: 120,
              external_effects: [],
            },
          },
          { scope: "services/billing api", command: ["cargo", "clippy"] },
        ],
      },
    });

    expect(problems).toEqual([]);
  });

  it("accepts a part with no proof, or with only one half of it", () => {
    // The paired proof is written after the part is declared, and an entry
    // missing a half is reported as unproved when it is attested. Refusing it
    // here would make a declaration unreadable until its proofs exist.
    expect(problemsForPart({ proof: undefined })).toEqual([]);
    expect(problemsForProof({})).toEqual([]);
    expect(problemsForProof({ violation: VIOLATION })).toEqual([]);
    expect(problemsForProof({ clean: CLEAN })).toEqual([]);
  });

  it("accepts a declared external effect, quoted to whoever must allow it", () => {
    expect(
      problemsForProof({
        external_effects: ["Raises an alert in the secret scanner"],
      })
    ).toEqual([]);
  });

  it("lets a part be the prover of a gate Lisa has no default task for", () => {
    // Without parts this declaration is refused: a custom gate with no `run`
    // names nothing to execute. The part's command is what executes.
    expect(validateGates({ [GATE]: { commit: "required" } })).toHaveLength(1);
    expect(problemsFor([{ scope: "api", command: API_COMMAND }])).toEqual([]);
  });
});

describe("a part's command", () => {
  it("is refused as a single string, naming the gate and the key", () => {
    const problems = problemsForPart({ command: "npm run lint" });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${PARTS}[0].command`);
    expect(problems[0]).toContain('"npm run lint"');
    expect(problems[0]).toMatch(/list with one item per argument/u);
    expect(problems[0]).toMatch(/never through a shell/u);
  });

  it.each([
    ["missing", undefined, /is missing/u],
    ["an empty list", [], /is empty, so there is nothing to run/u],
    ["an object", { program: "npm" }, /expected a list/u],
    ["a number", 7, /expected a list/u],
    ["null", null, /expected a list/u],
  ])(REFUSED_WHEN, (_name, command, expected) => {
    const problems = problemsForPart({ command });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${PARTS}[0].command`);
    expect(problems[0]).toMatch(expected);
    // Every refusal shows what a well-formed command looks like.
    expect(problems[0]).toContain('for example ["npm", "run", "lint"]');
  });

  it("names each item that is not text", () => {
    const problems = problemsForPart({ command: ["npm", 3, null] });

    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain(`${PARTS}[0].command[1] is 3`);
    expect(problems[1]).toContain(`${PARTS}[0].command[2] is null`);
  });

  it("is refused when the program to run is blank", () => {
    const problems = problemsForPart({ command: [" ", "--fix"] });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${PARTS}[0].command[0] is blank`);
  });

  it("may carry an empty argument after the program", () => {
    expect(problemsForPart({ command: ["grep", ""] })).toEqual([]);
  });
});

describe("a part's scope", () => {
  it.each([
    ["..", /contains "\.\."/u],
    ["../shared", /contains "\.\."/u],
    ["api/../../etc", /contains "\.\."/u],
    ["/srv/api", /starts at the top of the disk/u],
    ["C:/code/api", /starts at the top of the disk/u],
    ["api\\v1", /backslash/u],
  ])("is refused as %j, which is not inside the repository", (scope, why) => {
    const problems = problemsForPart({ scope });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(
      `${PARTS}[0].scope is ${JSON.stringify(scope)}`
    );
    expect(problems[0]).toMatch(why);
    expect(problems[0]).toMatch(/"\." for the whole repository/u);
  });

  it.each([
    ["api/", "api"],
    ["./api", "api"],
    ["api//v1", "api/v1"],
    ["api/./v1", "api/v1"],
    ["./", "."],
  ])("is refused as %j and told to be written %j", (scope, canonical) => {
    const problems = problemsForPart({ scope });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(
      `${PARTS}[0].scope is ${JSON.stringify(scope)}`
    );
    expect(problems[0]).toContain(`Write it as ${JSON.stringify(canonical)}`);
  });

  it.each([
    ["missing", undefined, /is missing/u],
    ["empty", "", /expected the folder/u],
    ["blank", "  ", /expected the folder/u],
    ["a list", ["api"], /expected the folder/u],
    ["a number", 3, /expected the folder/u],
  ])(REFUSED_WHEN, (_name, scope, expected) => {
    const problems = problemsForPart({ scope });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${PARTS}[0].scope`);
    expect(problems[0]).toMatch(expected);
  });

  it.each([".", "api", "services/billing api", "apps/café", ".github"])(
    "is accepted as %j",
    scope => {
      expect(problemsForPart({ scope })).toEqual([]);
    }
  );

  it("may not be shared by two parts of one gate", () => {
    const problems = problemsFor([
      { scope: "api", command: API_COMMAND },
      { scope: "web", command: WEB_COMMAND },
      { scope: "api", command: ["go", "test", "./..."] },
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${PARTS}[2].scope is "api"`);
    expect(problems[0]).toContain(`${PARTS}[0]`);
  });

  it("counts as shared when only the spelling differs", () => {
    const problems = problemsFor([
      { scope: "api", command: API_COMMAND },
      { scope: "api/", command: WEB_COMMAND },
    ]);

    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('Write it as "api"');
    expect(problems[1]).toContain(`the same folder as ${PARTS}[0]`);
  });

  it("may be shared by parts of two different gates", () => {
    expect(
      validateGates({
        [GATE]: {
          commit: "required",
          parts: [{ scope: "api", command: API_COMMAND }],
        },
        "x-tests": {
          commit: "required",
          parts: [{ scope: "api", command: ["go", "test", "./..."] }],
        },
      })
    ).toEqual([]);
  });
});

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

describe("a gate's criteria", () => {
  const CRITERIA = `gates."${GATE}".criteria`;

  it.each([
    ["a string", "AC5.4", /expected a list/u],
    ["an object", { AC5: 4 }, /expected a list/u],
    ["empty", [], /is empty/u],
  ])("are refused when they are %s", (_name, criteria, expected) => {
    const problems = problemsForGateKey("criteria", criteria);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(CRITERIA);
    expect(problems[0]).toMatch(expected);
  });

  it.each(["ac5.4", "AC5", "AC0.1", "SI02", "SI2 ", "R15", 5.4, null])(
    "refuse %j, which is not a requirement id",
    id => {
      const problems = problemsForGateKey("criteria", ["AC5.4", id]);

      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(`${CRITERIA}[1] is ${JSON.stringify(id)}`);
      expect(problems[0]).toMatch(/not a requirement id/u);
    }
  );

  it("refuse an id listed twice", () => {
    const problems = problemsForGateKey("criteria", ["SI2", "AC5.4", "SI2"]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${CRITERIA}[2] repeats "SI2"`);
    expect(problems[0]).toContain(`${CRITERIA}[0]`);
  });

  it("accept every id in the criterion catalogue", () => {
    // The registry ships to repositories that do not carry the catalogue, so
    // it checks how an id is written and nothing else. This is what keeps that
    // check from drifting away from the ids the catalogue actually holds.
    const catalogue = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, "spec", "tasc-criteria.json"),
        "utf8"
      )
    ) as { criteria: { id: string }[] };
    const ids = catalogue.criteria.map(criterion => criterion.id);

    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter(id => !CRITERION_ID_PATTERN.test(id))).toEqual([]);
    expect(problemsForGateKey("criteria", ids)).toEqual([]);
  });
});

describe("a gate's owner", () => {
  it.each(["", "   ", 7, [OWNER], null])("is refused as %j", owner => {
    const problems = problemsForGateKey("owner", owner);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(
      `gates."${GATE}".owner is ${JSON.stringify(owner)}`
    );
    expect(problems[0]).toMatch(/person or team that answers for this gate/u);
  });

  it("is accepted as a name", () => {
    expect(problemsForGateKey("owner", OWNER)).toEqual([]);
  });
});

describe("a gate's tier", () => {
  it.each(["mandatory", "Authoritative", "", true, null])(
    "is refused as %j",
    tier => {
      const problems = problemsForGateKey("tier", tier);

      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(
        `gates."${GATE}".tier is ${JSON.stringify(tier)}`
      );
      expect(problems[0]).toContain("authoritative");
      expect(problems[0]).toContain("advisory");
    }
  );

  it.each(TIERS)("is accepted as %j", tier => {
    expect(problemsForGateKey("tier", tier)).toEqual([]);
  });
});
