// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Conform the BDD gate's result to Lisa's standard command envelope.
 *
 * The envelope contract is owned by `scripts/lisa-command-envelope.mjs` and
 * its published schema; this module only maps the gate's vocabulary onto it.
 * Inventing a second result shape is exactly what the envelope exists to
 * prevent, so the envelope is BUILT BY that module whenever it is present —
 * which also means its validator, not this file, decides conformance.
 *
 * @module scripts/bdd/envelope
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Where the shared envelope module can legitimately live, as SOURCE
 * CONSTANTS — an allowlist, never a search of whatever happens to be nearby.
 *
 * First entry is the adopter layout (`all/copy-overwrite/scripts/` and
 * `expo/copy-overwrite/scripts/` both land in the project's `scripts/`).
 * Second is Lisa's own tree, where the two live in different template
 * directories and this file is exercised by Lisa's tests.
 */
const ENVELOPE_MODULE_PATHS = Object.freeze([
  "./lisa-command-envelope.mjs",
  "../../../all/copy-overwrite/scripts/lisa-command-envelope.mjs",
]);

/**
 * Envelope statuses that may exit 0.
 *
 * Mirrors `SUCCESS_STATUSES` in the shared envelope module. It is restated
 * here because this gate must decide its exit code without waiting on a
 * dynamic import — and a unit test asserts the two lists are identical, so the
 * copy cannot drift silently.
 */
export const SUCCESS_STATUSES = Object.freeze([
  "completed",
  "no-op",
  "not-adopted",
]);

/** Message prefixes that already name the subject a finding is about. */
const SUBJECT_PREFIX = /^(?:bdd\/|coverage-map\.|BDD-[A-Z]|coverageFloor\.)/;

/** Fallback subjects by code family, so every finding names something real. */
const SUBJECT_BY_FAMILY = Object.freeze([
  ["scenario-", "bdd/features"],
  ["tracker-", "bdd/features"],
  ["execution-results", "execution results"],
  ["baseline", "base revision"],
]);

/**
 * The entity a finding is about.
 *
 * Every defect message already begins with its location, so the subject is
 * read from there rather than restated — a second copy would drift.
 * @param {{code: string, message: string, subject?: string}} item - A defect.
 * @returns {string} A non-empty subject.
 */
export function subjectFor(item) {
  if (item.subject) return item.subject;
  const head = item.message.split(/\s+/)[0] ?? "";
  if (SUBJECT_PREFIX.test(head)) return head.replace(/[:,]$/, "");
  const family = SUBJECT_BY_FAMILY.find(([prefix]) =>
    item.code.startsWith(prefix)
  );
  return family ? family[1] : "bdd/coverage-map.json";
}

/**
 * Whether any defect must fail the run.
 *
 * Every defect does. There used to be a per-code severity split — an allowlist
 * of 34 contract-quality codes that a `bootstrap` run graded `warning` and
 * exited 0 on — and the split existed only to make that grace period possible.
 * With the grace period gone the allowlist has nothing left to serve: a project
 * that does not want this property enforced declares the gate `off`, which is a
 * decision someone can read, rather than a green check that found 500 defects.
 * @param {readonly object[]} defects - Defects found.
 * @returns {boolean} True when the run must fail.
 */
export function hasFatalDefect(defects) {
  return defects.length > 0;
}

/**
 * Load the shared envelope module from the allowlisted locations.
 * @param {string} scriptDir - Directory holding this gate's scripts.
 * @returns {Promise<object|null>} The module, or null when it is not installed.
 */
export async function loadEnvelopeModule(scriptDir) {
  for (const relative of ENVELOPE_MODULE_PATHS) {
    const candidate = path.resolve(scriptDir, relative);
    if (!fs.existsSync(candidate)) continue;
    return import(pathToFileURL(candidate).href);
  }
  return null;
}

/**
 * A correlation id that is stable for an unchanged tree.
 *
 * CI supplies the run id. Off CI the id is derived from the result itself, so
 * two runs over the same tree produce byte-identical output — determinism the
 * gate's own tests assert.
 * @param {string|undefined} supplied - `BDD_CORRELATION_ID` from the environment.
 * @param {object} material - Values that identify this result.
 * @returns {string} The correlation id.
 */
export function correlationId(supplied, material) {
  if (supplied) return supplied;
  const digest = createHash("sha256")
    .update(JSON.stringify(material))
    .digest("hex")
    .slice(0, 16);
  return `bdd-local-${digest}`;
}

/**
 * The project's own contract version for the state this gate reads.
 * @param {object|null} contract - Parsed coverage map, when readable.
 * @returns {string} A non-empty contract version.
 */
export function contractVersion(contract) {
  if (!contract) return "bdd-coverage-map-unavailable";
  return `bdd-coverage-map-v${contract.schemaVersion ?? "unknown"}@${contract.asOf ?? "undated"}`;
}

/**
 * Counters describing the run.
 *
 * The five facts stay separate here exactly as they do in the report: what is
 * DECLARED, what is MAPPED (traceability), what RAN, what those runs
 * RETURNED, and what is WAIVED. A reader comparing two runs must never have
 * to infer which one a percentage refers to.
 *
 * There is no `findingsWarning` counter and no `adoptionState`. Both belonged
 * to the retired adoption axis: severity was decided by it, and the state was
 * the axis itself. A finding is a finding, and whether the property is governed
 * at all is answered by the gate declaration, one layer out.
 * @param {object} input - Report, defects, and files written.
 * @returns {object} The envelope's `summary`.
 */
export function buildSummary({ report, defects, filesWritten }) {
  const counts = {
    deleted: 0,
    created: filesWritten,
    preserved: 0,
    findings: defects.length,
  };
  if (!report) return counts;
  return {
    ...counts,
    scenariosDeclared: report.scenarios.declared,
    scenariosRequired: report.scenarios.required,
    scenariosExcluded: report.scenarios.excluded,
    traceabilityCovered: report.traceability.overall.covered,
    traceabilityTotal: report.traceability.overall.total,
    traceabilityPercentage: report.traceability.overall.percentage,
    executionEvidenceSupplied: report.execution.supplied,
    mappedTests: report.execution.mappedTests,
    testsDiscovered: report.testInventory.discovered,
    testsUndisclosed: report.testInventory.undisclosed.length,
    ...executionCounts(report.execution),
    waivedObligations: report.waived.count,
    floorOk: report.floor.ok,
  };
}

/**
 * Execution counters, present only when run evidence was supplied.
 *
 * Absent evidence emits NO counters rather than zeros: a zero here reads as
 * "nothing passed", which is a different claim from "nobody told me".
 * @param {object} execution - The report's execution block.
 * @returns {object} Execution counters, or an empty object.
 */
function executionCounts(execution) {
  if (!execution.supplied) return {};
  return {
    executed: execution.executed,
    passed: execution.passed,
    failed: execution.failed,
    skipped: execution.skipped,
    notRun: execution.notRun,
  };
}
