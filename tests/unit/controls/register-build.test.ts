/**
 * What the control register says for a given gates declaration.
 *
 * The register is the one record of what governs a repository, so each case
 * here is a claim an operator relies on when reading it: one entry per folder
 * a rule covers, an identifier that does not move, and the same bytes for the
 * same declaration (CodySwannGT/lisa#4983).
 */
import { describe, expect, it } from "vitest";

import { serializeControlRegister } from "../../../src/controls/register.js";
import {
  controlEntryId,
  type ControlRegister,
} from "../../../src/controls/register-types.js";
import {
  F_MIXED_GATES,
  F_NONE_GATES,
  F_PAVED_GATES,
  OWNER,
  evidenceAt,
} from "../../helpers/control-register.js";
import { buildOf, entryOf, registerOf } from "./support/register-build.js";

const LINT = "code-style";
const LINT_WHOLE = "code-style@.";
const LINT_API = "code-style@api";
const LINT_WEB = "code-style@web";

describe("a repository with more than one part", () => {
  it("gets one lint entry per folder, each with its own command", async () => {
    const lint = (await registerOf(F_MIXED_GATES)).entries.filter(
      candidate => candidate.gate === LINT
    );

    expect(lint.map(candidate => candidate.scope)).toEqual(["api", "web"]);
    expect(lint.map(candidate => candidate.measuring_mechanism)).toEqual([
      { kind: "command", argv: ["ruff", "check", "."] },
      { kind: "command", argv: ["npm", "run", "lint"] },
    ]);
    expect(lint.map(candidate => candidate.criteria)).toEqual([
      ["SI7"],
      ["SI7"],
    ]);
  });

  it("states all nine things about a part, what supports it, and the gate it came from", async () => {
    expect(entryOf(await registerOf(F_NONE_GATES), LINT_WHOLE)).toEqual({
      id: LINT_WHOLE,
      gate: LINT,
      criteria: ["SI7"],
      scope: ".",
      tier: "authoritative",
      enforcement_points: [
        { moment: "commit", level: "required", location: "local-checkout" },
        {
          moment: "pull-request",
          level: "required",
          location: "hosting-platform",
        },
      ],
      measuring_mechanism: { kind: "command", argv: ["ruff", "check", "."] },
      parameters: {},
      proof: {
        violation: ".lisa/controls/proofs/lint.violation.patch",
        clean: ".lisa/controls/proofs/lint.clean.patch",
        failure_shape: ["Found 1 error"],
        timeout_seconds: 120,
        external_effects: [],
      },
      accountable_party: OWNER,
      evidence: { locators: [{ path: "ruff.toml", line: 1 }], questions: [] },
    });
  });

  it("records a threshold with the direction it may move in, and an undeclared proof as nulls", async () => {
    const coverage = entryOf(
      await registerOf(F_NONE_GATES),
      "coverage-adequacy@."
    );

    expect(coverage.parameters).toEqual({
      "minimum-coverage": { value: 80, direction: "floor" },
    });
    expect(coverage.proof).toEqual({
      violation: null,
      clean: null,
      failure_shape: null,
      timeout_seconds: null,
      external_effects: null,
    });
  });

  it("lists a part that is declared and enforced nowhere, with no enforcement points", async () => {
    const register = await registerOf({
      [LINT]: {
        parts: [
          {
            scope: "api",
            command: ["ruff", "check", "."],
            evidence: evidenceAt("api/ruff.toml"),
          },
        ],
      },
    });

    expect(entryOf(register, LINT_API)).toMatchObject({
      enforcement_points: [],
      measuring_mechanism: { kind: "command", argv: ["ruff", "check", "."] },
      tier: "advisory",
      accountable_party: null,
    });
  });
});

