/**
 * A register entry is written only where something supports it.
 *
 * A part of a gate says what supports it in `evidence`: a place the audit
 * found the check, or a question a person answered. The register refuses a
 * part that names neither, carries what a part names onto its entry, and
 * leaves a gate with no parts exactly as it was: those rules come from the
 * declarations Lisa ships for a supported project type and have no part to
 * carry evidence (CodySwannGT/lisa#4984).
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PART_EVIDENCE_KEY,
  partsAreEvidenced,
  unevidencedPartProblem,
} from "../../../src/controls/register-evidence-rule.js";
import { CONTROL_REGISTER_RULES } from "../../../src/controls/register-rules.js";
import { CONTROL_REGISTER_PATH } from "../../../src/controls/register-types.js";
import {
  COVERAGE_QUESTION,
  F_MIXED_GATES,
  F_NONE_GATES,
  F_PAVED_GATES,
  declarationOf,
  evidenceAt,
  registerSchemaErrors,
  type GatesBlock,
} from "../../helpers/control-register.js";
import { buildOf, entryOf, registerOf } from "./support/register-build.js";
import { declared, register } from "./support/register-run.js";
import { ENTRY, EVIDENCE, registerWith } from "./support/register-samples.js";
import { removeFixtures } from "./support/report-check-run.js";

const LINT = "code-style";
const RUFF = ["ruff", "check", "."];

/** A lint gate whose `api` part is evidenced and whose `web` part is not. */
const HALF_EVIDENCED: GatesBlock = {
  [LINT]: {
    commit: "required",
    parts: [
      { scope: "api", command: RUFF, evidence: evidenceAt("api/ruff.toml") },
      { scope: "web", command: ["npm", "run", "lint"] },
    ],
  },
};

/**
 * Take the evidence off every part of a declaration.
 * @param block - A `gates` block
 * @returns The same block with no part saying what supports it
 */
function withoutEvidence(block: GatesBlock): GatesBlock {
  return Object.fromEntries(
    Object.entries(block).map(([id, gate]) => {
      const { parts } = gate as { readonly parts?: readonly object[] };
      return [
        id,
        parts === undefined
          ? gate
          : {
              ...(gate as object),
              parts: parts.map(part =>
                Object.fromEntries(
                  Object.entries(part).filter(
                    ([key]) => key !== PART_EVIDENCE_KEY
                  )
                )
              ),
            },
      ];
    })
  );
}

afterEach(removeFixtures);

describe("a part that says nothing about what supports it", () => {
  it("is refused by name, in words an operator can act on", async () => {
    const built = await buildOf(HALF_EVIDENCED);

    expect(built.problems).toEqual([
      'The gate "code-style" in .lisa.config.json has a part for the folder web that says nothing about what supports it. A rule is recorded only where the audit found its check or a person answered a question about it. Add "evidence" to that part, naming the place the audit report gives ("locators") or the answered question ("questions"), or remove the part.',
    ]);
    expect(built.problems).toEqual([unevidencedPartProblem(LINT, "web")]);
  });

  it("is named as the whole repository when that is what it covers", () => {
    expect(
      partsAreEvidenced({
        declaration: declarationOf({
          [LINT]: {
            commit: "required",
            parts: [{ scope: ".", command: RUFF }],
          },
        }),
      })
    ).toEqual([
      expect.stringContaining("has a part for the whole repository that says"),
    ]);
  });

  it.each([
    ["F-none", F_NONE_GATES, 2],
    ["F-mixed", F_MIXED_GATES, 3],
  ])("is refused once per part on %s", async (_name, block, parts) => {
    expect((await buildOf(withoutEvidence(block))).problems).toHaveLength(
      parts
    );
  });

  it("is one of the rules every declaration is held to", () => {
    expect(CONTROL_REGISTER_RULES).toContain(partsAreEvidenced);
  });

  it.each([
    ["writing", false],
    ["checking", true],
  ])("stops %s the register, and nothing is written", async (_mode, check) => {
    const repoPath = declared("F-mixed", HALF_EVIDENCED);

    const run = await register(repoPath, check);

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr[0]).toBe(unevidencedPartProblem(LINT, "web"));
    expect(run.stderr[1]).toMatch(
      /^register(?: --check)?: FAIL\. 1 problem with the gates declaration in \.lisa\.config\.json, so no register could be generated\./u
    );
    expect(existsSync(path.join(repoPath, CONTROL_REGISTER_PATH))).toBe(false);
  });
});

