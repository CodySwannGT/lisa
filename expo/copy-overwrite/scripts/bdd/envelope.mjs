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
 * Defect codes bootstrap is PERMITTED to downgrade to a warning.
 *
 * This is an allowlist and it is load-bearing: an unrecognized code — a new
 * check, a typo, a future contributor's addition — is treated as FATAL. A
 * denylist of "fatal codes" would fail OPEN on exactly the value nobody
 * anticipated, which is how a gate quietly stops gating.
 *
 * Everything here is a contract-QUALITY defect: the manifest is legible and
 * the adoption state is coherent, the contract just is not clean yet. Codes
 * about adoption integrity itself (bootstrap-metadata, bootstrap-expired,
 * adoption-drift, config-*) are deliberately absent, so they always fail.
 */
export const WARNABLE_DEFECT_CODES = Object.freeze([
  "baseline",
  "empty-contract",
  "execution-results",
  "floor-missing",
  "floor-ratchet",
  "floor-regression",
  "mapping-duplicate",
  "mapping-evidence",
  "mapping-file",
  "mapping-orphan",
  "mapping-platform",
  "mapping-runner",
  "scenario-deleted",
  "scenario-duplicate-id",
  "scenario-id",
  "scenario-lifecycle",
  "scenario-platform",
  "scenario-provenance",
  "scenario-steps",
  "tracker-missing",
  "tracker-orphan",
  "waiver-duplicate",
  "waiver-excluded",
  "waiver-expired",
  "waiver-masks-mapping",
  "waiver-metadata",
  "waiver-orphan",
  "waiver-platform",
  "waiver-runner",
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
 * Whether any defect must fail the run, given the adoption state.
 *
 * `enforced` fails on any defect at all. `bootstrap` fails on any defect
 * whose code is NOT on the warnable allowlist. `not-adopted` reaches here
 * only with adoption-integrity defects, which are never warnable.
 * @param {string} adoptionState - not-adopted | bootstrap | enforced.
 * @param {readonly object[]} defects - Defects found.
 * @returns {boolean} True when the run must fail.
 */
export function hasFatalDefect(adoptionState, defects) {
  if (defects.length === 0) return false;
  if (adoptionState === "enforced") return true;
  return defects.some(item => !WARNABLE_DEFECT_CODES.includes(item.code));
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
 * Counters describing the run, plus the adoption state the counts belong to.
 *
 * The five facts stay separate here exactly as they do in the report: what is
 * DECLARED, what is MAPPED (traceability), what RAN, what those runs
 * RETURNED, and what is WAIVED. A reader comparing two runs must never have
 * to infer which one a percentage refers to.
 * @param {object} input - Adoption state, report, defects, and files written.
 * @returns {object} The envelope's `summary`.
 */
export function buildSummary({ adoptionState, report, defects, filesWritten }) {
  const counts = {
    deleted: 0,
    created: filesWritten,
    preserved: 0,
    adoptionState,
    findingsError: defects.filter(item => item.severity === "error").length,
    findingsWarning: defects.filter(item => item.severity === "warning").length,
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
