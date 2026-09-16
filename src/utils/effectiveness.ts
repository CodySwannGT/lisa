/** Observations, not scores. Unknown clocks stay null and evidence stays explicit. */
import { createHash } from "node:crypto";

/** Four independent clocks and their provenance for one usage row. */
export interface EffectivenessObservation {
  readonly schema: 1;
  readonly lisaVersion: string | null;
  readonly workerConfigRevision: string | null;
  readonly workerWallMs: number | null;
  readonly feedbackMs: readonly number[] | null;
  readonly workerSource: string | null;
  readonly attention:
    | readonly { readonly id: string; readonly source: string }[]
    | null;
  readonly readyAt: string | null;
  readonly acceptedAt: string | null;
  readonly lifecycleSources: readonly string[] | null;
  readonly reworkSources: readonly string[] | null;
}

const FIELDS = [
  "schema",
  "lisaVersion",
  "workerConfigRevision",
  "workerWallMs",
  "feedbackMs",
  "workerSource",
  "attention",
  "readyAt",
  "acceptedAt",
  "lifecycleSources",
  "reworkSources",
];

/**
 * Normalize and hash exactly as the gardener does, independent of ledger entry versions.
 * @param invariant - Rule whose recurrence is being measured
 * @returns Twelve-character SHA-256 prefix
 */
export function invariantFingerprint(invariant: string): string {
  return createHash("sha256")
    .update(invariant.trim().replace(/\s+/gu, " ").toLowerCase())
    .digest("hex")
    .slice(0, 12);
}

/**
 * Require a nonempty evidence identifier.
 * @param value - Untrusted field
 * @returns Whether this is a nonempty string
 */
export function isEvidenceString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Require an unambiguous UTC instant rather than a locale-dependent date.
 * @param value - Untrusted timestamp
 * @returns Whether this is a canonical UTC instant
 */
export function isEvidenceTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

/**
 * Validate a duration without converting missing values to zero.
 * @param value - Untrusted duration
 * @returns Whether duration is finite and nonnegative
 */
function isDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Validate optional source lists.
 * @param value - Untrusted sources
 * @returns Whether sources are valid or explicitly unavailable
 */
function isSources(value: unknown): boolean {
  return (
    value === null || (Array.isArray(value) && value.every(isEvidenceString))
  );
}

/**
 * Validate observed human interventions; timestamps cannot imply minutes of work.
 * @param value - Untrusted events
 * @returns Whether all events carry stable identity and source
 */
function isAttention(value: unknown): boolean {
  return (
    value === null ||
    (Array.isArray(value) &&
      value.every(
        event =>
          event !== null &&
          typeof event === "object" &&
          Object.keys(event).length === 2 &&
          isEvidenceString(event.id) &&
          isEvidenceString(event.source)
      ))
  );
}

/**
 * Check nullable clock fields and the evidence needed to interpret them.
 * @param row - Candidate observation
 * @returns Whether clocks are valid and sourced
 */
function validClocks(row: Record<string, unknown>): boolean {
  const durations =
    (row.workerWallMs === null || isDuration(row.workerWallMs)) &&
    (row.feedbackMs === null ||
      (Array.isArray(row.feedbackMs) && row.feedbackMs.every(isDuration)));
  const sourcedWorker =
    (row.workerWallMs === null && row.feedbackMs === null) ||
    isEvidenceString(row.workerSource);
  const times = [row.readyAt, row.acceptedAt].every(
    value => value === null || isEvidenceTime(value)
  );
  const sourcedLifecycle =
    (row.readyAt === null && row.acceptedAt === null) ||
    (Array.isArray(row.lifecycleSources) && row.lifecycleSources.length > 0);
  const ordered =
    !isEvidenceTime(row.readyAt) ||
    !isEvidenceTime(row.acceptedAt) ||
    Date.parse(row.acceptedAt) >= Date.parse(row.readyAt);
  return durations && sourcedWorker && times && sourcedLifecycle && ordered;
}

