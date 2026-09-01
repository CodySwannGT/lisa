/**
 * The prototype chain is not a source of schema policy.
 *
 * `lisa-schema-validate.mjs` asked five separate own-property questions with
 * operators that walk `Object.prototype`, so a schema or document naming a
 * `Object.prototype` member got the prototype's answer instead of the real one.
 * Measured against the unfixed module:
 *
 * - `KEYWORD_FORMS[keyword]` — `constructor`, `valueOf`, `toString` and
 *   `hasOwnProperty` each returned a truthy prototype member, so the
 *   `!expected` guard never fired and the next line reported
 *   `expected.accepts is not a function`: an internal binding named at an
 *   operator about a schema they wrote.
 * - `root.$defs?.[name]` — `$ref: "#/$defs/constructor"` resolved to the
 *   `Object` constructor, whose own enumerable keys are none, so `12345`
 *   validated as VALID against a reference that resolves to nothing.
 * - `key in value` for `required` — `required: ["toString"]` against `{}`
 *   reported VALID, silently skipping a missing required property.
 * - `key in value` for `properties` — `properties: {toString: …}` against `{}`
 *   validated the inherited function and reported a type error about a
 *   property the document does not have.
 * - `key in properties` for `additionalProperties: false` — a document key
 *   named `toString` was treated as declared and never reported.
 *
 * Each case pairs with a CONTROL using an ordinary name. The controls are the
 * point: they prove the fix restored the right answer rather than muting the
 * path that produced the wrong one.
 * @module tests/unit/scripts/schema-validate-prototype-keywords
 */
import { describe, expect, it } from "vitest";

import { validateAgainstSchema } from "../../../all/copy-overwrite/scripts/lisa-schema-validate.mjs";

/** The prefix `validateAgainstSchema` puts on a thrown schema defect. */
const SCHEMA_ERROR = "schema error:";

/**
 * The `Object.prototype` members a hand-written schema could plausibly name.
 * The issue's acceptance criteria name these four.
 */
const PROTOTYPE_NAMES = [
  "constructor",
  "valueOf",
  "toString",
  "hasOwnProperty",
] as const;

/**
 * The single joined error a validation produces.
 * @param document Value under validation.
 * @param schema Schema to apply.
 * @returns The joined error text.
 */
function errorsOf(document: unknown, schema: unknown): string {
  return validateAgainstSchema(document, schema).errors.join(" | ");
}

describe("a keyword named after an Object.prototype member", () => {
  it.each(PROTOTYPE_NAMES)(
    "%s is reported as an unsupported keyword",
    keyword => {
      expect(errorsOf({}, { type: "object", [keyword]: "x" })).toContain(
        `uses unsupported keyword "${keyword}"`
      );
    }
  );

  it.each(PROTOTYPE_NAMES)("%s does not leak an internal binding", keyword => {
    // The whole defect is the message's content: an operator was told
    // `expected.accepts is not a function` about a schema they wrote, which
    // sends them to the wrong file.
    expect(errorsOf({}, { type: "object", [keyword]: "x" })).not.toContain(
      "expected.accepts"
    );
  });

  it("still names an ordinary unknown keyword as unsupported (control)", () => {
    expect(errorsOf({}, { type: "object", nonsenseKeyword: "x" })).toContain(
      'uses unsupported keyword "nonsenseKeyword"'
    );
  });

  it("still applies every implemented keyword (control)", () => {
    const schema = {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 2, pattern: "^[a-z]+$" },
        count: { type: "number", minimum: 1 },
        mode: { enum: ["on", "off"] },
        tags: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    };

    expect(
      validateAgainstSchema(
        { name: "abc", count: 2, mode: "on", tags: ["x"] },
        schema
      ).valid
    ).toBe(true);
    expect(validateAgainstSchema({ name: "a" }, schema).valid).toBe(false);
  });
});

