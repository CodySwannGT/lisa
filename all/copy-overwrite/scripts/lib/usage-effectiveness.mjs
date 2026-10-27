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
 * Require a nonempty evidence identifier.
 * @param value - Untrusted field
 * @returns Whether this is a nonempty string
 */
export function isEvidenceString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
/**
 * Require an unambiguous UTC instant rather than a locale-dependent date.
 * @param value - Untrusted timestamp
 * @returns Whether this is a canonical UTC instant
 */
export function isEvidenceTime(value) {
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
function isDuration(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
/**
 * Validate optional source lists.
 * @param value - Untrusted sources
 * @returns Whether sources are valid or explicitly unavailable
 */
function isSources(value) {
  return (
    value === null || (Array.isArray(value) && value.every(isEvidenceString))
  );
}
/**
 * Validate observed human interventions; timestamps cannot imply minutes of work.
 * @param value - Untrusted events
 * @returns Whether all events carry stable identity and source
 */
function isAttention(value) {
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
function validClocks(row) {
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
export function parseEffectiveness(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid effectiveness observation");
  const row = value;
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
  return value;
}
/**
 * Read correlated extensions and reject ambiguous repeated values.
 * @param section - Managed usage markdown
 * @returns Observation keyed by usage entry identity
 */
export function parseEffectivenessTokens(section) {
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
        parseEffectiveness(JSON.parse(decodeURIComponent(match[2] ?? ""))),
      ];
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
