#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * check-state-classification — the anti-drift half of the `reset-seed-coverage`
 * rule.
 *
 * The failure this exists to produce: a work item adds a persistent entity, a
 * suite creates records in it, nothing sweeps them, nothing complains, and the
 * leak surfaces months later as an unreproducible flake. This check compares
 * what the running system actually holds (the **inventory**) against what the
 * repository has decided about (the **state contract**) and **fails closed on
 * any entity nobody classified**.
 *
 * It is deliberately NOT "new entities are cleared by default". That model
 * erases unrelated non-production data the first time a change adds an entity,
 * and a migrations-directory diff cannot model renames, multiple schemas,
 * framework-generated entities, views, partitions, row-level ownership, or any
 * state that is not a row. Subtraction survives here as a *detector*: it tells
 * you the contract is stale, it never decides what may be deleted.
 *
 * Usage:
 *   node scripts/check-state-classification.mjs
 *   node scripts/check-state-classification.mjs --inventory state/inventory.json
 *   node scripts/check-state-classification.mjs --contract state/state-contract.json
 *
 * Env:
 *   STATE_CONTRACT_FILE   override the contract path
 *   STATE_INVENTORY_FILE  override the inventory path
 *   STATE_ROOT            project root to scan (default: cwd)
 *
 * Exit 0 = every entity in the inventory is classified and every policy
 *          obligation is met (status `completed`), the repo has not adopted the
 *          contract yet (`not-adopted`), or the repo's declared noop verified
 *          (`no-op`).
 * Exit 1 = anything else, including "no inventory available" — exit 0 must
 *          never mean "I could not look".
 * @module scripts/check-state-classification
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import {
  buildEnvelope,
  emitEnvelope,
  redact,
} from "./lisa-command-envelope.mjs";
import { validateAgainstSchema } from "./lisa-schema-validate.mjs";

const SCHEMA_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "schemas",
  "lisa-state-contract.v1.schema.json"
);

/** The published state-contract schema, read from the shipped JSON document. */
export const STATE_CONTRACT_SCHEMA = JSON.parse(
  fs.readFileSync(SCHEMA_PATH, "utf8")
);

/** Default contract location; a project may relocate it and record that in .lisa.config.json. */
export const DEFAULT_CONTRACT_PATH = "state/state-contract.json";

/** Default inventory location, produced by the project's `state:inventory` adapter. */
export const DEFAULT_INVENTORY_PATH = "state/inventory.json";

/**
 * Assurances every real contract must declare with evidence.
 * @see reset-seed-coverage rule — "Required assurances"
 */
export const REQUIRED_ASSURANCES = Object.freeze([
  "preserves-non-fixture-data",
  "rejects-reserved-id-collision",
  "rejects-foreign-references",
  "requires-write-acknowledgment",
  "converges-on-second-apply",
  "verifies-exact-counts",
  "production-fails-closed",
  "guard-at-the-choke-point",
  "enumerates-before-mutating",
]);

/** Directory names never worth scanning for persistence signals. */
const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".expo",
  "vendor",
  "target",
  "tmp",
]);

/**
 * Repository shapes that mean "this project holds persistent state".
 *
 * Used ONLY to reject an unfounded `declared-noop` — a repo with persistence
 * may not declare that reset does not apply to it. Deliberately broad and
 * deliberately not authoritative for anything else.
 */
const PERSISTENCE_SIGNALS = Object.freeze([
  { kind: "sql", pattern: /\.sql$/iu },
  { kind: "migration", pattern: /(^|\/)migrations?(\/|$)/iu },
  { kind: "prisma-schema", pattern: /(^|\/)schema\.prisma$/iu },
  { kind: "orm-entity", pattern: /\.entity\.[cm]?[jt]s$/iu },
  { kind: "orm-model", pattern: /(^|\/)models?\/[^/]+\.[cm]?[jt]s$/iu },
  { kind: "schema-definition", pattern: /(^|\/)db\/schema\.[cm]?[jt]s$/iu },
]);

