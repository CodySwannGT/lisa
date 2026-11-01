// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Validate captured bytes and the canonical v2 claim/obligation conjunctions. */
import {
  BOUNDARIES,
  KINDS,
  isObject,
  isText,
  requireProof,
  localMarkers,
  section,
} from "./completion-proof-shape.mjs";
import { parseLisaUsageSection } from "./usage-ledger.mjs";
import { verifyLisaUsageSectionIntegrity } from "./usage-ledger-integrity.mjs";

/** Find captured structured records without evaluating their contents. */
function records(value, depth = 0, budget = { remaining: 100000 }) {
  if (depth > 12 || value === null || typeof value !== "object") return [];
  budget.remaining -= 1;
  requireProof(
    budget.remaining >= 0,
    "The typed capture exceeds its bounded structural inspection size."
  );
  const children = Array.isArray(value) ? value : Object.values(value);
  return [
    value,
    ...children.flatMap(child => records(child, depth + 1, budget)),
  ];
}

/** Recognize a captured process tuple, not a status-only assertion. */
function processCapture(row) {
  return (
    isObject(row) &&
    (isText(row.command) ||
      (Array.isArray(row.command) &&
        row.command.length > 0 &&
        row.command.every(isText))) &&
    typeof row.stdout === "string" &&
    typeof row.stderr === "string" &&
    Number.isInteger(row.exit_code ?? row.exitCode ?? row.exit ?? row.status)
  );
}

/** Scan count substrings once; historical failed runs are real captures too. */
function testSummary(text) {
  const lower = text.toLowerCase();
  for (let index = 0; index < lower.length; ) {
    if (
      lower.startsWith("# pass ", index) ||
      lower.startsWith("# fail ", index)
    ) {
      if (/[1-9]/.test(lower[index + 7] ?? "")) return true;
    }
    if (!/\d/.test(lower[index])) {
      index += 1;
      continue;
    }
    let nonzero = false;
    while (/\d/.test(lower[index] ?? "")) {
      nonzero ||= lower[index] !== "0";
      index += 1;
    }
    const end = index;
    while (/\s/.test(lower[index] ?? "")) index += 1;
    if (
      nonzero &&
      index > end &&
      ["passed", "passing", "failed", "failing"].some(word =>
        lower.startsWith(word, index)
      )
    )
      return true;
  }
  return false;
}

