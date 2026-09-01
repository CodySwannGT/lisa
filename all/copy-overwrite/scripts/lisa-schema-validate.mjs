#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * lisa-schema-validate — dependency-free validator for the JSON Schema subset
 * Lisa's shipped contract schemas use.
 *
 * Lisa's copy-overwrite scripts run in every adopter repo before that repo has
 * installed anything, so they cannot depend on a schema library. This module
 * implements exactly the keywords the shipped schemas use and **rejects any
 * keyword it does not implement**, so a schema can never silently validate less
 * than it claims: an unsupported keyword is a validator error, not a pass.
 *
 * That promise is enforced on a keyword's FORM as well as its name. A name-only
 * allowlist let four keywords through and then dropped them —
 * `additionalProperties` as a subschema, siblings beside a `$ref`,
 * `items: false`, a string `required` — each a schema validating less than it
 * says, which is the very outcome the allowlist exists to prevent. Every
 * supported keyword therefore declares the shape it must be written in
 * (`KEYWORD_FORMS`), and any other shape is a validator error.
 *
 * Refusing an unimplemented form rather than implementing it is deliberate.
 * Implementing subschema `additionalProperties` and `$ref` siblings would grow
 * a dependency-free validator into a general one, which this module declines to
 * be; refusing is both smaller and the behaviour the header already promises.
 *
 * Supported: `type` (a single name or a non-empty array of names), `const`,
 * `enum` (a non-empty array), `required` (an array of names), `properties` (an
 * object of subschemas), `additionalProperties` (a boolean), `items` (a
 * subschema object), `minLength`, `minimum` (numbers), `pattern` (a string),
 * `$ref` (a local `#/$defs/<name>` string, with no validating siblings),
 * `$defs`, plus the annotation-only keywords `$schema`, `$id`, `title`,
 * `description`.
 * @module scripts/lisa-schema-validate
 */

/** Keywords that carry no validation semantics and are ignored. */
const ANNOTATION_KEYWORDS = new Set([
  "$schema",
  "$id",
  "title",
  "description",
  "$defs",
  "examples",
  "default",
]);

/**
 * Whether a value is a plain JSON object — the shape a subschema takes.
 * @param {unknown} value - Value to test
 * @returns {boolean} Whether it is a non-null, non-array object
 */
function isSchemaObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The keywords this validator implements, each with the FORM it must be written
 * in and a description of that form for the error message.
 *
 * The form is the load-bearing half. A name-only allowlist accepts
 * `additionalProperties: {"type": "string"}`, `items: false` and
 * `required: ""` and then applies none of them, which is a schema silently
 * validating less than it claims — the exact failure the allowlist exists to
 * prevent, reached through the one door nobody checked.
 *
 * `const` takes any JSON value, so its form is unconstrained; that is a real
 * property of the keyword, not an omission.
 */
const KEYWORD_FORMS = Object.freeze({
  type: {
    accepts: value =>
      typeof value === "string" ||
      (Array.isArray(value) &&
        value.length > 0 &&
        value.every(entry => typeof entry === "string")),
    form: "a type name or a non-empty array of type names",
  },
  const: { accepts: () => true, form: "any JSON value" },
  enum: {
    accepts: value => Array.isArray(value) && value.length > 0,
    form: "a non-empty array",
  },
  required: {
    accepts: value =>
      Array.isArray(value) && value.every(entry => typeof entry === "string"),
    form: "an array of property names",
  },
  properties: {
    // The VALUES, not just the container. Checking only the container accepted
    // `{"properties": {"a": true}}` — a form the rest of this file explicitly
    // does not implement, as `items` and `additionalProperties` both say in so
    // many words. The boolean then reached `validateNode` and threw, so a
    // malformed schema crashed the validator instead of producing the
    // validation finding this allowlist exists to produce. The failure was one
    // step later than the check that was supposed to catch it.
    accepts: value =>
      isSchemaObject(value) && Object.values(value).every(isSchemaObject),
    form: "an object whose values are subschema objects (a boolean is not implemented)",
  },
  additionalProperties: {
    accepts: value => typeof value === "boolean",
    form: "a boolean (a subschema is not implemented)",
  },
  items: {
    accepts: isSchemaObject,
    form: "a subschema object (a boolean is not implemented)",
  },
  minLength: { accepts: value => typeof value === "number", form: "a number" },
  minimum: { accepts: value => typeof value === "number", form: "a number" },
  pattern: { accepts: value => typeof value === "string", form: "a string" },
  $ref: { accepts: value => typeof value === "string", form: "a string" },
});

/**
 * JSON type name for a value, using JSON Schema's vocabulary.
 * @param {unknown} value - Value to classify
 * @returns {string} One of null/array/integer/number/string/boolean/object
 */
export function jsonTypeOf(value) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  return typeof value;
}