describe("an entry's identifier", () => {
  it("is the gate, an @ and the folder", async () => {
    expect(controlEntryId(LINT, "api")).toBe(LINT_API);
    expect(
      (await registerOf(F_MIXED_GATES)).entries.map(candidate => candidate.id)
    ).toEqual([LINT_API, LINT_WEB, "type-correctness@web"]);
  });

  it("does not change when an unrelated gate or folder is added or removed", async () => {
    const mixed = await registerOf(F_MIXED_GATES);
    const more = await registerOf({
      ...F_MIXED_GATES,
      "build-integrity": { push: "required" },
      [LINT]: {
        ...(F_MIXED_GATES[LINT] as object),
        parts: [
          {
            scope: "docs",
            command: ["vale", "."],
            evidence: evidenceAt("docs/.vale.ini"),
          },
          ...(F_MIXED_GATES[LINT] as { parts: readonly object[] }).parts,
        ],
      },
    });
    const fewer = await registerOf({ [LINT]: F_MIXED_GATES[LINT] });

    expect(entryOf(more, LINT_API)).toEqual(entryOf(mixed, LINT_API));
    expect(entryOf(fewer, LINT_WEB)).toEqual(entryOf(mixed, LINT_WEB));
  });

  it("is refused when two entries would share it", async () => {
    const built = await buildOf({
      "x-docs": {
        push: "optional",
        parts: [
          { scope: "a@b", command: ["true"], evidence: evidenceAt("a@b/x") },
        ],
      },
      "x-docs@a": {
        push: "optional",
        parts: [{ scope: "b", command: ["true"], evidence: evidenceAt("b/x") }],
      },
    });

    expect(built.problems).toEqual([
      'Two entries would share the identifier "x-docs@a@b": the gate "x-docs" for the folder "a@b" and the gate "x-docs@a" for the folder "b". Rename one of the gates in .lisa.config.json so each entry can be told apart.',
    ]);
  });
});

describe("the same declaration always gives the same register", () => {
  it.each([
    ["F-none", F_NONE_GATES],
    ["F-mixed", F_MIXED_GATES],
    ["F-paved", F_PAVED_GATES],
  ])("%s serialises to the same bytes twice", async (_name, block) => {
    expect(serializeControlRegister(await registerOf(block))).toBe(
      serializeControlRegister(await registerOf(block))
    );
  });

  it("does not depend on the order the declaration is written in", async () => {
    const backwards = Object.fromEntries(
      Object.entries(F_MIXED_GATES)
        .reverse()
        .map(([id, gate]) => [
          id,
          Object.fromEntries(Object.entries(gate as object).reverse()),
        ])
    );

    expect(serializeControlRegister(await registerOf(backwards))).toBe(
      serializeControlRegister(await registerOf(F_MIXED_GATES))
    );
  });

  it("writes sorted keys, two-space indents, one final newline and no date", async () => {
    const text = serializeControlRegister(await registerOf(F_MIXED_GATES));
    const keys = Object.keys(
      (JSON.parse(text) as ControlRegister).entries[0] ?? {}
    );

    expect(text.startsWith('{\n  "entries": [\n    {\n')).toBe(true);
    expect(text.endsWith('"schema_version": 1\n}\n')).toBe(true);
    expect(keys).toEqual([
      "accountable_party",
      "criteria",
      "enforcement_points",
      "evidence",
      "gate",
      "id",
      "measuring_mechanism",
      "parameters",
      "proof",
      "scope",
      "tier",
    ]);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/u);
  });
});

describe("a requirement id the catalogue does not list as in scope", () => {
  it("refuses an id that names no requirement, in plain words", async () => {
    const built = await buildOf({
      [LINT]: { commit: "required", criteria: ["SI7", "AC99.9"] },
    });

    expect(built.problems).toEqual([
      'The gate "code-style" in .lisa.config.json says it serves "AC99.9", but there is no requirement with that id. Write the id exactly as the audit report shows it, or remove it from the gate\'s criteria.',
    ]);
  });

  it("refuses a requirement this level leaves out, and says why it is left out", async () => {
    const built = await buildOf({
      [LINT]: { commit: "required", criteria: ["UX3"] },
    });

    expect(built.problems).toHaveLength(1);
    expect(built.problems?.[0]).toMatch(
      /^The gate "code-style" in \.lisa\.config\.json says it serves "UX3" \(.+\), but that requirement is not one this level checks\. The specification .+ Remove it from the gate's criteria\.$/u
    );
  });

  it("names every such id across every gate, not only the first", async () => {
    const built = await buildOf({
      [LINT]: { commit: "required", criteria: ["AC99.9"] },
      "type-correctness": { push: "required", criteria: ["SI999", "SI1"] },
    });

    expect(built.problems).toHaveLength(2);
  });

  it("writes declared ids in catalogue order whatever order they were given in", async () => {
    const register = await registerOf({
      [LINT]: { commit: "required", criteria: ["SI7", "AC5.4", "SI1"] },
    });

    expect(entryOf(register, LINT_WHOLE).criteria).toEqual([
      "AC5.4",
      "SI1",
      "SI7",
    ]);
  });
});
