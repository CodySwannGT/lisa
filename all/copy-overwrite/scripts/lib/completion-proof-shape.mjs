// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Strict shared data contract for accepted-for-completion records. */
import { createHash } from "node:crypto";
import {
  markdownSection,
  topLevelLines,
} from "./completion-proof-markdown.mjs";
import {
  canonicalCompletionBlock,
  usageSpecRemainder,
} from "./completion-proof-projection.mjs";
import {
  CompletionProofError,
  requireProof,
} from "./completion-proof-errors.mjs";

const CLI_OUTPUT = "cli-output";
const TEST_RUN_LOG = "test-run-log";

export {
  CompletionProofError,
  requireProof,
} from "./completion-proof-errors.mjs";

export const PROOF_MARKER = "[lisa-completion-authorization]";
export const PROOF_KIND = "lisa-completion-authorization";
export const MAX_RECORD_BYTES = 2 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
export const KINDS = [
  "screenshot",
  "recording",
  "http-transcript",
  CLI_OUTPUT,
  "log-snippet",
  "db-query-output",
  "perf-trace",
  TEST_RUN_LOG,
  "deploy-log",
  "state-dump",
];
export const BOUNDARIES = {
  "code-unit": [TEST_RUN_LOG],
  browser: ["screenshot", "recording"],
  "http-api": ["http-transcript"],
  cli: [CLI_OUTPUT],
  data: ["db-query-output", "state-dump"],
  "deploy-health": ["deploy-log"],
  performance: ["perf-trace"],
  "standards-compat": [CLI_OUTPUT, TEST_RUN_LOG],
};

/** Hash actual bytes, never a caller's claimed digest. */
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Unambiguous typed fields used by the producer and reader. */
export const isObject = value =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const isText = value =>
  typeof value === "string" && value.trim().length > 0;
export const isDigest = value =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const isOid = value =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
export const isId = value => Number.isSafeInteger(value) && value > 0;
export const isTime = value =>
  typeof value === "string" &&
  /(?:Z|\+00:00)$/.test(value) &&
  Number.isFinite(Date.parse(value));

/** Remove only exact canonical machine-owned sections, retaining unknown prose. */
export function primarySpecProjection(body) {
  requireProof(
    typeof body === "string",
    "The primary work-item description is unreadable."
  );
  const headings = topLevelLines(body).filter(row => row.heading);
  const usage = headings.filter(row => row.text === "## Lisa Usage");
  requireProof(
    usage.length <= 1,
    "Duplicate canonical usage sections make the primary specification ambiguous."
  );
  let result = body;
  if (usage.length) {
    const start = usage[0].start;
    const end = headings.find(row => row.start > start)?.start ?? body.length;
    result =
      body.slice(0, start) +
      usageSpecRemainder(body.slice(start, end)) +
      body.slice(end);
  }
  for (const name of ["authorization", "postcondition"]) {
    const start = `<!-- lisa:completion-${name}:start -->`;
    const end = `<!-- lisa:completion-${name}:end -->`;
    const rows = topLevelLines(result);
    const starts = rows.filter(row => row.text === start);
    const ends = rows.filter(row => row.text === end);
    if (!starts.length && !ends.length) continue;
    requireProof(
      starts.length === 1 &&
        ends.length === 1 &&
        ends[0].start > starts[0].start,
      `The canonical completion ${name} block has ambiguous boundaries.`
    );
    if (
      !canonicalCompletionBlock(
        name,
        result.slice(starts[0].end, ends[0].start).trim()
      )
    )
      continue;
    result = result.slice(0, starts[0].start) + result.slice(ends[0].end);
  }
  return result;
}