/** Positive structural checks for the actual captured artifact type. */
export function validateTypedBytes(kind, bytes, name) {
  requireProof(
    KINDS.includes(kind) && bytes.length > 0,
    `Evidence ${name} is empty or has an unknown type.`
  );
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    parsed = null;
  }
  const rows = records(parsed);
  const text = bytes.toString("utf8");
  const image =
    (bytes.length >= 45 &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.readUInt32BE(8) === 13 &&
      bytes.subarray(12, 16).toString() === "IHDR" &&
      bytes.readUInt32BE(16) > 0 &&
      bytes.readUInt32BE(20) > 0 &&
      bytes.subarray(-8, -4).toString() === "IEND") ||
    (bytes.length > 16 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes.at(-2) === 255 &&
      bytes.at(-1) === 217) ||
    (bytes.length > 20 &&
      bytes.subarray(0, 4).toString() === "RIFF" &&
      bytes.readUInt32LE(4) === bytes.length - 8 &&
      bytes.subarray(8, 12).toString() === "WEBP" &&
      ["VP8 ", "VP8L", "VP8X"].includes(bytes.subarray(12, 16).toString()));
  const checks = {
    screenshot: () => image,
    recording: () =>
      bytes.subarray(4, 8).toString() === "ftyp" ||
      bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])),
    "cli-output": () => rows.some(processCapture),
    "http-transcript": () =>
      rows.some(
        row =>
          isObject(row.request) &&
          isText(row.request.method) &&
          isText(row.request.url) &&
          isObject(row.response) &&
          Number.isInteger(row.response.status) &&
          row.response.status >= 100 &&
          row.response.status < 600 &&
          (Object.hasOwn(row.response, "body") ||
            row.response.status === 204 ||
            row.request.method.toUpperCase() === "HEAD")
      ),
    "perf-trace": () =>
      rows.some(
        row =>
          (isText(row.methodology) || isObject(row.methodology)) &&
          Array.isArray(row.measurements) &&
          row.measurements.length > 0 &&
          row.measurements.every(
            item =>
              isText(item.metric) &&
              typeof item.value === "number" &&
              Number.isFinite(item.value) &&
              isText(item.unit)
          )
      ),
    "db-query-output": () =>
      rows.some(row => isText(row.query) && Array.isArray(row.rows)),
    "state-dump": () =>
      rows.some(
        row =>
          isObject(row) &&
          ["state", "data", "response", "records"].some(key =>
            Object.hasOwn(row, key)
          ) &&
          ["id", "source", "command", "captured_at"].some(key =>
            Object.hasOwn(row, key)
          )
      ),
    "test-run-log": () =>
      testSummary(text) &&
      /(?:✓|PASS|\bok\s+\d+|testName|test_name|fullName| > )/.test(text),
    "deploy-log": () =>
      rows.some(
        row =>
          (row.status === "completed" &&
            isText(row.conclusion) &&
            (Number.isInteger(row.id) || isText(row.workflow_path))) ||
          (processCapture(row) &&
            /healthy|health|deploy|release/i.test(row.stdout))
      ),
    "log-snippet": () =>
      /\d{4}-\d\d-\d\d[T ][\d:.]+/.test(text) ||
      rows.some(
        row =>
          isText(row.source) && Array.isArray(row.lines) && row.lines.length > 0
      ),
  };
  requireProof(
    checks[kind](),
    `Evidence ${name} does not contain actual ${kind} capture structure.`
  );
}

/** v1/blocked/advisory Stop-hook results are not production authorization. */
export function validateVerdict(verdict, evidence, runtime) {
  requireProof(
    isObject(verdict) &&
      verdict.schema_version === 2 &&
      verdict.status === "pass" &&
      verdict.not_established_reviewed === true &&
      isObject(verdict.artifact) &&
      isText(verdict.artifact.head_sha) &&
      Array.isArray(verdict.claims) &&
      Array.isArray(verdict.evidence) &&
      Array.isArray(verdict.criteria),
    "The verification verdict must be an evaluable schema2 PASS with reviewed limits and criteria."
  );
  requireProof(
    verdict.criteria.length > 0 &&
      verdict.criteria.every(row => isObject(row) && row.status === "pass") &&
      verdict.claims.every(isObject) &&
      verdict.evidence.every(isObject),
    "Every applicable verification criterion must pass."
  );
  const claims = verdict.claims.filter(row => row.required_for_gate === true);
  const localEvidenceIds = new Set(
    verdict.evidence.map(row => row.evidence_id)
  );
  requireProof(
    localEvidenceIds.size === verdict.evidence.length,
    "The verdict contains duplicate evidence identities."
  );
  requireProof(
    !runtime || claims.length > 0,
    "Runtime verification has no required reaching claims."
  );
  requireProof(
    new Set(verdict.claims.map(row => row.claim_id)).size ===
      verdict.claims.length,
    "Verification claim identifiers are ambiguous."
  );
  for (const claim of claims) {
    const kinds = BOUNDARIES[claim.boundary];
    requireProof(
      isText(claim.claim_id) &&
        kinds &&
        claim.status === "established" &&
        Array.isArray(claim.required_evidence_kinds) &&
        claim.required_evidence_kinds.length > 0 &&
        claim.required_evidence_kinds.every(kind => kinds.includes(kind)) &&
        Array.isArray(claim.evidence_refs) &&
        claim.evidence_refs.length > 0 &&
        Array.isArray(claim.not_established),
      `Required claim ${claim.claim_id ?? "(unnamed)"} is missing or does not reach its boundary.`
    );
    const refs = claim.evidence_refs.map(id => evidence.get(id));
    requireProof(
      claim.evidence_refs.every(id => localEvidenceIds.has(id)) &&
        refs.every(Boolean) &&
        [undefined, "any", "all"].includes(claim.evidence_operator) &&
        (claim.evidence_operator === "all"
          ? claim.required_evidence_kinds.every(kind =>
              refs.some(row => row.kind === kind)
            )
          : refs.some(row => claim.required_evidence_kinds.includes(row.kind))),
      `Required claim ${claim.claim_id} has no attached reaching evidence.`
    );
  }
  for (const row of verdict.evidence) {
    requireProof(
      evidence.has(row.evidence_id) &&
        row.artifact_head_sha === verdict.artifact.head_sha &&
        evidence.get(row.evidence_id).sha256 === row.sha256 &&
        evidence.get(row.evidence_id).artifact_head_sha ===
          row.artifact_head_sha,
      `Verdict evidence ${row.evidence_id ?? "(unnamed)"} has a different identity or byte digest.`
    );
  }
  return new Map(verdict.claims.map(row => [row.claim_id, row]));
}