describe("a $ref naming an Object.prototype member", () => {
  const PROTOTYPE_REF = {
    $defs: { real: { type: "string" } },
    $ref: "#/$defs/constructor",
  };

  it("is unresolvable rather than an empty schema that passes anything", () => {
    // `root.$defs.constructor` is the `Object` constructor, which has no own
    // enumerable keys — so it read as a subschema with no keywords and every
    // value validated against it.
    const result = validateAgainstSchema(12345, PROTOTYPE_REF);

    expect(result.valid).toBe(false);
    expect(result.errors.join(" | ")).toContain(
      'unresolvable $ref "#/$defs/constructor"'
    );
  });

  it("still resolves a real $defs entry (control)", () => {
    const schema = {
      $defs: { real: { type: "string" } },
      $ref: "#/$defs/real",
    };

    expect(validateAgainstSchema("x", schema).valid).toBe(true);
    expect(validateAgainstSchema(1, schema).valid).toBe(false);
  });

  it("still refuses a $defs name that is simply absent (control)", () => {
    expect(errorsOf(1, { $defs: {}, $ref: "#/$defs/missing" })).toContain(
      SCHEMA_ERROR
    );
  });

  it.each([true, false, null, 1, "string", []])(
    "refuses a local $defs target that is not a subschema object (%j)",
    target => {
      const result = validateAgainstSchema(1, {
        $defs: { malformed: target },
        $ref: "#/$defs/malformed",
      });

      expect(result.valid).toBe(false);
      expect(result.errors.join(" | ")).toContain(
        "resolving to a subschema object"
      );
    }
  );
});

describe("an inherited $ref", () => {
  it("cannot replace the schema's own validating keywords", () => {
    const schema = Object.assign(
      Object.create({ $ref: "#/$defs/permissive" }),
      {
        $defs: { permissive: {} },
        enum: ["allowed"],
      }
    );

    expect(validateAgainstSchema("allowed", schema).valid).toBe(true);
    expect(validateAgainstSchema("denied", schema).valid).toBe(false);
  });
});

describe("required naming an Object.prototype member", () => {
  it("reports the property as missing", () => {
    const result = validateAgainstSchema(
      {},
      { type: "object", required: ["toString"] }
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join(" | ")).toContain(
      'missing required property "toString"'
    );
  });

  it("accepts the property when the document really carries it", () => {
    expect(
      validateAgainstSchema(
        { toString: "present" },
        { type: "object", required: ["toString"] }
      ).valid
    ).toBe(true);
  });

  it("still reports an ordinary missing property (control)", () => {
    expect(errorsOf({}, { type: "object", required: ["absent"] })).toContain(
      'missing required property "absent"'
    );
  });
});

describe("properties naming an Object.prototype member", () => {
  const SCHEMA = {
    type: "object",
    properties: { toString: { type: "string" } },
  };

  it("does not validate a property the document does not have", () => {
    // The inherited function was validated in the absent property's place,
    // producing `expected type string, got function` about nothing.
    expect(validateAgainstSchema({}, SCHEMA).valid).toBe(true);
  });

  it("still validates the property when it is really present", () => {
    expect(validateAgainstSchema({ toString: "x" }, SCHEMA).valid).toBe(true);
    expect(validateAgainstSchema({ toString: 1 }, SCHEMA).valid).toBe(false);
  });

  it("still leaves an ordinary absent property alone (control)", () => {
    expect(
      validateAgainstSchema(
        {},
        { type: "object", properties: { absent: { type: "string" } } }
      ).valid
    ).toBe(true);
  });
});

describe("additionalProperties: false with an Object.prototype-named key", () => {
  const CLOSED = {
    type: "object",
    properties: {},
    additionalProperties: false,
  };

  it("reports the key as unexpected", () => {
    const result = validateAgainstSchema({ toString: 1 }, CLOSED);

    expect(result.valid).toBe(false);
    expect(result.errors.join(" | ")).toContain(
      'unexpected property "toString"'
    );
  });

  it("still reports an ordinary undeclared key (control)", () => {
    expect(errorsOf({ zzz: 1 }, CLOSED)).toContain('unexpected property "zzz"');
  });

  it("still permits a declared key (control)", () => {
    expect(
      validateAgainstSchema(
        { known: "x" },
        {
          type: "object",
          properties: { known: { type: "string" } },
          additionalProperties: false,
        }
      ).valid
    ).toBe(true);
  });
});
