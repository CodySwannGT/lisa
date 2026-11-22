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
 *
 * This file holds the closed sets, a well-formed gate with parts, and a part's
 * command and scope. The parts list, unknown keys and the proof are in
 * `lisa-gates-parts-proof.test.ts`; parameters and a second prover in
 * `lisa-gates-parts-parameters.test.ts`; criteria, owner and tier in
 * `lisa-gates-parts-criteria.test.ts`.
 * @module tests/unit/controls/lisa-gates-parts
 */
import { describe, expect, it, vi } from "vitest";

import {
  GATE_FIELDS,
  PARAMETER_DIRECTIONS,
  PARAMETER_FIELDS,
  PART_FIELDS,
  PROOF_FIELDS,
  TIERS,
  validateGates,
  WHOLE_REPOSITORY,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  API_COMMAND,
  CLEAN,
  GATE,
  OWNER,
  PARTS,
  problemsFor,
  problemsForPart,
  problemsForProof,
  REFUSED_WHEN,
  VIOLATION,
  WEB_COMMAND,
} from "./support/lisa-gates-parts-helpers.js";

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