/**
 * Resolve a local `#/$defs/<name>` reference against the root schema.
 *
 * The lookup is `Object.hasOwn`, not a plain read, because `$defs` inherits
 * from `Object.prototype`: `#/$defs/constructor` resolved to the `Object`
 * constructor, whose own enumerable keys are none, so it read as a subschema
 * with no keywords and `12345` validated as VALID against a reference that
 * resolves to nothing. That is the silent under-validation this module exists
 * to refuse, reached through the prototype chain rather than through a keyword.
 * @param {string} ref - The `$ref` string
 * @param {object} root - Root schema document
 * @returns {object} The referenced subschema
 * @throws {Error} When the reference is not a supported local $defs pointer
 */
function resolveRef(ref, root) {
  const match = /^#\/\$defs\/([^/]+)$/u.exec(ref);
  const defs = isSchemaObject(root.$defs) ? root.$defs : {};
  const target =
    match && Object.hasOwn(defs, match[1]) ? defs[match[1]] : undefined;
  if (!isSchemaObject(target)) {
    throw new Error(
      `unsupported or unresolvable $ref "${ref}" (only #/$defs/<name> resolving to a subschema object is supported)`
    );
  }
  return target;
}

/**
 * Refuse any keyword this validator does not implement, in name or in form.
 * @param {object} schema - Subschema to inspect
 * @param {string} instancePath - JSON-pointer-ish path for messages
 * @returns {void}
 * @throws {Error} When the subschema uses an unimplemented keyword or form
 */
function assertSupportedKeywords(schema, instancePath) {
  const where = instancePath || "/";
  for (const keyword of Object.keys(schema)) {
    if (ANNOTATION_KEYWORDS.has(keyword)) {
      continue;
    }
    // `Object.hasOwn`, not a truthiness test on a plain read. `KEYWORD_FORMS`
    // is an object literal, so it inherits from `Object.prototype`: a keyword
    // named `constructor`, `valueOf`, `toString` or `hasOwnProperty` returned a
    // truthy prototype member, the guard below never fired, and the next line
    // reported `expected.accepts is not a function` — an internal binding named
    // at an operator about a schema they wrote. An entry's ABSENCE and an entry
    // holding a falsy value are different things, and the prototype chain is
    // not a source of schema policy.
    if (!Object.hasOwn(KEYWORD_FORMS, keyword)) {
      throw new Error(
        `schema at ${where} uses unsupported keyword "${keyword}"`
      );
    }
    const expected = KEYWORD_FORMS[keyword];
    if (!expected.accepts(schema[keyword])) {
      throw new Error(
        `schema at ${where} writes "${keyword}" in an unimplemented form; expected ${expected.form}`
      );
    }
  }
  assertNoRefSiblings(schema, where);
}

/**
 * Refuse a `$ref` that carries validating siblings.
 *
 * `validateNode` validates against the resolved target and returns, discarding
 * every sibling keyword — so `{"$ref": ..., "enum": [...]}` applied the target
 * and dropped the enum, reporting a violating value as valid. In JSON Schema
 * 2020-12 siblings ARE applied, so ignoring them is a spec deviation on top of
 * a silent under-validation.
 *
 * Annotation-only siblings are fine and common: `{"$ref": ..., "description":
 * ...}` carries no validation semantics, and refusing it would be a false
 * positive on ordinary schemas.
 * @param {object} schema - Subschema to inspect
 * @param {string} where - Location for the message
 * @returns {void}
 * @throws {Error} When a validating keyword sits beside a `$ref`
 */
function assertNoRefSiblings(schema, where) {
  if (!Object.hasOwn(schema, "$ref")) {
    return;
  }
  const siblings = Object.keys(schema).filter(
    keyword => keyword !== "$ref" && !ANNOTATION_KEYWORDS.has(keyword)
  );
  if (siblings.length > 0) {
    throw new Error(
      `schema at ${where} places validating keyword(s) ${siblings.map(entry => `"${entry}"`).join(", ")} beside a "$ref"; $ref siblings are not implemented`
    );
  }
}

/**
 * Whether one declared type name accepts an observed JSON type.
 * @param {string} declared - A JSON Schema type name
 * @param {string} actualType - The observed type
 * @returns {boolean} Whether it matches
 */
function typeAccepts(declared, actualType) {
  return (
    declared === actualType ||
    (declared === "number" && actualType === "integer")
  );
}

/**
 * The `type` mismatch message, or null when the value's type is acceptable.
 *
 * BOTH declared forms are handled. `type` may be a single name or an ARRAY of
 * names (`["string", "null"]`), and the array form previously fell through the
 * `typeof === "string"` test entirely: the keyword passed the allowlist, so the
 * module's central promise — an unimplemented keyword is an error, never a
 * silent pass — was broken for the one form nobody checked.
 *
 * Any THIRD form is refused before this function is reached: `KEYWORD_FORMS`
 * declares what `type` may be written as and `assertSupportedKeywords` runs
 * first, so the two branches below are the only two that exist. Repeating the
 * check here would be unreachable code claiming to be a guard.
 * @param {object} schema - Subschema to apply
 * @param {string} actualType - The observed type
 * @param {string} where - Location for the message
 * @returns {string|null} The error, or null
 */