// The `CREATE TABLE` grammar, one clause per name. Written as fragments rather
// than one literal because the literal was unreadable — the alternations are
// SQL's, and loosening any of them into a wildcard would make the subtraction
// detector match statements that are not entity declarations.
/** `CREATE [UNLOGGED|TEMPORARY|TEMP|GLOBAL|LOCAL] ...` modifier run. */
const CREATE_MODIFIERS =
  "(?:unlogged\\s+|temporary\\s+|temp\\s+|global\\s+|local\\s+)*";
/** The object kinds that declare durable state. */
const CREATE_OBJECT_KIND = "(?:materialized\\s+view|table|view)";
/** Optional `IF NOT EXISTS` guard. */
const OPTIONAL_IF_NOT_EXISTS = "(?:if\\s+not\\s+exists\\s+)?";
/** A possibly schema-qualified, possibly quoted identifier. */
const ENTITY_NAME = '([\\w."`[\\]]+)';

/** `CREATE TABLE`-shaped declarations the subtraction detector recognizes. */
const CREATE_ENTITY_PATTERN = new RegExp(
  `create\\s+${CREATE_MODIFIERS}${CREATE_OBJECT_KIND}\\s+${OPTIONAL_IF_NOT_EXISTS}${ENTITY_NAME}`,
  "giu"
);

/**
 * Read a JSON file, returning a discriminated result rather than throwing.
 * @param {string} file - Absolute path
 * @returns {{ ok: true, value: unknown } | { ok: false, missing: boolean, error: string }} Result
 */
export function readJsonFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    return {
      ok: false,
      missing: error.code === "ENOENT",
      error: `cannot read ${file}: ${error.message}`,
    };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return {
      ok: false,
      missing: false,
      error: `${file} is not valid JSON: ${error.message}`,
    };
  }
}

/**
 * Walk a directory tree, yielding repository-relative file paths.
 * @param {string} root - Directory to walk
 * @param {string} [prefix] - Accumulated relative prefix
 * @returns {string[]} Relative paths, POSIX-separated
 */
export function listFiles(root, prefix = "") {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, prefix), { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) {
        continue;
      }
      files.push(...listFiles(root, `${prefix}${entry.name}/`));
    } else if (entry.isFile()) {
      files.push(`${prefix}${entry.name}`);
    }
  }
  return files;
}

/**
 * Find repository shapes indicating this project persists state.
 * @param {string} root - Project root
 * @returns {{ kind: string, file: string }[]} Signals found (possibly empty)
 */
export function detectPersistenceSignals(root) {
  const signals = [];
  for (const file of listFiles(root)) {
    for (const signal of PERSISTENCE_SIGNALS) {
      if (signal.pattern.test(file)) {
        signals.push({ kind: signal.kind, file });
        break;
      }
    }
  }
  return signals;
}

/**
 * Normalize an entity name for comparison: strip quoting and any namespace.
 * @param {string} name - Raw entity name
 * @returns {string} Lowercased bare name
 */