/** Every declared local marker binds its real bytes; references are excluded. */
export function validateManifest(record, body, evidence) {
  const declared = localMarkers(body);
  requireProof(
    record.manifest.length === declared.length,
    "The local typed evidence manifest is incomplete."
  );
  for (const marker of declared) {
    const entries = record.manifest.filter(
      row => row.name === marker.name && row.kind === marker.kind
    );
    requireProof(
      entries.length === 1,
      `Missing or ambiguous local evidence ${marker.kind}: ${marker.name}.`
    );
    const entry = evidence.get(entries[0].evidence_id);
    requireProof(
      entry?.kind === marker.kind,
      `Local evidence ${marker.name} has the wrong attachment type.`
    );
  }
}

/** Closed obligation categories cannot be silently omitted or waived by prose. */
export function validateObligations(record, scope, claims) {
  for (const [name, row] of Object.entries(record.obligations)) {
    const mandatory =
      ["conformance", "usage", "linkage", "acceptance"].includes(name) ||
      (scope.runtime && ["remote", "delivery"].includes(name)) ||
      (name === "typed_manifest" && record.manifest.length > 0);
    requireProof(
      isObject(row) &&
        typeof row.required === "boolean" &&
        (!mandatory || row.required),
      `Completion obligation ${name} cannot be omitted or waived for this work.`
    );
    if (!row.required) {
      const reasons = scope.runtime
        ? ["no-local-markers"]
        : [scope.reason, "no-local-markers"];
      requireProof(
        row.status === "not-applicable" && reasons.includes(row.reason),
        `Completion obligation ${name} has no contract-allowed exemption.`
      );
      continue;
    }
    const expected =
      name === "conformance"
        ? "CONFORMS"
        : name === "acceptance"
          ? "accepted-for-completion"
          : "pass";
    requireProof(
      row.status === expected,
      `Completion obligation ${name} is not ${expected}.`,
      row.status === "pending" ? "pending-proof" : "invalid-proof"
    );
  }
  if (scope.runtime)
    requireProof(
      Array.isArray(record.obligations.remote.claim_ids) &&
        record.obligations.remote.claim_ids.length > 0 &&
        record.obligations.remote.claim_ids.every(id => {
          const claim = claims.get(id);
          return (
            claim?.required_for_gate === true &&
            claim.status === "established" &&
            claim.verification_role === "remote" &&
            claim.boundary !== "code-unit"
          );
        }),
      "Required remote verification has no established empirical claims against the delivered artifact."
    );
  const criteria = new Set();
  for (const group of record.requirements) {
    requireProof(
      isText(group.requirement_id) &&
        !criteria.has(group.requirement_id) &&
        group.operator === "all" &&
        Array.isArray(group.claim_ids) &&
        (!scope.runtime || group.claim_ids.length > 0),
      "A requirement has an empty, duplicate or non-conjunctive claim map."
    );
    criteria.add(group.requirement_id);
    requireProof(
      group.claim_ids.every(
        id =>
          claims.get(id)?.required_for_gate === true &&
          claims.get(id).status === "established"
      ),
      `Requirement ${group.requirement_id} is missing a required claim conjunct.`
    );
  }
  requireProof(
    record.obligations.conformance.requirement_ids?.length === criteria.size &&
      record.obligations.conformance.requirement_ids.every(id =>
        criteria.has(id)
      ),
    "The CONFORMS result does not cover the complete requirement map."
  );
}

