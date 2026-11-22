/**
 * Hash-pinned allowlist projection for public upstream Lisa filings.
 *
 * Turns one closed, untrusted event from a host-project workflow into public
 * Markdown that contains only allowlisted vocabulary, hash-pinned Lisa-owned
 * excerpts, and public-origin commits. The hostile-input guards, package-file
 * reads, and per-field validators live in sibling `upstream-attribution-*`
 * modules; this module owns the vocabulary, the validation order, and the
 * rendered document.
 * @module core/upstream-attribution-body
 */
import {
  assertDynamicTextSafe,
  assertPublicTextSafe,
  readOptionalValue,
  readValue,
  reject,
  requireAllowlistedRecord,
  requireAsciiString,
  requireDenseArray,
} from "./upstream-attribution-guards.js";
import { assertRuntimeContract } from "./upstream-attribution-files.js";
import {
  type UpstreamAttributionExcerpt,
  type UpstreamDocumentKind,
  requireCommitRefs,
  requireDocumentKind,
  requireExcerpts,
  requireFingerprintPairing,
  requireLisaSurface,
} from "./upstream-attribution-fields.js";

export { UpstreamAttributionRejection } from "./upstream-attribution-guards.js";
export type { UpstreamAttributionExcerpt } from "./upstream-attribution-fields.js";

const TOP_LEVEL_FIELDS = Object.freeze([
  "documentKind",
  "lisaSurface",
  "failureClass",
  "lisaOwnedExcerpts",
  "upstreamCommitRefs",
  "redactedPlaceholders",
  "occurrenceFingerprint",
] as const);

/** Closed, host-agnostic failure categories accepted in public filings. */
export const UPSTREAM_FAILURE_CLASSES = Object.freeze([
  "access-control-failure",
  "agent-parity-regression",
  "configuration-regression",
  "data-integrity-failure",
  "dependency-regression",
  "generated-artifact-regression",
  "installation-regression",
  "observability-gap",
  "pagination-truncation",
  "performance-regression",
  "public-data-exposure",
  "release-regression",
  "runtime-regression",
  "stale-artifact-overwrite",
  "test-coverage-gap",
  "validation-gap",
  "workflow-contract-violation",
] as const);
const FAILURE_CLASS_SET: ReadonlySet<string> = new Set(
  UPSTREAM_FAILURE_CLASSES
);

/** Fixed redaction tokens that can appear in public reproduction steps. */
export const UPSTREAM_REDACTED_PLACEHOLDERS = Object.freeze([
  "<host-project>",
  "<env-value>",
  "<credential>",
  "<connection-string>",
  "<pii>",
  "<host-payload>",
  "<path>",
  "<identifier>",
] as const);
const PLACEHOLDER_SET: ReadonlySet<string> = new Set(
  UPSTREAM_REDACTED_PLACEHOLDERS
);

/** One generic category from the closed public-filing taxonomy. */
export type UpstreamFailureClass = (typeof UPSTREAM_FAILURE_CLASSES)[number];

/** One safe, fixed reproduction placeholder accepted by the public builder. */
export type UpstreamRedactedPlaceholder =
  (typeof UPSTREAM_REDACTED_PLACEHOLDERS)[number];

/** Fields shared by both public attribution document kinds. */
interface CommonUpstreamAttributionInput {
  readonly lisaSurface: string;
  readonly failureClass: UpstreamFailureClass;
  readonly lisaOwnedExcerpts: readonly UpstreamAttributionExcerpt[];
  readonly upstreamCommitRefs: readonly string[];
  readonly redactedPlaceholders: readonly UpstreamRedactedPlaceholder[];
}

/** Typed issue event accepted by the public attribution builder. */
export interface UpstreamAttributionIssueInput extends CommonUpstreamAttributionInput {
  readonly documentKind: "issue";
}

/** Typed repeat-occurrence event accepted by the public attribution builder. */
export interface UpstreamAttributionOccurrenceInput extends CommonUpstreamAttributionInput {
  readonly documentKind: "occurrence";
  readonly occurrenceFingerprint: string;
}

/** Closed discriminated event accepted by the public attribution builder. */
export type UpstreamAttributionBodyInput =
  | UpstreamAttributionIssueInput
  | UpstreamAttributionOccurrenceInput;

/** A filing whose every field has passed validation. */
interface ValidatedAttribution {
  readonly documentKind: UpstreamDocumentKind;
  readonly lisaSurface: string;
  readonly failureClass: UpstreamFailureClass;
  readonly excerpts: readonly UpstreamAttributionExcerpt[];
  readonly upstreamCommitRefs: readonly string[];
  readonly redactedPlaceholders: readonly UpstreamRedactedPlaceholder[];
  readonly occurrenceFingerprint: string | undefined;
}

/**
 * Build one public issue body or repeat-occurrence comment from a closed event.
 * @param input - Untrusted event supplied by the host-project workflow
 * @returns Public Markdown safe to send verbatim to the upstream writer
 */
export function buildUpstreamAttributionIssueBody(
  input: UpstreamAttributionBodyInput
): string;
export function buildUpstreamAttributionIssueBody(input: unknown): string {
  const filing = validateAttribution(input);
  const rootCauseKey = `${filing.lisaSurface.toLowerCase()}#${filing.failureClass}`;
  const body =
    filing.documentKind === "occurrence"
      ? renderOccurrence(filing, rootCauseKey)
      : renderIssue(filing, rootCauseKey);
  assertPublicTextSafe(body);
  return body;
}

/**
 * Render a new upstream issue body.
 * @param filing - Validated filing
 * @param rootCauseKey - Surface and failure-class dedupe key
 * @returns Public issue Markdown
 */