/**
 * Parse additive observation data, refusing malformed measurements rather than guessing.
 * @param value - JSON-compatible input
 * @returns Validated observation
 */
export function parseEffectiveness(value: unknown): EffectivenessObservation {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid effectiveness observation");
  const row = value as Record<string, unknown>;
  const shape =
    Object.keys(row).length === FIELDS.length &&
    FIELDS.every(key => Object.hasOwn(row, key));
  const tags = [
    row.lisaVersion,
    row.workerConfigRevision,
    row.workerSource,
  ].every(tag => tag === null || isEvidenceString(tag));
  if (
    !shape ||
    row.schema !== 1 ||
    !tags ||
    !isAttention(row.attention) ||
    !isSources(row.lifecycleSources) ||
    !isSources(row.reworkSources) ||
    !validClocks(row)
  )
    throw new Error("Invalid or unsourced effectiveness observation");
  return value as EffectivenessObservation;
}

/**
 * Summarize a run without combining distinct clocks or extrapolating missing evidence.
 * @param observation - Validated run observations
 * @returns Clock summaries and observed human event count
 */
export function summarizeEffectiveness(observation: EffectivenessObservation) {
  const row = parseEffectiveness(observation);
  const samples =
    row.feedbackMs === null ? null : [...row.feedbackMs].sort((a, b) => a - b);
  const percentile = (fraction: number) =>
    samples?.[Math.max(0, Math.ceil(samples.length * fraction) - 1)] ?? null;
  return {
    feedback:
      samples === null
        ? null
        : {
            count: samples.length,
            minMs: samples[0] ?? null,
            medianMs:
              samples.length === 0
                ? null
                : ((samples[Math.floor((samples.length - 1) / 2)] ?? 0) +
                    (samples[Math.floor(samples.length / 2)] ?? 0)) /
                  2,
            p95Ms: percentile(0.95),
            maxMs: samples.at(-1) ?? null,
          },
    workerWallMs: row.workerWallMs,
    humanInterventions:
      row.attention === null
        ? null
        : new Set(row.attention.map(event => event.id)).size,
    readyToAcceptedMs:
      row.readyAt === null || row.acceptedAt === null
        ? null
        : Date.parse(row.acceptedAt) - Date.parse(row.readyAt),
  };
}

/**
 * Render an adjacent extension; the released primary usage token never changes.
 * @param entryId - Correlated usage entry identity
 * @param observation - Optional effectiveness observation
 * @returns Extension token or empty text for legacy entries
 */
export function renderEffectivenessToken(
  entryId: string,
  observation?: EffectivenessObservation
): string {
  if (observation === undefined) return "";
  return ` <!-- lisa:usage-effectiveness entry_id=${encodeURIComponent(entryId)} data=${encodeURIComponent(JSON.stringify(parseEffectiveness(observation)))} -->`;
}

/**
 * Read correlated extensions and reject ambiguous repeated values.
 * @param section - Managed usage markdown
 * @returns Observation keyed by usage entry identity
 */
export function parseEffectivenessTokens(
  section: string
): ReadonlyMap<string, EffectivenessObservation> {
  const rows = Array.from(
    section.matchAll(/<!-- lisa:usage-effectiveness [^\r\n]*? -->/gu),
    token => {
      const match =
        /^<!-- lisa:usage-effectiveness entry_id=(\S+) data=(\S+) -->$/u.exec(
          token[0]
        );
      if (match === null) throw new Error("Invalid effectiveness extension");
      return [
        decodeURIComponent(match[1] ?? ""),
        parseEffectiveness(
          JSON.parse(decodeURIComponent(match[2] ?? "")) as unknown
        ),
      ] as const;
    }
  );
  const entries = new Map(rows);
  if (
    rows.some(
      ([id, row]) => JSON.stringify(entries.get(id)) !== JSON.stringify(row)
    )
  )
    throw new Error("Conflicting effectiveness extensions");
  return entries;
}
