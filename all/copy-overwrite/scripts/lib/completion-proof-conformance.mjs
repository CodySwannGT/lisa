// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

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

/** Match the original multiline Scenario grammar with one forward scan. */
function scenarioNames(text) {
  const names = [];
  const lineBreak = character => /[\r\n\u2028\u2029]/.test(character);
  let index = 0;
  while (index < text.length) {
    while (/\s/.test(text[index] ?? "")) index += 1;
    const prefix = text.startsWith("Scenario Outline:", index)
      ? "Scenario Outline:"
      : "Scenario:";
    if (text.startsWith(prefix, index)) {
      const first = index + prefix.length;
      let title = first;
      while (/\s/.test(text[title] ?? "")) title += 1;
      if (title === text.length) {
        title -= 1;
        while (title >= first && lineBreak(text[title])) title -= 1;
      }
      if (title >= first && title < text.length) {
        let end = title;
        while (end < text.length && !lineBreak(text[end])) end += 1;
        names.push(text.slice(title, end).trim());
        index = end;
        continue;
      }
    }
    while (index < text.length && !lineBreak(text[index])) index += 1;
    index += 1;
  }
  return names;
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
  const scenarios = scenarioNames(section(subject.body, "Acceptance Criteria"));
  requireProof(
    Array.isArray(report.scenario_names) &&
      new Set(report.scenario_names).size === report.scenario_names.length &&
      scenarios.every(name => report.scenario_names.includes(name)),
    "The attached conformance report omits a primary acceptance scenario."
  );
}