/** Exact local claiming markers; cross-work-item references do not claim proof. */
export function localMarkers(body) {
  const matches = [
    ...body.matchAll(/\[EVIDENCE:\s*([a-z-]+):\s*([a-z][a-z0-9-]*)\s*\]/g),
  ];
  const legacy = [...body.matchAll(/\[SCREENSHOT:\s*([a-z][a-z0-9-]*)\s*\]/g)];
  requireProof(
    matches.length === (body.match(/\[EVIDENCE:/g) ?? []).length,
    "A local evidence declaration is malformed; repair its type and name."
  );
  const markers = [
    ...matches.map(row => ({ kind: row[1], name: row[2] })),
    ...legacy.map(row => ({ kind: "screenshot", name: row[1] })),
  ];
  requireProof(
    markers.every(row => KINDS.includes(row.kind)),
    "A local evidence declaration has an unsupported type."
  );
  requireProof(
    new Set(markers.map(row => row.name)).size === markers.length,
    "Local evidence declarations must have unique names."
  );
  return markers;
}

/** Read an exact markdown section without discarding unknown source sections. */
export function section(body, heading) {
  return markdownSection(body, heading);
}

/** Preserve the first whitespace-delimited environment suffix in linear work. */
function environmentValue(declaration) {
  let whitespaceStart = -1;
  for (let index = 0; index < declaration.length; index += 1) {
    const character = declaration[index];
    if (/\s/.test(character)) {
      if (whitespaceStart < 0) whitespaceStart = index;
    } else {
      if (
        whitespaceStart >= 0 &&
        (character === "-" || character === "—") &&
        /\s/.test(declaration[index + 1] ?? "")
      )
        return declaration.slice(0, whitespaceStart).trim();
      whitespaceStart = -1;
    }
  }
  return declaration.trim();
}

/** Exemptions are explicit declarations, never an absent environment. */
export function declaredScope(body, environment) {
  const declaration = section(body, "Target Backend Environment");
  const exemption =
    /^None\s*[—-]\s*no runtime behavior change:\s*(doc-only|config-only|type-only)\s*$/i.exec(
      declaration
    );
  if (exemption) return { runtime: false, reason: exemption[1].toLowerCase() };
  const value = environmentValue(
    declaration.replace(/^(Assumption|Inferred|Confirmed):\s*/i, "")
  );
  requireProof(
    value === environment,
    `The primary item does not declare target environment ${environment}; run canonical verification for its actual target.`,
    "pending-proof"
  );
  return { runtime: true, reason: null };
}

/** Positive shape validation before any network-selected record is interpreted. */
export function validateRecordShape(record) {
  requireProof(
    isObject(record) &&
      record.schema_version === 1 &&
      record.kind === PROOF_KIND,
    "The completion record schema is unsupported or malformed."
  );
  requireProof(
    isText(record.record_id) &&
      isId(record.revision) &&
      ["accepted-for-completion", "pending", "revoked"].includes(
        record.state
      ) &&
      isTime(record.captured_at) &&
      (record.supersedes === null || isDigest(record.supersedes)),
    "The completion record identity, revision, state or capture time is malformed."
  );
  requireProof(
    isObject(record.subject) &&
      ["github", "linear"].includes(record.subject.provider) &&
      isText(record.subject.ref) &&
      isText(String(record.subject.native_id ?? "")) &&
      isText(record.subject.scope),
    "The completion record must identify the exact native work item and provider scope."
  );
  requireProof(
    isObject(record.repository) &&
      isId(record.repository.id) &&
      /^[^/\s]+\/[^/\s]+$/.test(record.repository.name ?? ""),
    "The implementation repository identity is malformed."
  );
  requireProof(
    isObject(record.producer) && isId(record.producer.github_actor_id),
    "The completion record has no stable publisher identity."
  );
  requireProof(
    isText(record.environment) &&
      isText(record.branch) &&
      isDigest(record.spec_sha256),
    "The completion record environment, branch or full-spec digest is malformed."
  );
  if (record.state !== "accepted-for-completion") return record;
  const source = record.source;
  requireProof(
    isObject(source) &&
      isId(source.pull_request) &&
      isOid(source.tested_head) &&
      isOid(source.pr_head) &&
      isOid(source.merge_sha) &&
      isOid(source.production_snapshot_sha) &&
      isOid(source.delivered_sha) &&
      Array.isArray(source.declaring_commits) &&
      source.declaring_commits.length > 0 &&
      source.declaring_commits.every(isOid),
    "The accepted record lacks exact primary PR, source, merge and delivered identities."
  );
  requireProof(
    Array.isArray(record.manifest) &&
      Array.isArray(record.verdicts) &&
      record.verdicts.length > 0 &&
      Array.isArray(record.evidence) &&
      Array.isArray(record.requirements) &&
      record.requirements.length > 0,
    "The accepted record lacks an enumerable proof manifest, verdicts or requirement map."
  );
  requireProof(
    [
      record.manifest,
      record.verdicts,
      record.evidence,
      record.requirements,
    ].every(rows => rows.every(isObject)),
    "The accepted proof contains malformed attachment or requirement rows."
  );
  const names = [
    "remote",
    "conformance",
    "typed_manifest",
    "delivery",
    "usage",
    "linkage",
    "acceptance",
  ];
  requireProof(
    isObject(record.obligations) &&
      Object.keys(record.obligations).sort().join() === names.sort().join(),
    "The accepted record must explicitly account for every completion obligation."
  );
  return record;
}

/** Native locator content is discovery, never acceptance or a free-form URL. */
export function parseLocator(body) {
  if (typeof body !== "string" || !body.startsWith(`${PROOF_MARKER}\n`))
    return null;
  try {
    const value = JSON.parse(body.slice(PROOF_MARKER.length).trim());
    requireProof(
      value.schema_version === 1 &&
        isId(value.asset_id) &&
        isDigest(value.sha256) &&
        isId(value.revision) &&
        isText(value.record_id) &&
        isText(value.repository),
      "The completion locator is malformed."
    );
    return value;
  } catch (error) {
    if (error instanceof CompletionProofError) throw error;
    throw new CompletionProofError(
      "invalid-proof",
      "The completion locator is not readable structured JSON."
    );
  }
}