function typeError(schema, actualType, where) {
  const declared = schema.type;
  if (typeof declared === "string") {
    return typeAccepts(declared, actualType)
      ? null
      : `${where}: expected type ${declared}, got ${actualType}`;
  }
  if (declared === undefined) return null;
  return declared.some(entry => typeAccepts(entry, actualType))
    ? null
    : `${where}: expected type ${declared.join(" or ")}, got ${actualType}`;
}

/**
 * Apply the value-level keywords: `const`, `enum`, and the string and number
 * constraints.
 * @param {unknown} value - Value under validation
 * @param {object} schema - Subschema to apply
 * @param {string} where - Location for messages
 * @param {string[]} errors - Accumulator, mutated in place
 * @returns {void}
 */
function checkValueKeywords(value, schema, where, errors) {
  if ("const" in schema && value !== schema.const) {
    errors.push(
      `${where}: expected constant ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`
    );
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(
      `${where}: ${JSON.stringify(value)} is not one of ${schema.enum.map(entry => JSON.stringify(entry)).join(", ")}`
    );
  }
  if (typeof value === "string") {
    if (
      typeof schema.minLength === "number" &&
      value.length < schema.minLength
    ) {
      errors.push(`${where}: shorter than minLength ${schema.minLength}`);
    }
    if (
      typeof schema.pattern === "string" &&
      !new RegExp(schema.pattern, "u").test(value)
    ) {
      errors.push(`${where}: does not match pattern ${schema.pattern}`);
    }
  }
  if (
    typeof value === "number" &&
    typeof schema.minimum === "number" &&
    value < schema.minimum
  ) {
    errors.push(`${where}: below minimum ${schema.minimum}`);
  }
}

/**
 * Apply the object-level keywords: `required`, `properties`, and
 * `additionalProperties`.
 *
 * Every membership test here is `Object.hasOwn`, never `in`. `in` walks
 * `Object.prototype`, and all three tests below asked an own-property question:
 * `required: ["toString"]` against `{}` reported VALID, `properties:
 * {toString: …}` against `{}` validated the inherited function and reported a
 * type error about a property the document does not have, and a document key
 * named `toString` slipped past `additionalProperties: false` as though the
 * schema had declared it.
 * @param {object} value - Object under validation
 * @param {object} schema - Subschema to apply
 * @param {object} root - Root schema document (for `$ref` resolution)
 * @param {string} instancePath - JSON-pointer-ish path for messages
 * @param {string[]} errors - Accumulator, mutated in place
 * @returns {void}
 */
function checkObjectKeywords(value, schema, root, instancePath, errors) {
  const where = instancePath || "(root)";
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(value, key)) {
      errors.push(`${where}: missing required property "${key}"`);
    }
  }
  const properties = schema.properties ?? {};
  for (const [key, subschema] of Object.entries(properties)) {
    if (Object.hasOwn(value, key)) {
      validateNode(
        value[key],
        subschema,
        root,
        `${instancePath}.${key}`,
        errors
      );
    }
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) {
        errors.push(`${where}: unexpected property "${key}"`);
      }
    }
  }
}

/**
 * Validate one value against one subschema, appending human-readable errors.
 * @param {unknown} value - Value under validation
 * @param {object} schema - Subschema to apply
 * @param {object} root - Root schema document (for `$ref` resolution)
 * @param {string} instancePath - JSON-pointer-ish path for messages
 * @param {string[]} errors - Accumulator, mutated in place
 * @returns {void}
 */
function validateNode(value, schema, root, instancePath, errors) {
  assertSupportedKeywords(schema, instancePath);

  if (Object.hasOwn(schema, "$ref") && typeof schema.$ref === "string") {
    validateNode(
      value,
      resolveRef(schema.$ref, root),
      root,
      instancePath,
      errors
    );
    return;
  }

  const where = instancePath || "(root)";
  const actualType = jsonTypeOf(value);
  const mismatch = typeError(schema, actualType, where);
  if (mismatch) {
    errors.push(mismatch);
    return;
  }

  checkValueKeywords(value, schema, where, errors);

  if (actualType === "array" && schema.items) {
    value.forEach((entry, index) => {
      validateNode(entry, schema.items, root, `${where}[${index}]`, errors);
    });
  }

  if (actualType === "object") {
    checkObjectKeywords(value, schema, root, instancePath, errors);
  }
}

/**
 * Validate a document against a schema.
 * @param {unknown} document - The value to validate
 * @param {object} schema - The schema document
 * @returns {{ valid: boolean, errors: string[] }} Validation outcome
 */
export function validateAgainstSchema(document, schema) {
  const errors = [];
  try {
    validateNode(document, schema, schema, "", errors);
  } catch (error) {
    return { valid: false, errors: [`schema error: ${error.message}`] };
  }
  return { valid: errors.length === 0, errors };
}
