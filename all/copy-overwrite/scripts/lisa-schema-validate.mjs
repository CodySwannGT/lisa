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
 * Supported: `type` (a single name or an array of names), `const`, `enum`,
 * `required`, `properties`,
 * `additionalProperties` (boolean), `items`, `minLength`, `minimum`, `pattern`,
 * `$ref` (local `#/$defs/<name>` only), `$defs`, plus the annotation-only
 * keywords `$schema`, `$id`, `title`, `description`.
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

/** Keywords this validator implements. Anything else is an error. */
const SUPPORTED_KEYWORDS = new Set([
  "type",
  "const",
  "enum",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "minLength",
  "minimum",
  "pattern",
  "$ref",
]);

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
 * @param {string} ref - The `$ref` string
 * @param {object} root - Root schema document
 * @returns {object} The referenced subschema
 * @throws {Error} When the reference is not a supported local $defs pointer
 */
function resolveRef(ref, root) {
  const match = /^#\/\$defs\/([^/]+)$/u.exec(ref);
  const target = match ? root.$defs?.[match[1]] : undefined;
  if (!target) {
    throw new Error(
      `unsupported or unresolvable $ref "${ref}" (only #/$defs/<name> is supported)`
    );
  }
  return target;
}

/**
 * Refuse any keyword this validator does not implement.
 * @param {object} schema - Subschema to inspect
 * @param {string} instancePath - JSON-pointer-ish path for messages
 * @returns {void}
 * @throws {Error} When the subschema uses an unimplemented keyword
 */
function assertSupportedKeywords(schema, instancePath) {
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(keyword) && !ANNOTATION_KEYWORDS.has(keyword)) {
      throw new Error(
        `schema at ${instancePath || "/"} uses unsupported keyword "${keyword}"`
      );
    }
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
  if (
    !Array.isArray(declared) ||
    declared.length === 0 ||
    !declared.every(entry => typeof entry === "string")
  ) {
    throw new Error(
      `schema at ${where} declares a "type" that is neither a name nor an array of names`
    );
  }
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
    if (!(key in value)) {
      errors.push(`${where}: missing required property "${key}"`);
    }
  }
  const properties = schema.properties ?? {};
  for (const [key, subschema] of Object.entries(properties)) {
    if (key in value) {
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
      if (!(key in properties)) {
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

  if (typeof schema.$ref === "string") {
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