export function bareName(name) {
  const cleaned = String(name).replace(/["`[\]]/gu, "");
  const segments = cleaned.split(".");
  return segments[segments.length - 1].toLowerCase();
}

/**
 * Subtraction detector: entity names declared by checked-in schema sources.
 *
 * A staleness signal only. Anything it finds that the inventory did not return
 * means the inventory is incomplete, which invalidates every other conclusion.
 * @param {string} root - Project root
 * @param {string[]} [extraSources] - Additional relative paths to scan
 * @returns {Map<string, string>} bare entity name → the file that declared it
 */
export function detectDeclaredEntities(root, extraSources = []) {
  const declared = new Map();
  const candidates = listFiles(root)
    .filter(file => /\.sql$/iu.test(file))
    .concat(extraSources);
  for (const file of candidates) {
    let contents;
    try {
      contents = fs.readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    for (const match of contents.matchAll(CREATE_ENTITY_PATTERN)) {
      const name = bareName(match[1]);
      if (name && !declared.has(name)) {
        declared.set(name, file);
      }
    }
  }
  return declared;
}

/**
 * Policy-specific obligations. A classification that does not carry these is a
 * decision that cannot be acted on.
 * @param {object} entity - Contract entity entry
 * @returns {string[]} Findings messages (empty when satisfied)
 */
function policyObligationErrors(entity) {
  const errors = [];
  if (entity.policy === "fixture-owned") {
    if (!entity.ownership) {
      errors.push(
        'is "fixture-owned" without an `ownership` predicate — "everything in this entity" is not an ownership boundary'
      );
    }
    if (!entity.sweptBy) {
      errors.push(
        'is "fixture-owned" with no `sweptBy` routine — an entity the suite creates but nothing removes is exactly the leak this contract exists to catch'
      );
    }
  }
  if (entity.policy === "derived-rebuild" && !entity.rebuiltBy) {
    errors.push('is "derived-rebuild" with no `rebuiltBy` routine');
  }
  if (entity.policy === "forbidden" && !entity.enforcedBy) {
    errors.push(
      'is "forbidden" with no `enforcedBy` control outside the reset process — a script-only promise dies in the refactor that drops the safe caller'
    );
  }
  return errors;
}

/**
 * A short, non-quoting description of a rejected inventory entry.
 *
 * The VALUE is deliberately never echoed. An inventory is machine-generated
 * from a running system, and an entry that failed validation is exactly the one
 * whose contents nobody has vouched for.
 * @param {unknown} entry - The rejected entry
 * @returns {string} What it was, in one phrase
 */
function describeEntry(entry) {
  if (entry === null) return "null";
  if (Array.isArray(entry)) return "an array";
  if (typeof entry !== "object") return `a ${typeof entry}`;
  if (!("id" in entry)) return "an object with no `id`";
  if (typeof entry.id !== "string")
    return `an object whose \`id\` is ${entry.id === null ? "null" : `a ${typeof entry.id}`}`;
  return "an object whose `id` is empty";
}

/**
 * Why a parsed inventory document cannot be read, or null when it can.
 *
 * Checks the ENTRIES, not just the container. `Array.isArray(entities)` is
 * satisfied by `[null]`, and `compareInventory` then reads `item.id` and throws
 * a TypeError before any envelope is emitted — the CLI dying with a stack trace
 * is the same failure the container check was written to prevent, reached one
 * level deeper. An entry with no usable `id` is no better: it becomes a finding
 * with no subject, and the envelope builder rejects its own output. Every one
 * of those must arrive as an `invalid-inventory` finding instead.
 * @param {unknown} value - The parsed inventory document
 * @returns {string|null} An operator-readable reason, or null when well-shaped
 */
export function inventoryShapeError(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Array.isArray(value.entities)
  ) {
    return "parsed as JSON but is not an inventory: expected an object with an `entities` array. Regenerate it with the project's `state:inventory` adapter.";
  }
  const index = value.entities.findIndex(
    entry =>
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entry.id !== "string" ||
      entry.id.trim() === ""
  );
  if (index === -1) return null;
  // The index is named because an inventory is machine-generated and long —
  // "one entry is malformed" is not something an operator can act on.
  return `parsed as JSON but entities[${index}] is not an entity: expected an object with a non-empty string \`id\`, got ${describeEntry(value.entities[index])}. Regenerate it with the project's \`state:inventory\` adapter.`;
}

/**
 * Compare an inventory against a contract and produce findings.
 * @param {object} args - Comparison inputs
 * @param {object} args.contract - Parsed, schema-valid state contract
 * @param {{ entities: { id: string }[] }} args.inventory - Runtime inventory
 * @param {Map<string, string>} [args.declared] - Subtraction-detector output
 * @returns {{ status: string, findings: object[], summary: object }} Verdict
 */
export function compareInventory({
  contract,
  inventory,
  declared = new Map(),
}) {
  const findings = [];
  const entities = contract.entities ?? [];
  const classified = new Map();
  for (const entity of entities) {
    classified.set(entity.id, entity);
  }
  const waived = new Map(
    (contract.waivers ?? []).map(waiver => [waiver.id, waiver])
  );

  const inventoryIds = new Set();
  for (const item of inventory.entities ?? []) {
    inventoryIds.add(item.id);
    const entity = classified.get(item.id);
    if (entity) {
      for (const message of policyObligationErrors(entity)) {
        findings.push({
          code: "policy-obligation-unmet",
          subject: item.id,
          message,
          severity: "error",
        });
      }
      continue;
    }
    if (waived.has(item.id)) {
      findings.push({
        code: "waived-unclassified-entity",
        subject: item.id,
        message: `is waived (${waived.get(item.id).ticket}, recorded ${waived.get(item.id).recordedAt}) — treated as "preserve" and still a finding; a waiver is a dated IOU, never a classification`,
        severity: "warning",
      });
      continue;
    }
    findings.push({
      code: "unclassified-entity",
      subject: item.id,
      message:
        "exists in the running system but no policy classifies it — fail closed: an unclassified entity is neither safe to keep nor safe to delete. Classify it fixture-owned / preserve / derived-rebuild / forbidden in the state contract.",
      severity: "error",
    });
  }

  for (const entity of entities) {
    if (!inventoryIds.has(entity.id) && !entity.retiredAt) {
      findings.push({
        code: "stale-classification",
        subject: entity.id,
        message:
          "is classified but absent from the inventory — a contract describing a system that no longer exists is not protection. Set `retiredAt` or fix the id.",
        severity: "error",
      });
    }
  }

  const ignored = new Set(
    (contract.detection?.ignore ?? []).map(name => bareName(name))
  );
  const inventoryBareNames = new Set([...inventoryIds].map(id => bareName(id)));
  for (const [name, source] of declared) {
    if (ignored.has(name) || inventoryBareNames.has(name)) {
      continue;
    }
    findings.push({
      code: "inventory-incomplete",
      subject: name,
      message: `is declared by ${source} but the inventory did not return it — the inventory is incomplete, so every other conclusion here is unsound. Fix the inventory adapter (or add the name to detection.ignore if it is not a real entity).`,
      severity: "error",
    });
  }

  for (const name of REQUIRED_ASSURANCES) {
    const assurance = contract.assurances?.[name];
    if (!assurance?.evidence) {
      findings.push({
        code: "assurance-unevidenced",
        subject: name,
        message:
          "is not declared with an evidence pointer — a required property of the reset with no test, guard, role or grant behind it is a claim, not an assurance.",
        severity: "error",
      });
    }
  }

  const counts = {
    "fixture-owned": 0,
    preserve: 0,
    "derived-rebuild": 0,
    forbidden: 0,
  };
  for (const entity of entities) {
    counts[entity.policy] = (counts[entity.policy] ?? 0) + 1;
  }
  const errors = findings.filter(finding => finding.severity === "error");
  return {
    status: errors.length === 0 ? "completed" : "failed",
    findings,
    summary: {
      deleted: 0,
      created: 0,
      preserved: counts.preserve + counts.forbidden,
      classified: entities.length,
      inventoried: inventoryIds.size,
      unclassified: findings.filter(f => f.code === "unclassified-entity")
        .length,
      waived: waived.size,
      policies: counts,
    },
  };
}

/**
 * Verify a `declared-noop` against the repository instead of trusting it.
 * @param {object} contract - Parsed contract with mode declared-noop
 * @param {string} root - Project root
 * @returns {{ status: string, findings: object[] }} Verdict
 */
export function verifyDeclaredNoop(contract, root) {
  const findings = [];
  if (
    !contract.noop?.reason ||
    !contract.noop?.owner ||
    !contract.noop?.capabilityManifest
  ) {
    findings.push({
      code: "noop-underspecified",
      subject: "noop",
      message:
        "a declared noop needs a reason, an owner, and a capability-manifest reference — a bare success is indistinguishable from a successful destructive run.",
      severity: "error",
    });
  }
  const signals = detectPersistenceSignals(root);
  if (signals.length > 0) {
    findings.push({
      code: "noop-contradicted",
      subject: signals[0].file,
      message: `this repository shows ${signals.length} persistence signal(s) (first: ${signals[0].kind} at ${signals[0].file}) — a repo that persists state may not declare a reset noop.`,
      severity: "error",
    });
  }
  return {
    status: findings.length === 0 ? "no-op" : "invalid",
    findings,
  };
}

/**
 * Parse CLI arguments.
 * @param {string[]} argv - Arguments after the script name
 * @returns {{ contract?: string, inventory?: string, root?: string, correlationId?: string }} Options
 */
export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--contract") options.contract = argv[++index];
    else if (flag === "--inventory") options.inventory = argv[++index];
    else if (flag === "--root") options.root = argv[++index];
    else if (flag === "--correlation-id") options.correlationId = argv[++index];
  }
  return options;
}

