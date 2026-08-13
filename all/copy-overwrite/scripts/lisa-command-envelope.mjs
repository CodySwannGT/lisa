#!/usr/bin/env node
/**
 * lisa-command-envelope — the standard result every capability adapter returns.
 *
 * Governed by the `reset-seed-coverage` rule. One validated JSON object on
 * stdout, human narration on stderr, and an exit code that means exactly one
 * thing: **0 = the operation completed AND verified**. Every other outcome is
 * nonzero and says which in `status`.
 *
 * The point of the envelope is that "every repo answers the same interface the
 * same way" becomes checkable. In particular a declared noop is machine-readable
 * (`mode: "declared-noop"` plus reason, owner and capability-manifest
 * reference) — a bare `exit 0` with no output is indistinguishable from a
 * successful destructive run and is never an acceptable answer.
 *
 * CLI:
 *   node scripts/lisa-command-envelope.mjs --print-schema
 *   node scripts/lisa-command-envelope.mjs --validate <file>   # "-" reads stdin
 * @module scripts/lisa-command-envelope
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateAgainstSchema } from "./lisa-schema-validate.mjs";

/** Pinned envelope schema version. */
export const COMMAND_ENVELOPE_SCHEMA_VERSION = "lisa-command-envelope-v1";

const SCHEMA_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "schemas",
  "lisa-command-envelope.v1.schema.json"
);

/**
 * Read the shipped schema document, or explain why it could not be read.
 *
 * A throw at module scope happens before any handler runs, so an adopter with a
 * partially-copied `scripts/` directory got a raw ENOENT stack from an import
 * they never made directly — and any caller that merely wanted to VALIDATE
 * something died on load. Reading it into a nullable value instead turns that
 * into a first-class, fail-closed validation error with the missing path named
 * in it.
 * @returns {{schema: object|null, error: string|null}} The schema or the reason.
 */
function readSchemaDocument() {
  try {
    return {
      schema: JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8")),
      error: null,
    };
  } catch (error) {
    return {
      schema: null,
      error: `the published envelope schema is not readable at ${SCHEMA_PATH} (${error.message}); scripts/schemas/ must be copied alongside scripts/`,
    };
  }
}

const SCHEMA_DOCUMENT = readSchemaDocument();

/**
 * The published envelope schema, read from the shipped JSON document.
 *
 * `null` when the document is missing — see {@link readSchemaDocument}. Every
 * consumer must treat that as a validation FAILURE, never as "no schema to
 * check against".
 */
export const COMMAND_ENVELOPE_SCHEMA = SCHEMA_DOCUMENT.schema;

/**
 * Statuses that may exit 0.
 *
 * `detection-only` is deliberately NOT here: it means the adapter could not
 * observe authoritative state, so its findings are non-authoritative, and exit
 * 0 must never mean "I could not look."
 */
export const SUCCESS_STATUSES = Object.freeze([
  "completed",
  "no-op",
  "not-adopted",
]);

/**
 * Exit code implied by a status.
 * @param {string} status - Envelope status
 * @returns {number} 0 when the operation completed and verified, else 1
 */
export function exitCodeForStatus(status) {
  return SUCCESS_STATUSES.includes(status) ? 0 : 1;
}

/**
 * Validate an envelope against the published schema, plus the conditional
 * requirements the schema alone cannot express.
 * @param {unknown} envelope - Candidate envelope
 * @returns {{ valid: boolean, errors: string[] }} Validation outcome
 */
