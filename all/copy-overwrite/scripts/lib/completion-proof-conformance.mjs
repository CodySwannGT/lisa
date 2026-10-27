/** The accepted conformance map is itself a hash-pinned native attachment. */
import {
  requireProof,
  isId,
  isDigest,
  isObject,
  isText,
  MAX_RECORD_BYTES,
  sha256,
  section,
} from "./completion-proof-shape.mjs";

/** Compare exact required conjunctions without depending on display order. */
function groups(values) {
  requireProof(
    Array.isArray(values),
    "The attached conformance requirement map is unreadable."
  );
  requireProof(
    values.every(
      row =>
        isObject(row) &&
        isText(row.requirement_id) &&
        Array.isArray(row.claim_ids)
    ),
    "The attached conformance map contains malformed requirement rows."
  );
  return values
    .map(row => ({
      requirement_id: row.requirement_id,
      operator: row.operator,
      claim_ids: [...(row.claim_ids ?? [])].sort(),
    }))
    .sort((left, right) =>
      left.requirement_id.localeCompare(right.requirement_id)
    );
}

/** CONFORMS text alone cannot replace the current complete coverage report. */
export function validateConformance(record, context, subject, transport) {
  const pointer = record.obligations.conformance.report;
  requireProof(
    isId(pointer?.asset_id) &&
      isDigest(pointer.sha256) &&
      Number.isSafeInteger(pointer.bytes),
    "The required CONFORMS report has no immutable native attachment."
  );
  const asset = transport.asset(pointer.asset_id, MAX_RECORD_BYTES);
  requireProof(
    asset.bytes.length === pointer.bytes &&
      sha256(asset.bytes) === pointer.sha256,
    "The CONFORMS report does not match its accepted bytes."
  );
  let report;
  try {
    report = JSON.parse(asset.bytes.toString("utf8"));
  } catch {
    requireProof(false, "The CONFORMS report is not readable structured JSON.");
  }
  requireProof(
    isObject(report) &&
      report.verdict === "CONFORMS" &&
      report.spec_sha256 === record.spec_sha256 &&
      report.work_item === context.ref &&
      Array.isArray(report.requirements) &&
      report.requirements.every(
        row => isObject(row) && row.status === "pass"
      ) &&
      JSON.stringify(groups(report.requirements)) ===
        JSON.stringify(groups(record.requirements)),
    "The attached CONFORMS report does not establish the exact current requirement conjunctions."
  );
  const scenarios = [
    ...section(subject.body, "Acceptance Criteria").matchAll(
      /^\s*Scenario(?: Outline)?:\s*(.+)$/gm
    ),
  ].map(match => match[1].trim());
  requireProof(
    Array.isArray(report.scenario_names) &&
      new Set(report.scenario_names).size === report.scenario_names.length &&
      scenarios.every(name => report.scenario_names.includes(name)),
    "The attached conformance report omits a primary acceptance scenario."
  );
}