/**
 * Run the check and produce the standard command envelope.
 * @param {object} [options] - Overrides for paths and correlation id
 * @returns {{ envelope: object, findings: object[] }} Result
 */
export function run(options = {}) {
  const root = path.resolve(
    options.root ?? process.env.STATE_ROOT ?? process.cwd()
  );
  const contractPath = path.resolve(
    root,
    options.contract ?? process.env.STATE_CONTRACT_FILE ?? DEFAULT_CONTRACT_PATH
  );
  const correlationId =
    options.correlationId ??
    process.env.STATE_CORRELATION_ID ??
    `state-classification-${Date.now()}`;

  /**
   * Assemble the envelope for one outcome.
   * @param {string} status - Envelope status
   * @param {object} [extra] - Additional envelope fields
   * @returns {object} Built envelope
   */
  const envelopeFor = (status, extra = {}) =>
    buildEnvelope({
      capability: "state-classification",
      mode: extra.mode ?? "real",
      operation: "compare-inventory-to-contract",
      environment: process.env.STATE_ENVIRONMENT ?? "repository",
      contractVersion: extra.contractVersion ?? "unknown",
      dryRun: true,
      status,
      correlationId,
      ...extra,
    });

  const contractRead = readJsonFile(contractPath);
  if (!contractRead.ok && contractRead.missing) {
    return {
      findings: [],
      envelope: envelopeFor("not-adopted", {
        reason: `no state contract at ${path.relative(root, contractPath)} — adoption is an explicit act, so this repo is not silently passing a gate it never wired.`,
      }),
    };
  }
  if (!contractRead.ok) {
    return {
      findings: [],
      envelope: envelopeFor("invalid", { reason: contractRead.error }),
    };
  }

  const contract = contractRead.value;
  const schemaCheck = validateAgainstSchema(contract, STATE_CONTRACT_SCHEMA);
  if (!schemaCheck.valid) {
    return {
      findings: schemaCheck.errors.map(message => ({
        code: "contract-invalid",
        subject: "state-contract",
        message,
        severity: "error",
      })),
      envelope: envelopeFor("invalid", {
        contractVersion: contract.contractVersion,
        reason:
          "the state contract does not validate against its schema — a broken contract is never read as an empty one.",
      }),
    };
  }

  if (contract.mode === "declared-noop") {
    const verdict = verifyDeclaredNoop(contract, root);
    return {
      findings: verdict.findings,
      envelope: envelopeFor(verdict.status, {
        contractVersion: contract.contractVersion,
        ...(verdict.status === "no-op"
          ? {
              mode: "declared-noop",
              reason: contract.noop.reason,
              owner: contract.noop.owner,
              capabilityManifest: contract.noop.capabilityManifest,
            }
          : {
              reason:
                "the declared noop is contradicted by the repository or is underspecified.",
            }),
        findings: verdict.findings,
      }),
    };
  }

  const inventoryPath = path.resolve(
    root,
    options.inventory ??
      process.env.STATE_INVENTORY_FILE ??
      DEFAULT_INVENTORY_PATH
  );
  const inventoryRead = readJsonFile(inventoryPath);
  if (!inventoryRead.ok) {
    const declared = detectDeclaredEntities(
      root,
      contract.detection?.sources ?? []
    );
    return {
      findings: [...declared].map(([name, source]) => ({
        code: "detected-entity",
        subject: name,
        message: `declared by ${source}; non-authoritative until a runtime inventory confirms it`,
        severity: "warning",
      })),
      envelope: envelopeFor("detection-only", {
        contractVersion: contract.contractVersion,
        reason: `no runtime inventory at ${path.relative(root, inventoryPath)} — detectors ran, but findings are non-authoritative and exit 0 must never mean "I could not look". Produce one with the project's \`state:inventory\` adapter.`,
      }),
    };
  }

  // Parsed is not the same as shaped. `readJsonFile` proves only that the bytes
  // were JSON, and `compareInventory` reads `inventory.entities` — so `null`
  // throws a TypeError on property access and the CLI dies with a stack trace
  // instead of emitting an `invalid` envelope, while an array or a string
  // silently yields zero entities and every declared entity reads as
  // unconfirmed. A wrong-shaped inventory must be reported as invalid, not
  // mistaken for an empty one. `inventoryShapeError` checks the ENTRIES too,
  // because the container check alone accepted `[null]` and left the TypeError
  // exactly where this comment says it must not be.
  const inventoryValue = inventoryRead.value;
  const shapeError = inventoryShapeError(inventoryValue);
  if (shapeError !== null) {
    return {
      findings: [
        {
          code: "invalid-inventory",
          subject: path.relative(root, inventoryPath),
          message: shapeError,
          severity: "error",
        },
      ],
      envelope: envelopeFor("invalid", {
        contractVersion: contract.contractVersion,
        reason: `runtime inventory at ${path.relative(root, inventoryPath)} parsed but has the wrong shape — an inventory that cannot be read is not an empty inventory.`,
      }),
    };
  }

  const verdict = compareInventory({
    contract,
    inventory: inventoryRead.value,
    declared: detectDeclaredEntities(root, contract.detection?.sources ?? []),
  });
  return {
    findings: verdict.findings,
    envelope: envelopeFor(verdict.status, {
      contractVersion: contract.contractVersion,
      summary: verdict.summary,
      findings: verdict.findings,
      ...(verdict.status === "completed"
        ? {}
        : {
            reason: `${verdict.findings.filter(f => f.severity === "error").length} classification finding(s) — see findings.`,
          }),
    }),
  };
}

/**
 * CLI entry point.
 * @param {string[]} argv - Arguments after the script name
 * @returns {number} Process exit code
 */
export function main(argv) {
  const { envelope, findings } = run(parseArgs(argv));
  for (const finding of findings) {
    const stream =
      finding.severity === "error" ? process.stderr : process.stdout;
    stream.write(
      redact(
        `[state-classification] ${finding.severity.toUpperCase()} ${finding.code}: ${finding.subject} ${finding.message}\n`
      )
    );
  }
  if (envelope.reason) {
    process.stderr.write(
      redact(`[state-classification] ${envelope.status}: ${envelope.reason}\n`)
    );
  }
  return emitEnvelope(envelope);
}

// Run only when invoked directly — importing for tests must have no side effects.
if (invokedAsScript(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
