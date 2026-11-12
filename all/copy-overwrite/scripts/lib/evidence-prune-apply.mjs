// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * The `--apply` half of the evidence prune: copy, confirm, and only then delete.
 *
 * Each candidate is downloaded, uploaded to the archive release under the same
 * name, read back, and compared by sha256. Just before the delete, completion
 * records published since the plan was made are read, so a record that came to
 * depend on the file mid-run keeps it. The original is deleted only after both
 * checks pass, so a failed or corrupted copy can never cost the only copy of a
 * file, and the first failure stops the run (CodySwannGT/lisa#4720).
 * @module scripts/lib/evidence-prune-apply
 */
import {
  EVIDENCE_RELEASE_ASSET_LIMIT,
  EVIDENCE_RELEASE_NEAR_FULL,
} from "./completion-proof-github.mjs";
import {
  collectPins,
  EvidencePruneError,
  isPinned,
  mergePins,
  reportedSha256,
} from "./evidence-prune.mjs";
import { hashBytes } from "./evidence-prune-gh.mjs";

/**
 * The exact refusal an operator reads when the archive has no room left.
 * @param {string} tag - Archive release tag.
 * @returns {string} The message.
 */
export function nearlyFullMessage(tag) {
  return `Archive release ${tag} is nearly full (${EVIDENCE_RELEASE_NEAR_FULL} of GitHub's ${EVIDENCE_RELEASE_ASSET_LIMIT}-file limit); re-run next month or pass --archive-release <name>.`;
}

/** The archive release, created from the default branch when absent. */
function openArchive(gh, tag, branch) {
  const existing = gh.release(tag);
  if (existing) return existing;
  gh.createRelease(tag, branch);
  const created = gh.release(tag);
  if (!created)
    throw new EvidencePruneError(
      `The archive release ${tag} was created but cannot be read back; nothing was archived.`
    );
  return created;
}

/** Refuse a copy whose bytes differ, naming the file and both hashes. */
function requireSame(name, expected, actual, where) {
  if (expected !== actual)
    throw new EvidencePruneError(
      `${where} of ${name} does not match the original (original sha256 ${expected}, ${where.toLowerCase()} sha256 ${actual}); the original was not deleted.`
    );
}

/**
 * Read the archive copy back and require the original's exact bytes.
 *
 * The copy is downloaded and hashed rather than trusted by its reported
 * `digest`: the digest is GitHub's claim about the bytes, and the only copy of
 * a file is about to be deleted on the strength of this check. When a digest
 * is reported it must agree as well.
 */
function confirmCopy(gh, candidate, copy, sha) {
  const readBack = gh.asset(copy.id);
  if (readBack?.name !== candidate.name || readBack.state !== "uploaded")
    throw new EvidencePruneError(
      `The archive copy of ${candidate.name} cannot be read back as an uploaded file; the original was not deleted.`
    );
  requireSame(
    candidate.name,
    sha,
    hashBytes(gh.download(readBack)),
    "The archive copy"
  );
  const reported = reportedSha256(readBack);
  if (reported)
    requireSame(candidate.name, sha, reported, "The archive copy's digest");
}

/** The state after leaving one candidate where it is, with the reason. */
function skip(state, candidate, reason) {
  return {
    ...state,
    skipped: [...state.skipped, { name: candidate.name, reason }],
  };
}

/** Pins with every record published since the last read folded in. */
function repin(ctx, state) {
  const fresh = ctx.rescan(state.known);
  return {
    ...state,
    pins: mergePins(state.pins, collectPins(fresh.records)),
    known: new Set([...state.known, ...fresh.ids]),
  };
}

/** Delete the original; a failure here leaves a confirmed archive copy. */
function removeOriginal(ctx, state, candidate) {
  try {
    ctx.gh.remove(candidate);
    return { ...state, archived: [...state.archived, candidate.name] };
  } catch (error) {
    return {
      ...state,
      archivedNotDeleted: [...state.archivedNotDeleted, candidate.name],
      error: error.message,
    };
  }
}

/**
 * Archive one candidate, confirm it, re-check its pins, then delete it.
 * @param {object} ctx - Run context: `gh`, `archive`, `held`, `tag`,
 *   `release` and `rescan`.
 * @param {object} state - Outcome so far, archive count and current pins.
 * @param {object} candidate - The file to move.
 * @returns {object} The next state.
 */
function archiveStep(ctx, state, candidate) {
  const { gh, held, tag, release } = ctx;
  const prior = held.get(candidate.name);
  // An interrupted upload leaves an asset GitHub never finished; it cannot be
  // hashed or replaced, and deleting it is the operator's call, not ours.
  if (prior && prior.state !== "uploaded")
    throw new EvidencePruneError(
      `${candidate.name} in ${tag} is a half-finished upload (state ${JSON.stringify(prior.state)}); delete it from ${tag} and re-run.`
    );
  if (!prior && state.count >= EVIDENCE_RELEASE_NEAR_FULL)
    throw new EvidencePruneError(nearlyFullMessage(tag));
  const bytes = gh.download(candidate);
  const sha = hashBytes(bytes);
  if (candidate.sha256)
    requireSame(candidate.name, candidate.sha256, sha, "The download");
  // post-evidence.sh reuses names such as `pr-<N>-<file>` with --clobber, so a
  // same-named archive file may be a different file, not an earlier copy.
  if (prior && gh.sha256(prior) !== sha)
    return skip(
      state,
      candidate,
      `a different file named ${candidate.name} is already in ${tag}; kept in ${release}`
    );
  const copy = prior ?? gh.upload(ctx.archive, candidate.name, bytes);
  confirmCopy(gh, candidate, copy, sha);
  const next = repin(ctx, { ...state, count: state.count + (prior ? 0 : 1) });
  if (isPinned(next.pins, candidate.id, sha))
    return skip(
      next,
      candidate,
      `${candidate.name}: a completion record published during this run now depends on it; kept in ${release}, and its archive copy stays in ${tag}`
    );
  return removeOriginal(ctx, next, candidate);
}

/** One reducer step: nothing more happens once a step has failed. */
function step(ctx, state, candidate) {
  if (state.error) return state;
  try {
    return archiveStep(ctx, state, candidate);
  } catch (error) {
    return { ...state, error: error.message };
  }
}

/**
 * Archive and delete every candidate in order, stopping at the first failure.
 * @param {object} gh - The prune's GitHub operations.
 * @param {object[]} candidates - The plan's ordered candidates.
 * @param {object} target - Archive selection and pin sources.
 * @param {string} target.tag - Archive release tag.
 * @param {string} target.branch - Default branch the archive is created from.
 * @param {string} target.release - The release being pruned.
 * @param {object} target.pins - Pins from the snapshot's records.
 * @param {Set<number>} target.known - Record asset ids already read.
 * @param {Function} target.rescan - Reads records published since `known`.
 * @returns {object} `archived`, `archivedNotDeleted`, `skipped`,
 *   `notArchived` and `error`.
 */
export function applyPrune(gh, candidates, target) {
  const start = {
    archived: [],
    archivedNotDeleted: [],
    skipped: [],
    error: null,
    pins: target.pins,
    known: target.known,
  };
  const outcome = (() => {
    if (candidates.length === 0) return start;
    try {
      const archive = openArchive(gh, target.tag, target.branch);
      const listed = gh.assets(archive);
      const ctx = {
        ...target,
        gh,
        archive,
        held: new Map(listed.map(asset => [asset.name, asset])),
      };
      return candidates.reduce(
        (state, candidate) => step(ctx, state, candidate),
        {
          ...start,
          count: listed.length,
        }
      );
    } catch (error) {
      return { ...start, error: error.message };
    }
  })();
  const handled = new Set([
    ...outcome.archived,
    ...outcome.archivedNotDeleted,
    ...outcome.skipped.map(row => row.name),
  ]);
  return {
    archived: outcome.archived,
    archivedNotDeleted: outcome.archivedNotDeleted,
    skipped: outcome.skipped,
    notArchived: candidates
      .map(row => row.name)
      .filter(name => !handled.has(name)),
    error: outcome.error,
  };
}
