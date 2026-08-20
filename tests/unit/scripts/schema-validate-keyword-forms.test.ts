/**
 * A keyword's NAME passing the allowlist is not the same as its FORM being
 * applied.
 *
 * `lisa-schema-validate.mjs` promises that "an unsupported keyword is a
 * validator error, not a pass", and it enforced that promise at the level of a
 * keyword's name only. Four keywords were accepted by name and then silently
 * not applied when written in a form the implementation does not handle:
 * `additionalProperties` as a subschema, sibling keywords beside a `$ref`,
 * `items: false`, and a string `required`. Each is a schema that validates less
 * than it says.
 *
 * That is the same defect already fixed once for `type`, whose array form fell
 * through a `typeof === "string"` test entirely. This suite is the general
 * case: every supported keyword now declares the form it must be written in,
 * and anything else is a validator error.
 * @module tests/unit/scripts/schema-validate-keyword-forms
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { validateAgainstSchema } from "../../../all/copy-overwrite/scripts/lisa-schema-validate.mjs";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const SCHEMA_DIR = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  "scripts",
  "schemas"
);

/** The prefix `validateAgainstSchema` puts on a thrown schema defect. */
const SCHEMA_ERROR = "schema error:";

/**
 * The single error a schema defect produces.
 * @param document Value under validation.
 * @param schema Schema to apply.
 * @returns The joined error text.
 */
function errorsOf(document: unknown, schema: unknown): string {
  return validateAgainstSchema(document, schema).errors.join(" | ");
}

describe("additionalProperties written as a subschema", () => {
  const SUBSCHEMA = {
    type: "object",
    properties: { known: { type: "string" } },
    additionalProperties: { type: "string" },
  };

  it("is a validator error rather than an unconstrained pass", () => {
    // Before the fix this reported VALID: the keyword passed the allowlist,
    // only `=== false` was ever acted on, and every additional property went
    // through unconstrained.
    const result = validateAgainstSchema({ known: "x", extra: 1 }, SUBSCHEMA);

    expect(result.valid).toBe(false);
    expect(result.errors.join(" | ")).toContain("additionalProperties");
  });

  it("names the form it expected", () => {
    expect(errorsOf({}, SUBSCHEMA)).toContain(SCHEMA_ERROR);
  });

  it("still applies the boolean form (control)", () => {
    const closed = {
      type: "object",
      properties: { known: { type: "string" } },
      additionalProperties: false,
    };

    expect(validateAgainstSchema({ known: "x", extra: 1 }, closed).valid).toBe(
      false
    );
    expect(validateAgainstSchema({ known: "x" }, closed).valid).toBe(true);
  });

  it("still refuses an unimplemented keyword by name (control)", () => {
    // The behaviour that already worked, and the bar the form check is held to.
    expect(
      validateAgainstSchema("x", { type: "string", maxLength: 1 }).valid
    ).toBe(false);
  });
});

describe("sibling keywords beside a $ref", () => {
  const WITH_SIBLING = {
    $defs: { name: { type: "string" } },
    $ref: "#/$defs/name",
    enum: ["allowed"],
  };

  it("are a validator error rather than silently discarded", () => {
    // Before the fix the $ref branch validated against the target and returned,
    // dropping every sibling: a value satisfying the target but violating the
    // sibling enum reported VALID.
    const result = validateAgainstSchema("violates-the-enum", WITH_SIBLING);

    expect(result.valid).toBe(false);
    expect(result.errors.join(" | ")).toContain("$ref");
  });

  it("does not object to annotation-only siblings", () => {
    // `{ "$ref": ..., "description": ... }` is ordinary and carries no
    // validation semantics, so refusing it would be a false positive.
    const annotated = {
      $defs: { name: { type: "string" } },
      $ref: "#/$defs/name",
      description: "a name",
    };

    expect(validateAgainstSchema("x", annotated).valid).toBe(true);
    expect(validateAgainstSchema(1, annotated).valid).toBe(false);
  });

  it("still applies an enum with no $ref beside it (control)", () => {
    expect(
      validateAgainstSchema("violates-the-enum", { enum: ["allowed"] }).valid
    ).toBe(false);
  });
});

describe("items written as a boolean", () => {
  it("is a validator error rather than a no-op", () => {
    // `if (actualType === "array" && schema.items)` skipped on any falsy value,
    // so `items: false` — "no items permitted" — permitted everything.
    const result = validateAgainstSchema([1, 2], {
      type: "array",
      items: false,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join(" | ")).toContain("items");
  });

  it("still validates entries against a subschema (control)", () => {
    const schema = { type: "array", items: { type: "string" } };

    expect(validateAgainstSchema(["a", "b"], schema).valid).toBe(true);
    expect(validateAgainstSchema(["a", 2], schema).valid).toBe(false);
  });
});

describe("required written as a string", () => {
  it("is a validator error rather than a character-by-character walk", () => {
    // `for (const key of schema.required ?? [])` iterates a string by
    // character: `required: ""` checked nothing and reported valid.
    const result = validateAgainstSchema(
      { anything: 1 },
      { type: "object", required: "" }
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join(" | ")).toContain("required");
  });

  it("is an error for a non-empty string too", () => {
    // The louder half: `required: "workflow"` looked for properties named `w`,
    // `o`, `r`, … and produced nonsense errors instead of naming the defect.
    expect(
      errorsOf({ workflow: 1 }, { type: "object", required: "workflow" })
    ).toContain(SCHEMA_ERROR);
  });

  it("still applies an array of names (control)", () => {
    const schema = { type: "object", required: ["workflow"] };

    expect(validateAgainstSchema({ workflow: 1 }, schema).valid).toBe(true);
    expect(validateAgainstSchema({ other: 1 }, schema).valid).toBe(false);
  });
});

describe("the schemas Lisa ships are unaffected", () => {
  const SHIPPED = [
    "lisa-state-contract.v1.schema.json",
    "lisa-command-envelope.v1.schema.json",
  ] as const;

  it.each(SHIPPED)("%s reports content errors, never schema errors", name => {
    // A form check that redefines a shipped schema as malformed would take the
    // gates offline, which is a worse outcome than the hole it closes. An
    // empty document violates these schemas' content; it must not read as a
    // defect in the schema itself.
    const schema: unknown = JSON.parse(
      readFileSync(path.join(SCHEMA_DIR, name), "utf8")
    );
    const result = validateAgainstSchema({}, schema);

    expect(result.valid).toBe(false);
    for (const error of result.errors) {
      expect(error, name).not.toContain(SCHEMA_ERROR);
    }
  });
});
