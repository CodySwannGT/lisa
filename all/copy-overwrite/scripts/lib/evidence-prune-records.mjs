// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * The completion records the prune must honour, from every accepted release.
 *
 * The completion-proof validator accepts proof from every accepted evidence
 * release — the legacy `pr-assets`, the configured release or template, and any
 * listed history — and the publisher writes each new record into whichever of
 * them is current. So after a project rotates its release, a record in this
 * month's release can depend on a file in last month's. Reading pins from the
 * pruned release alone would let the prune delete that file
 * (CodySwannGT/lisa#4720). Every accepted release is read, and every record in
 * each must parse, or the run stops before anything changes.
 * @module scripts/lib/evidence-prune-records
 */
import {
  EVIDENCE_RELEASE_MAX_OVERFLOW,
  isAcceptedEvidenceRelease,
  overflowReleaseTag,
  resolveEvidenceRelease,
} from "./completion-proof-github.mjs";
import { COMPLETION_RECORD, EvidencePruneError } from "./evidence-prune.mjs";

const isRecord = asset => COMPLETION_RECORD.test(asset.name);

/** One completion record, parsed; any failure stops the run before a write. */
function readRecord(gh, asset) {
  try {
    return JSON.parse(gh.download(asset).toString("utf8"));
  } catch (error) {
    throw new EvidencePruneError(
      `The completion record ${asset.name} could not be read (${error.message}). Nothing was changed: every record must be readable to know which files are still needed.`
    );
  }
}

/**
 * Every accepted release's complete listing, and every record in them.
 * @param {object} gh - The prune's GitHub operations.
 * @param {object} policy - `verification.completion` from the Lisa config.
 * @param {string} tag - The release being pruned.
 * @returns {object|null} `{source, assets, accepted, recordAssets, records}`,
 *   or null when the pruned release does not exist.
 */
export function evidenceSnapshot(gh, policy, tag) {
  const accepted = gh
    .releases()
    .filter(release => isAcceptedEvidenceRelease(policy, release.tag_name));
  const source = accepted.find(release => release.tag_name === tag);
  if (!source) return null;
  const others = accepted
    .filter(release => release !== source)
    .flatMap(release => gh.assets(release));
  const assets = gh.assets(source);
  const recordAssets = [...others, ...assets].filter(isRecord);
  return {
    source,
    assets,
    accepted,
    recordAssets,
    records: recordAssets.map(asset => readRecord(gh, asset)),
  };
}

/**
 * The releases the publisher may write a new record into that the snapshot
 * did not list: the release it resolves to now and that release's overflow
 * releases, walked in order up to the first one that does not exist (the
 * publisher only creates `<release>-n` once `<release>-(n-1)` is full,
 * CodySwannGT/lisa#4838), plus the pinned release.
 */
function publisherReleases(gh, accepted, resolved, pinned) {
  const listed = tag => accepted.some(release => release.tag_name === tag);
  const extra = [];
  for (let index = 1; index <= EVIDENCE_RELEASE_MAX_OVERFLOW; index += 1) {
    const tag = overflowReleaseTag(resolved, index);
    if (listed(tag)) continue;
    const release = gh.release(tag);
    if (!release) break;
    extra.push(release);
  }
  const pinnedRelease =
    pinned && !listed(pinned) && !extra.some(row => row.tag_name === pinned)
      ? gh.release(pinned)
      : null;
  return pinnedRelease ? [...extra, pinnedRelease] : extra;
}

/**
 * A re-read of records published since the snapshot, for the check made
 * before each delete.
 *
 * It re-lists the snapshot's accepted releases plus every release the
 * publisher can write a new record into: the one it resolves to now, so a
 * rotation across a month boundary during a long run is still seen; that
 * release's overflow releases, which the publisher creates once it is full
 * (CodySwannGT/lisa#4838); and the one `LISA_EVIDENCE_RELEASE` pins, which the
 * publisher uses instead when set and creates when absent. It does not re-list
 * the repository's releases on every delete: on a repository with thousands
 * of releases that alone is twenty-odd calls per file. Walking the overflow
 * chain costs one lookup past the last release the snapshot already lists.
 * @param {object} gh - The prune's GitHub operations.
 * @param {object} policy - `verification.completion` from the Lisa config.
 * @param {object[]} accepted - The snapshot's accepted releases.
 * @param {object} [options] - Where the publisher may write.
 * @param {() => Date} [options.clock] - The time the publisher resolves at.
 * @param {string} [options.pinned] - The validated `LISA_EVIDENCE_RELEASE`.
 * @returns {(known: Set<number>) => {ids: number[], records: unknown[]}} The
 *   re-reader: given the record ids already read, the ones that are new.
 */
export function recordRescanner(gh, policy, accepted, options = {}) {
  const clock = options.clock ?? (() => new Date());
  return known => {
    const extra = publisherReleases(
      gh,
      accepted,
      resolveEvidenceRelease(policy, clock()),
      options.pinned
    );
    const fresh = [...accepted, ...extra]
      .flatMap(release => gh.assets(release))
      .filter(asset => isRecord(asset) && !known.has(asset.id));
    return {
      ids: fresh.map(asset => asset.id),
      records: fresh.map(asset => readRecord(gh, asset)),
    };
  };
}