/**
 * Whether one usage entry is the canonical Verify entry for this work item.
 * @param {any} entry Parsed usage entry, if any.
 * @param {string} ref Work-item reference.
 * @param {any} context Provider context.
 * @returns {boolean} True when the flow and artifact identity both match.
 */
function isVerifyEntryFor(entry, ref, context) {
  const identity = String(entry?.artifactRef ?? "").replace(/^github:/, "");
  const linear =
    context.provider === "linear" &&
    identity === `linear:${context.scope.split("/")[0]}/${ref}`;
  return (
    ["lisa-verify", "verify"].includes(entry?.flow) &&
    (linear ||
      identity === ref ||
      identity === `https://github.com/${ref.replace("#", "/issues/")}`)
  );
}

/**
 * Use the same canonical parser/integrity implementation as the TS writer.
 *
 * Every comment on the work item is read, from any author. A `## Lisa Usage`
 * section that is malformed or fails its integrity check therefore cannot be
 * allowed to fail the whole authorization: one stray or hand-edited comment
 * would otherwise turn a completed item into `invalid-proof`
 * (CodySwannGT/lisa#4564). Such a section contributes no entries and is
 * skipped, and an expected id is satisfied when ANY intact section carries the
 * matching Verify entry, so a later conflicting copy cannot shadow it. Nothing
 * is accepted that was not accepted before: every expected id still needs an
 * intact, well-formed section holding the Verify entry for this exact item.
 */
export function validateVerifyUsage(documents, ref, expectedIds, context) {
  requireProof(
    Array.isArray(expectedIds) && expectedIds.length > 0,
    "Canonical Verify usage is missing."
  );
  const found = new Map();
  let skipped = 0;
  for (const [index, document] of documents.entries()) {
    let usage;
    try {
      usage = section(document, "Lisa Usage");
    } catch (error) {
      // documents[0] is the work-item body; a duplicate heading there stays
      // fatal. In a comment it is one more stray section to skip.
      if (index === 0) throw error;
      skipped += 1;
      continue;
    }
    if (!usage) continue;
    const canonical = `## Lisa Usage\n${usage}\n`;
    let parsed;
    try {
      parsed = parseLisaUsageSection(canonical);
    } catch {
      skipped += 1;
      continue;
    }
    if (!parsed.range) continue;
    if (!verifyLisaUsageSectionIntegrity(canonical).ok) {
      skipped += 1;
      continue;
    }
    for (const entry of parsed.entries) {
      if (!found.has(entry.entryId)) found.set(entry.entryId, []);
      found.get(entry.entryId).push(entry);
    }
  }
  const note =
    skipped > 0
      ? ` ${skipped} malformed or integrity-failing usage section(s) were ignored.`
      : "";
  for (const id of expectedIds) {
    requireProof(
      (found.get(id) ?? []).some(entry =>
        isVerifyEntryFor(entry, ref, context)
      ),
      `Canonical Verify usage entry ${id} is absent or belongs to another work item.${note}`
    );
    // acceptedAt/lifecycleSources attest the later native terminal event. They
    // are deliberately not prerequisites of the transition they describe.
  }
}