export function validateEnvelope(envelope) {
  if (!COMMAND_ENVELOPE_SCHEMA) {
    return { valid: false, errors: [SCHEMA_DOCUMENT.error] };
  }
  const base = validateAgainstSchema(envelope, COMMAND_ENVELOPE_SCHEMA);
  if (!base.valid) {
    return base;
  }
  const errors = [];
  const declarative =
    envelope.mode === "declared-noop" || envelope.mode === "not-applicable";
  if (declarative) {
    for (const field of ["reason", "owner", "capabilityManifest"]) {
      if (!envelope[field]) {
        errors.push(
          `mode "${envelope.mode}" requires "${field}" — a bare success is indistinguishable from a real run`
        );
      }
    }
  }
  if (!SUCCESS_STATUSES.includes(envelope.status) && !envelope.reason) {
    errors.push(`status "${envelope.status}" requires "reason"`);
  }
  if (envelope.mode === "declared-noop" && envelope.status !== "no-op") {
    errors.push('mode "declared-noop" requires status "no-op"');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Build a validated envelope, filling in the invariant fields.
 * @param {object} fields - Envelope fields (see the published schema)
 * @returns {object} A frozen, validated envelope
 * @throws {Error} When the resulting envelope is invalid
 */
export function buildEnvelope(fields) {
  const { summary = {}, ...rest } = fields;
  const envelope = {
    schemaVersion: COMMAND_ENVELOPE_SCHEMA_VERSION,
    dryRun: false,
    ...rest,
    summary: { deleted: 0, created: 0, preserved: 0, ...summary },
  };
  const { valid, errors } = validateEnvelope(envelope);
  if (!valid) {
    throw new Error(`invalid command envelope: ${errors.join("; ")}`);
  }
  return Object.freeze(envelope);
}

/**
 * Redact obvious secrets and personal data from a line bound for stderr.
 *
 * Best-effort by design: it is the last line of defence, not a substitute for
 * not logging the value. Adapters must not put credentials in their narration.
 * @param {string} text - Human-readable narration
 * @returns {string} The same text with likely secrets and PII masked
 */
export function redact(text) {
  return String(text)
    .replace(
      /\b[\w.%+-]+@[\w-]+\.[A-Za-z]{2,}\b/gu,
      match => `${match.slice(0, 2)}***@***`
    )
    .replace(
      /((?:password|passwd|secret|token|api[-_]?key|authorization|bearer)["'\s:=]+)\S+/giu,
      "$1***"
    )
    .replace(/\b(?:\d[ -]?){12,19}\b/gu, "***")
    .replace(/\b\+?\d{10,15}\b/gu, "***");
}

/**
 * Write the envelope to stdout as the process's single machine-readable result.
 * @param {object} envelope - A built envelope
 * @param {{ stdout?: { write: (chunk: string) => unknown } }} [io] - Injectable stream
 * @returns {number} The exit code implied by the envelope's status
 */
export function emitEnvelope(envelope, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  stdout.write(`${JSON.stringify(envelope)}\n`);
  return exitCodeForStatus(envelope.status);
}

/**
 * CLI entry point.
 * @param {string[]} argv - Arguments after the script name
 * @returns {number} Process exit code
 */
export function main(argv) {
  if (argv.includes("--print-schema")) {
    if (!COMMAND_ENVELOPE_SCHEMA) {
      process.stderr.write(
        `[command-envelope] FAIL: ${SCHEMA_DOCUMENT.error}\n`
      );
      return 1;
    }
    process.stdout.write(
      `${JSON.stringify(COMMAND_ENVELOPE_SCHEMA, null, 2)}\n`
    );
    return 0;
  }
  const index = argv.indexOf("--validate");
  if (index === -1) {
    process.stderr.write(
      "usage: lisa-command-envelope.mjs [--print-schema] [--validate <file|->]\n"
    );
    return 1;
  }
  const source = argv[index + 1] ?? "-";
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(source === "-" ? 0 : source, "utf8"));
  } catch (error) {
    process.stderr.write(`[command-envelope] FAIL: ${redact(error.message)}\n`);
    return 1;
  }
  const { valid, errors } = validateEnvelope(parsed);
  if (!valid) {
    process.stderr.write(
      `[command-envelope] FAIL:\n${errors.map(entry => `  - ${entry}`).join("\n")}\n`
    );
    return 1;
  }
  process.stderr.write("[command-envelope] OK\n");
  return 0;
}

// Run only when invoked directly — importing for tests must have no side effects.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