describe("a gate with no parts", () => {
  it("still generates, and its entry carries no evidence", async () => {
    const register = await registerOf(F_PAVED_GATES, {});

    expect(register.entries.length).toBeGreaterThan(0);
    expect(
      register.entries.filter(entry => PART_EVIDENCE_KEY in entry)
    ).toEqual([]);
  });

  it("is not looked at by the rule, beside a gate whose parts are evidenced", async () => {
    const register = await registerOf({
      ...F_PAVED_GATES,
      "x-docs": {
        push: "optional",
        parts: [
          { scope: "docs", command: ["vale", "."], evidence: evidenceAt("x") },
        ],
      },
    });

    expect(
      register.entries
        .filter(entry => entry.evidence !== undefined)
        .map(entry => entry.id)
    ).toEqual(["x-docs@docs"]);
  });
});

describe("an entry generated from a part", () => {
  it("carries the place the audit found its check", async () => {
    expect(
      (await registerOf(F_MIXED_GATES)).entries.map(entry => [
        entry.id,
        entry.evidence,
      ])
    ).toEqual([
      [
        "code-style@api",
        { locators: [{ path: "api/ruff.toml", line: 1 }], questions: [] },
      ],
      [
        "code-style@web",
        { locators: [{ path: "web/package.json", line: 1 }], questions: [] },
      ],
      [
        "type-correctness@web",
        { locators: [{ path: "web/tsconfig.json", line: 1 }], questions: [] },
      ],
    ]);
  });

  it("carries the question a person answered", async () => {
    expect(
      entryOf(await registerOf(F_NONE_GATES), "coverage-adequacy@.").evidence
    ).toEqual({ locators: [], questions: [COVERAGE_QUESTION] });
  });

  it("keeps the order the declaration lists them in, and none of the project's own keys", async () => {
    const evidence = {
      locators: [
        { path: "b.toml", line: 9 },
        { path: "a.toml", line: 2 },
      ],
      questions: ["z", "a"],
      "x-note": "reviewed",
    };
    const register = await registerOf({
      [LINT]: { parts: [{ scope: "api", command: RUFF, evidence }] },
    });

    expect(entryOf(register, "code-style@api").evidence).toEqual({
      locators: evidence.locators,
      questions: evidence.questions,
    });
  });
});

describe("the published schema", () => {
  it.each([
    ["F-none", F_NONE_GATES],
    ["F-mixed", F_MIXED_GATES],
  ])(
    "accepts the evidence the generator writes for %s",
    async (_name, block) => {
      expect(registerSchemaErrors(await registerOf(block))).toEqual([]);
    }
  );

  it.each([
    ["a key it does not list", { ...EVIDENCE, note: "x" }],
    ["no list of places", { questions: EVIDENCE.questions }],
    ["no list of questions", { locators: EVIDENCE.locators }],
    ["a place with no line", { ...EVIDENCE, locators: [{ path: "a.toml" }] }],
    [
      "a line counted from zero",
      { ...EVIDENCE, locators: [{ path: "a.toml", line: 0 }] },
    ],
    [
      "a place with a key it does not list",
      { ...EVIDENCE, locators: [{ path: "a.toml", line: 1, column: 2 }] },
    ],
    ["an empty question id", { ...EVIDENCE, questions: [""] }],
  ])("refuses evidence with %s", (_what, evidence) => {
    expect(
      registerSchemaErrors(registerWith({ ...ENTRY, evidence }))
    ).not.toEqual([]);
  });
});