function renderIssue(
  filing: ValidatedAttribution,
  rootCauseKey: string
): string {
  return [
    `<!-- [lisa-upstream-attribution] key=${rootCauseKey} -->`,
    "",
    "## What failed for the operator",
    "",
    `A Lisa-managed surface produced a \`${filing.failureClass}\` failure, so the automated pipeline did not complete as intended. Host-project details are omitted from this public filing.`,
    "",
    "## What the harness did wrong",
    "",
    `Lisa's \`${filing.lisaSurface}\` surface did not prevent the \`${filing.failureClass}\` failure class. The evidence below contains only hash-pinned Lisa-owned text and public-origin commits.`,
    "",
    "## What to change",
    "",
    `Harden \`${filing.lisaSurface}\` against \`${filing.failureClass}\` and add a regression check using only the fixed redacted placeholders below.`,
    "",
    renderEvidence(filing),
    "",
    "_Body composed by `lisa file-upstream`; do not edit before filing._",
    "",
  ].join("\n");
}

/**
 * Render a repeat-occurrence comment for an existing upstream issue.
 * @param filing - Validated occurrence filing
 * @param rootCauseKey - Surface and failure-class dedupe key
 * @returns Public comment Markdown
 */
function renderOccurrence(
  filing: ValidatedAttribution,
  rootCauseKey: string
): string {
  return [
    `<!-- [lisa-upstream-attribution-occurrence] key=${filing.occurrenceFingerprint ?? ""} -->`,
    "",
    "## Repeat encounter",
    "",
    `Another host project encountered root-cause key \`${rootCauseKey}\`. Host-project details are omitted; this comment contains only hash-pinned Lisa-owned evidence.`,
    "",
    renderEvidence(filing),
    "",
    "_Comment composed by `lisa file-upstream`; do not edit before posting._",
    "",
  ].join("\n");
}

/**
 * Render the evidence chain shared by issues and occurrences.
 * @param filing - Validated filing
 * @returns The evidence section Markdown
 */
function renderEvidence(filing: ValidatedAttribution): string {
  const excerpts = filing.excerpts
    .map(excerpt => `- \`${excerpt.file}\`:\n\n${indentAsCode(excerpt.text)}`)
    .join("\n\n");
  const references = filing.upstreamCommitRefs
    .map(reference => `- \`${reference}\``)
    .join("\n");
  const placeholders = filing.redactedPlaceholders
    .map(placeholder => `- \`${placeholder}\``)
    .join("\n");
  return [
    "## Evidence chain",
    "",
    `- Lisa surface: \`${filing.lisaSurface}\``,
    `- Failure class: \`${filing.failureClass}\``,
    "- Host-project issue: [OMITTED BY PUBLIC FILING POLICY]",
    "",
    "### Lisa-owned excerpts",
    "",
    excerpts,
    "",
    "### Public-origin commit references",
    "",
    references,
    "",
    "### Redacted reproduction placeholders",
    "",
    placeholders,
  ].join("\n");
}

/**
 * Validate every field of an untrusted event, in a fixed order.
 * @param input - Untrusted event
 * @returns The validated filing
 */
function validateAttribution(input: unknown): ValidatedAttribution {
  const record = openAttributionRecord(input);
  const documentKind = requireDocumentKind(readValue(record, "documentKind"));
  const occurrenceFingerprint = requireFingerprintPairing(
    readOptionalValue(record, "occurrenceFingerprint"),
    documentKind
  );
  const excerpts = requireExcerpts(readValue(record, "lisaOwnedExcerpts"));
  return {
    documentKind,
    lisaSurface: requireLisaSurface(readValue(record, "lisaSurface")),
    failureClass: requireFailureClass(readValue(record, "failureClass")),
    excerpts,
    upstreamCommitRefs: requireCommitRefs(
      readValue(record, "upstreamCommitRefs")
    ),
    redactedPlaceholders: requirePlaceholders(
      readValue(record, "redactedPlaceholders")
    ),
    occurrenceFingerprint,
  };
}

/**
 * Prove the runtime contract, then admit the event's top-level record.
 * @param input - Untrusted event
 * @returns The allowlisted, accessor-free top-level record
 */
function openAttributionRecord(input: unknown): Record<string, unknown> {
  assertRuntimeContract();
  return requireAllowlistedRecord(input, TOP_LEVEL_FIELDS, "input");
}

/**
 * Require a member of the closed failure taxonomy.
 * @param value - Untrusted `failureClass`
 * @returns The validated failure class
 */
function requireFailureClass(value: unknown): UpstreamFailureClass {
  const failureClass = requireAsciiString(value, "failureClass", 120);
  assertDynamicTextSafe(failureClass, "failureClass");
  if (!FAILURE_CLASS_SET.has(failureClass)) {
    return reject("failureClass", "is not in the closed failure taxonomy");
  }
  return failureClass as UpstreamFailureClass;
}

/**
 * Require members of the fixed redaction vocabulary.
 * @param value - Untrusted `redactedPlaceholders`
 * @returns The validated placeholders
 */
function requirePlaceholders(
  value: unknown
): readonly UpstreamRedactedPlaceholder[] {
  return requireDenseArray(value, "redactedPlaceholders", false).map(entry => {
    const placeholder = requireAsciiString(entry, "redactedPlaceholders", 64);
    assertDynamicTextSafe(placeholder, "redactedPlaceholders");
    if (!PLACEHOLDER_SET.has(placeholder)) {
      return reject("redactedPlaceholders", "is not in the fixed vocabulary");
    }
    return placeholder as UpstreamRedactedPlaceholder;
  });
}

/**
 * Indent text four spaces so Markdown renders it as a code block.
 * @param value - Excerpt text
 * @returns The indented text
 */
function indentAsCode(value: string): string {
  return value
    .split("\n")
    .map(line => `    ${line}`)
    .join("\n");
}
