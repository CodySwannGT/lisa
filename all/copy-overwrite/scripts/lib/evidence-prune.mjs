// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Pure planning for the evidence prune: which files a completion record still
 * depends on, which are safe to move, and how the plan reads to an operator.
 *
 * GitHub caps a release at 1000 files, and a full evidence release stops every
 * completion (CodySwannGT/lisa#4692, #4720). Only files nothing depends on may
 * move, because the completion-proof validator reads proof only from the
 * evidence releases it accepts; an archived file a record names would stop
 * validating. So the pinned set is deliberately over-inclusive: any asset id or
 * 64-hex digest anywhere inside any completion record pins a file.
 * @module scripts/lib/evidence-prune
 */

/** Completion records are never pruned; they are the `supersedes` audit chain. */
export const COMPLETION_RECORD = /^completion-.*\.json$/;
/** Evidence younger than this is assumed to belong to work still in flight. */
export const DEFAULT_MIN_AGE_DAYS = 14;
const DAY_MS = 86_400_000;
const HEX_DIGEST = /[0-9a-f]{64}/gi;
const ASSET_ID_KEY = /^asset_?id$/i;
const ASSET_URL_ID = /\/releases\/assets\/(\d+)/g;

/** A refusal whose message is already written for the operator. */
export class EvidencePruneError extends Error {
  /**
   * @param {string} message - Plain-language reason and what to do next.
   * @param {object} [details] - Machine-readable context for `--json`.
   */
  constructor(message, details = {}) {
    super(message);
    this.name = "EvidencePruneError";
    this.details = details;
  }
}

/**
 * The archive release a run moves files into: `<release>-archive-YYYY-MM`.
 * @param {string} release - The evidence release being pruned.
 * @param {Date} now - Run time; its UTC year and month name the archive.
 * @returns {string} The archive release tag.
 */
export function archiveReleaseTag(release, now) {
  return `${release}-archive-${now.toISOString().slice(0, 7)}`;
}

/** Every asset id and digest one JSON value mentions, at any depth. */
function walk(value, key = "") {
  if (Array.isArray(value)) return value.flatMap(item => walk(item, key));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([name, item]) => walk(item, name));
  const text = typeof value === "string" ? value : "";
  const keyed =
    ASSET_ID_KEY.test(key) && /^\d+$/.test(String(value))
      ? [{ id: Number(value) }]
      : [];
  return [
    ...keyed,
    ...[...text.matchAll(ASSET_URL_ID)].map(match => ({
      id: Number(match[1]),
    })),
    ...(text.match(HEX_DIGEST) ?? []).map(hex => ({
      digest: hex.toLowerCase(),
    })),
  ];
}

/**
 * The asset ids and sha256 digests any completion record depends on.
 * @param {unknown[]} records - Every parsed completion record in the release.
 * @returns {{assetIds: Set<number>, digests: Set<string>}} The pinned values.
 */
export function collectPins(records) {
  const found = records.flatMap(record => walk(record));
  return {
    assetIds: new Set(found.filter(row => "id" in row).map(row => row.id)),
    digests: new Set(
      found.filter(row => "digest" in row).map(row => row.digest)
    ),
  };
}

/**
 * Two pin sets as one.
 * @param {{assetIds: Set<number>, digests: Set<string>}} a - Pins.
 * @param {{assetIds: Set<number>, digests: Set<string>}} b - More pins.
 * @returns {{assetIds: Set<number>, digests: Set<string>}} Their union.
 */
export function mergePins(a, b) {
  return {
    assetIds: new Set([...a.assetIds, ...b.assetIds]),
    digests: new Set([...a.digests, ...b.digests]),
  };
}

/**
 * Whether a record depends on a file, by its asset id or its sha256.
 * @param {{assetIds: Set<number>, digests: Set<string>}} pins - Pins.
 * @param {number} id - Asset id.
 * @param {string} sha - The file's sha256.
 * @returns {boolean} True when the file is pinned.
 */
export function isPinned(pins, id, sha) {
  return pins.assetIds.has(id) || pins.digests.has(sha);
}

/**
 * The sha256 GitHub reports for an asset, or null when it reports none.
 * @param {{digest?: string|null}} asset - Native release-asset metadata.
 * @returns {string|null} Lowercase hex digest.
 */
export function reportedSha256(asset) {
  const match = /^sha256:([0-9a-f]{64})$/i.exec(asset?.digest ?? "");
  return match ? match[1].toLowerCase() : null;
}

