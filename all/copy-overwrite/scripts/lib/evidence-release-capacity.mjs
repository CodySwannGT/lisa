// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Find, create and capacity-check the GitHub release new evidence goes to,
 * rolling a full release over to its next overflow release.
 *
 * GitHub caps a release at 1000 assets and then answers every upload with a
 * raw HTTP 422. A single hardcoded `pr-assets` release filled in days on a busy
 * host (CodySwannGT/lisa#4692); rotating it monthly was not enough either, as a
 * monthly release then filled in under two weeks and no work item could
 * complete until the month turned (CodySwannGT/lisa#4838). So a full resolved
 * release rolls over to `<release>-2`, `-3`, … each created and checked the
 * same way, and the validator accepts those names. A release pinned with
 * `LISA_EVIDENCE_RELEASE` is an exact choice and never rolls over. Nothing is
 * ever deleted here.
 */
import {
  CompletionProofError,
  MAX_NATIVE_JSON_BYTES,
  requireProof,
} from "./completion-proof-shape.mjs";
import {
  EVIDENCE_RELEASE_ASSET_LIMIT,
  EVIDENCE_RELEASE_MAX_OVERFLOW,
  EVIDENCE_RELEASE_NEAR_FULL,
  overflowReleaseTag,
  resolveEvidenceRelease,
  usableTag,
} from "./completion-proof-github.mjs";

const READ_ERROR = "read-error";
const WRITE_ERROR = "write-error";
const NOTES =
  "Evidence storage only — not a product release. Completion-proof and verification evidence assets, managed by Lisa.";

/** How the count reads in a refusal; unknown when GitHub only named the limit. */
function held(count) {
  return count === undefined
    ? `is at GitHub's ${EVIDENCE_RELEASE_ASSET_LIMIT}-file limit`
    : `holds ${count} of GitHub's ${EVIDENCE_RELEASE_ASSET_LIMIT}-file limit`;
}

/**
 * What an operator can do about a full release. Suggesting rotation to a
 * project that already rotates is noise, so it leads with pruning then.
 */
function fullReleaseAdvice(policy, tag) {
  const prune = `prune old evidence with \`node scripts/lisa-evidence-prune.mjs --release ${tag}\` (CodySwannGT/lisa#4720)`;
  return String(policy?.evidenceRelease ?? "").includes("{YYYY-MM}")
    ? `To make room, ${prune}; next month's release starts empty.`
    : `Set \`verification.completion.evidenceRelease\` in .lisa.config.json to a rotating name such as \`pr-assets-{YYYY-MM}\` (older proof keeps validating), or ${prune}.`;
}

/**
 * The operator-readable refusal for a release GitHub will not take more files in.
 * @param {string} tag - The full release.
 * @param {string} repository - `owner/name`.
 * @param {number} [count] - Its asset count, when known.
 * @param {object} [options] - How the release was chosen.
 * @param {boolean} [options.pinned] - Whether `LISA_EVIDENCE_RELEASE` chose it.
 * @param {object} [options.policy] - `verification.completion`, for the advice.
 * @returns {string} The refusal.
 */
export function fullReleaseMessage(tag, repository, count, options = {}) {
  if (options.pinned)
    return `The evidence release \`${tag}\` that LISA_EVIDENCE_RELEASE pins in ${repository} ${held(count)}, so new proof can't be uploaded. A pinned release is an exact choice and never rolls over: unset LISA_EVIDENCE_RELEASE so Lisa moves to an overflow release with room, or pin a release that has room.`;
  return `The evidence release \`${tag}\` in ${repository} ${held(count)}, so new proof can't be uploaded. ${fullReleaseAdvice(options.policy, tag)}`;
}

/** The refusal once every overflow release of a period is full. */
function exhaustedMessage(base, repository, policy) {
  const last = overflowReleaseTag(base, EVIDENCE_RELEASE_MAX_OVERFLOW);
  return `Every evidence release from \`${base}\` to \`${last}\` in ${repository} holds ${EVIDENCE_RELEASE_NEAR_FULL} or more of GitHub's ${EVIDENCE_RELEASE_ASSET_LIMIT}-file limit, so new proof can't be uploaded. ${fullReleaseAdvice(policy, base)}`;
}

/**
 * The last few lines of a native CLI's diagnostics, bounded for a message.
 * @param {string} [stderr] - Raw diagnostics.
 * @returns {string} At most the last 400 characters.
 */
export function excerpt(stderr) {
  const text = String(stderr ?? "").trim();
  return text.length > 400 ? `…${text.slice(-400)}` : text;
}

/**
 * Read a release by tag in one call; `null` only for GitHub's explicit 404.
 * Any other failure goes through the bounded transport, which reports it as a
 * read error instead of guessing the release is absent and creating it.
 */
function readRelease(run, transport, tag) {
  const path = `${transport.root}/releases/tags/${tag}`;
  const result = run("gh", ["api", path], {
    allowFailure: true,
    maxBuffer: MAX_NATIVE_JSON_BYTES,
  });
  if (result.status === 0 && !result.error) {
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new CompletionProofError(
        READ_ERROR,
        "The evidence release metadata is not complete JSON."
      );
    }
  }
  if (/HTTP 404/.test(result.stderr ?? "")) return null;
  return transport.json(path);
}

/**
 * Every asset on a release, from the complete paginated native listing.
 * @param {object} transport - The bounded GitHub proof transport.
 * @param {{id: number}} release - Native release metadata.
 * @returns {object[]} Every asset.
 */
export function releaseAssets(transport, release) {
  const pages = transport.json(
    `${transport.root}/releases/${release.id}/assets?per_page=100`,
    true
  );
  requireProof(
    pages.every(Array.isArray),
    "The native completion-asset listing is incomplete.",
    READ_ERROR
  );
  return pages.flat();
}

/**
 * Whether a failed upload means the release is full. GitHub's 422 also covers
 * an asset name that already exists, so a bare 422 is not enough: the error
 * has to name the limit, or a fresh count has to show the release at it.
 * @param {string} stderr - The failed upload's diagnostics.
 * @param {object} transport - The bounded GitHub proof transport.
 * @param {{id: number}} release - The release uploaded to.
 * @returns {number|null|false} The fresh count when it shows the release at
 *   the limit, `null` when GitHub named the limit, `false` when not full.
 */
export function uploadHitLimit(stderr, transport, release) {
  if (/asset[^\n]*limit|limit[^\n]*asset/i.test(stderr)) return null;
  if (!/HTTP 422/.test(stderr)) return false;
  const count = releaseAssets(transport, release).length;
  return count + 1 >= EVIDENCE_RELEASE_ASSET_LIMIT ? count : false;
}

/** A release by tag, created when absent; a concurrent creator may win. */
function openRelease(run, transport, tag) {
  let release = readRelease(run, transport, tag);
  if (!release) {
    const created = run(
      "gh",
      [
        "release",
        "create",
        tag,
        "--repo",
        transport.repository,
        "--title",
        `Lisa evidence ${tag}`,
        "--notes",
        NOTES,
        "--latest=false",
      ],
      { allowFailure: true }
    );
    release = readRelease(run, transport, tag);
    const reason = excerpt(created.stderr);
    requireProof(
      release,
      `The evidence release \`${tag}\` does not exist in ${transport.repository} and could not be created; check that the publisher can create releases there.${reason ? ` GitHub said: ${reason}` : ""}`,
      WRITE_ERROR
    );
  }
  return { tag, release, count: releaseAssets(transport, release).length };
}

/**
 * Resolve the evidence release, create it when absent, and refuse or roll
 * over before uploading when it is nearly full.
 * @param {Function} run - The canonical child-process runner.
 * @param {object} transport - The bounded GitHub proof transport.
 * @param {object} [policy] - `verification.completion` from the Lisa config.
 * @param {object} [options] - Optional resolution inputs.
 * @param {Date} [options.now] - Resolution time for a `{YYYY-MM}` template.
 * @param {string} [options.tag] - An already-validated concrete tag to use.
 * @param {boolean} [options.pinned] - The tag is an exact choice: refuse it
 *   when full instead of rolling over.
 * @param {number} [options.from] - The overflow position to start at; 1 (the
 *   tag itself) by default, higher after an upload found a release full.
 * @returns {{tag: string, release: object, count: number, index: number}} The
 *   usable release and its overflow position.
 */
export function ensureEvidenceRelease(run, transport, policy, options = {}) {
  const base =
    options.tag ?? resolveEvidenceRelease(policy, options.now ?? new Date());
  if (options.pinned) {
    const pinned = openRelease(run, transport, base);
    if (pinned.count >= EVIDENCE_RELEASE_NEAR_FULL)
      throw new CompletionProofError(
        WRITE_ERROR,
        fullReleaseMessage(base, transport.repository, pinned.count, {
          pinned: true,
        })
      );
    return { ...pinned, index: 1 };
  }
  let last = { tag: base, count: undefined };
  for (
    let index = options.from ?? 1;
    index <= EVIDENCE_RELEASE_MAX_OVERFLOW;
    index += 1
  ) {
    const tag = overflowReleaseTag(base, index);
    if (!usableTag(tag))
      throw new CompletionProofError(
        WRITE_ERROR,
        `${fullReleaseMessage(last.tag, transport.repository, last.count, { policy })} Lisa could not roll over to \`${tag}\`: the release name is too long for an overflow suffix (GitHub allows 100 characters), so shorten \`verification.completion.evidenceRelease\`.`
      );
    last = openRelease(run, transport, tag);
    if (last.count < EVIDENCE_RELEASE_NEAR_FULL) return { ...last, index };
  }
  throw new CompletionProofError(
    WRITE_ERROR,
    exhaustedMessage(base, transport.repository, policy)
  );
}