/** Upload time in ms; a listing row without one is an incomplete listing. */
function uploadedAt(asset) {
  const time = Date.parse(asset.created_at);
  if (!Number.isFinite(time))
    throw new EvidencePruneError(
      `The file listing is incomplete: ${JSON.stringify(asset.name)} has no upload time. Nothing was changed.`
    );
  return time;
}

/**
 * Why one file stays, or `candidate` when it may move.
 *
 * A file GitHub reported no digest for is hashed only when the time rules
 * already make it a candidate, so the `pinned` count is a lower bound when
 * digests are missing: a sha-pinned file the time rules keep anyway is counted
 * as `kept`. Safety is unaffected — no file is a candidate without its sha256
 * being checked against every pin.
 */
function classify(asset, context) {
  if (COMPLETION_RECORD.test(asset.name)) return "pinned";
  if (context.pins.assetIds.has(asset.id)) return "pinned";
  const time = uploadedAt(asset);
  const eligible =
    context.newest !== null && time < context.newest && time < context.cutoff;
  const sha = reportedSha256(asset) ?? (eligible ? context.hashOf(asset) : "");
  if (context.pins.digests.has(sha)) return "pinned";
  return eligible ? "candidate" : "kept";
}

/**
 * Decide which files of one release may be archived and removed.
 *
 * A candidate is unpinned, uploaded before the newest completion record (a
 * newer record has superseded it), and older than `minAgeDays`. A release with
 * no completion record has nothing superseded, so nothing is a candidate.
 * @param {object} input - Planning inputs.
 * @param {string} input.release - The release tag.
 * @param {object[]} input.assets - The complete native asset listing.
 * @param {unknown[]} input.records - Every parsed completion record, from
 *   every accepted evidence release.
 * @param {object[]} [input.recordAssets] - Listing rows of those records,
 *   whose newest upload time decides what is superseded; defaults to the
 *   records inside `assets`.
 * @param {Date} input.now - Run time.
 * @param {number} input.minAgeDays - Minimum candidate age.
 * @param {(asset: object) => string} input.hashOf - sha256 for an asset
 *   GitHub reported no digest for; called only when the answer matters.
 * @returns {{release: string, total: number, pinned: number, kept: number,
 *   newestRecordAt: string|null, minAgeDays: number,
 *   candidates: Array<{id: number, name: string, size: number,
 *   created_at: string, sha256: string|null}>}} The plan: counts and the
 *   candidates, oldest first.
 */
export function planPrune({
  release,
  assets,
  records,
  recordAssets = assets.filter(asset => COMPLETION_RECORD.test(asset.name)),
  now,
  minAgeDays,
  hashOf,
}) {
  const times = recordAssets.map(uploadedAt);
  const context = {
    pins: collectPins(records),
    newest: times.length ? Math.max(...times) : null,
    cutoff: now.getTime() - minAgeDays * DAY_MS,
    hashOf,
  };
  const rows = assets.map(asset => ({ asset, kind: classify(asset, context) }));
  const count = kind => rows.filter(row => row.kind === kind).length;
  const candidates = rows
    .filter(row => row.kind === "candidate")
    .map(({ asset }) => ({
      id: asset.id,
      name: asset.name,
      size: asset.size,
      created_at: asset.created_at,
      sha256: reportedSha256(asset),
    }))
    .sort(
      (a, b) =>
        Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id
    );
  return {
    release,
    total: assets.length,
    pinned: count("pinned"),
    kept: count("kept"),
    newestRecordAt:
      context.newest === null ? null : new Date(context.newest).toISOString(),
    minAgeDays,
    candidates,
  };
}

/**
 * The plain-language report an operator reads.
 * @param {object} report - A plan, plus the repository, archive and outcome.
 * @returns {string[]} Report lines.
 */
export function formatReport(report) {
  const verb = report.applied
    ? "Archive release"
    : "Archive release (would use)";
  return [
    `Evidence release: ${report.release} (${report.repository})`,
    `Total files: ${report.total}`,
    `Pinned: ${report.pinned} (completion records and files they depend on)`,
    `Kept as recent or not yet superseded: ${report.kept}`,
    `Prune candidates: ${report.candidates.length}`,
    `${verb}: ${report.archiveRelease}`,
    ...report.candidates.map(
      row => `  ${row.name}  ${row.size} bytes  uploaded ${row.created_at}`
    ),
    ...(report.applied
      ? []
      : [
          report.candidates.length
            ? "Dry run: nothing was changed. Re-run with --apply to archive these files and then remove them."
            : "Dry run: nothing was changed, and there is nothing to prune.",
        ]),
  ];
}
