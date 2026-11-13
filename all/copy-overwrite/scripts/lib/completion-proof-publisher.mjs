// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Publish accepted/pending/revoked proof without performing a terminal transition. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CompletionProofError,
  PROOF_KIND,
  PROOF_MARKER,
  MAX_RECORD_BYTES,
  sha256,
  primarySpecProjection,
  requireProof,
  validateRecordShape,
  parseLocator,
  isId,
} from "./completion-proof-shape.mjs";
import {
  EVIDENCE_RELEASE_ASSET_LIMIT,
  EVIDENCE_RELEASE_NEAR_FULL,
  githubProofTransport,
  resolveEvidenceRelease,
} from "./completion-proof-github.mjs";
import { completionRecordId } from "./completion-proof-reader.mjs";
import { evaluateAcceptedRecord } from "./completion-authorization.mjs";

const READ_ERROR = "read-error";
const WRITE_ERROR = "write-error";

/** The operator-readable refusal for a release GitHub will not take more files in. */
function fullReleaseMessage(tag, repository, count) {
  const held =
    count === undefined
      ? `is at GitHub's ${EVIDENCE_RELEASE_ASSET_LIMIT}-file limit`
      : `holds ${count} of GitHub's ${EVIDENCE_RELEASE_ASSET_LIMIT}-file limit`;
  return `The evidence release \`${tag}\` in ${repository} ${held}, so new proof can't be uploaded. Set \`verification.completion.evidenceRelease\` in .lisa.config.json to a rotating name such as \`pr-assets-{YYYY-MM}\` (older proof keeps validating), or prune old evidence (CodySwannGT/lisa#4720).`;
}

/** The last few lines of a native CLI's diagnostics, bounded for a message. */
function excerpt(stderr) {
  const text = String(stderr ?? "").trim();
  return text.length > 400 ? `…${text.slice(-400)}` : text;
}

/**
 * Read a release by tag; `null` only for GitHub's explicit 404. Any other
 * failure is retried when transient and then reported as a read error naming
 * the release endpoint, instead of guessing the release is absent and
 * creating it (CodySwannGT/lisa#4733).
 */
function readRelease(transport, tag) {
  return transport.optionalJson(`${transport.root}/releases/tags/${tag}`);
}

/**
 * Whether a failed upload means the release is full. GitHub's 422 also covers
 * an asset name that already exists, so a bare 422 is not enough: the error
 * has to name the limit, or a fresh count has to show the release at it.
 */
function uploadHitLimit(stderr, transport, release) {
  if (/asset[^\n]*limit|limit[^\n]*asset/i.test(stderr)) return null;
  if (!/HTTP 422/.test(stderr)) return false;
  const count = releaseAssets(transport, release).length;
  return count + 1 >= EVIDENCE_RELEASE_ASSET_LIMIT ? count : false;
}

/**
 * Resolve the configured evidence release, create it when absent, and refuse
 * before uploading when it is nearly full.
 *
 * GitHub caps a release at 1000 assets and then answers every upload with a
 * raw HTTP 422. A single hardcoded `pr-assets` release filled in days on a busy
 * host and stopped every completion (CodySwannGT/lisa#4692); the refusal here
 * tells the operator what to change instead.
 * @param {Function} run - The canonical child-process runner.
 * @param {object} transport - The bounded GitHub proof transport.
 * @param {object} [policy] - `verification.completion` from the Lisa config.
 * @param {object} [options] - Optional resolution inputs.
 * @param {Date} [options.now] - Resolution time for a `{YYYY-MM}` template.
 * @param {string} [options.tag] - An already-validated concrete tag to use.
 * @returns {{tag: string, release: object, count: number, assets: object[]}}
 *   The usable release and the assets it held when checked.
 */
export function ensureEvidenceRelease(run, transport, policy, options = {}) {
  const tag =
    options.tag ?? resolveEvidenceRelease(policy, options.now ?? new Date());
  let release = readRelease(transport, tag);
  if (!release) {
    // A concurrent creator may win; the re-read below decides either way.
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
        "Evidence storage only — not a product release. Completion-proof and verification evidence assets, managed by Lisa.",
        "--latest=false",
      ],
      { allowFailure: true }
    );
    release = readRelease(transport, tag);
    const reason = excerpt(created.stderr);
    requireProof(
      release,
      `The evidence release \`${tag}\` does not exist in ${transport.repository} and could not be created; check that the publisher can create releases there.${reason ? ` GitHub said: ${reason}` : ""}`,
      WRITE_ERROR
    );
  }
  const assets = releaseAssets(transport, release);
  if (assets.length >= EVIDENCE_RELEASE_NEAR_FULL)
    throw new CompletionProofError(
      WRITE_ERROR,
      fullReleaseMessage(tag, transport.repository, assets.length)
    );
  return { tag, release, count: assets.length, assets };
}

/** The exact bytes a record is published as; one serializer, everywhere. */
function recordBytes(record) {
  return Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
}

/**
 * The record this publish would upload, if an earlier run already uploaded it.
 *
 * A run that dies after `gh release upload` but before posting its locator
 * leaves the record in the release with nothing pointing at it. The re-run
 * computes the same revision, but its fresh `captured_at` gives it a different
 * digest and so a different asset name, and it used to upload a second copy
 * (CodySwannGT/lisa#4733). Each same-revision asset this publisher uploaded is
 * read back; if this record, stamped with that asset's `captured_at`, has the
 * exact same bytes, that asset is adopted. A candidate read that fails (after
 * the transport's retries) refuses, rather than uploading a duplicate. The
 * caller's post-upload readback and trust checks still run on the adopted
 * asset.
 * @param {object} transport - The bounded GitHub proof transport.
 * @param {object[]} assets - The release's assets.
 * @param {object} record - The record this publish built.
 * @param {number} publisher - The native publisher identity.
 * @returns {{record: object, bytes: Buffer}|null} The adopted record, or null.
 */
function strandedRecord(transport, assets, record, publisher) {
  const prefix = `${record.record_id}-r${record.revision}-`;
  for (const candidate of assets) {
    if (
      !candidate.name?.startsWith(prefix) ||
      candidate.uploader?.id !== publisher
    )
      continue;
    const stored = transport.asset(candidate.id, MAX_RECORD_BYTES).bytes;
    let capturedAt;
    try {
      capturedAt = JSON.parse(stored.toString("utf8")).captured_at;
    } catch {
      continue;
    }
    const adopted = { ...record, captured_at: capturedAt };
    const bytes = recordBytes(adopted);
    if (bytes.equals(stored)) return { record: adopted, bytes };
  }
  return null;
}

/**
 * Upload a record's bytes as one immutable release asset, naming GitHub's
 * reason (or a full release) when it refuses.
 * @param {object} context - The canonical publish context.
 * @param {object} transport - The bounded GitHub proof transport.
 * @param {object} evidence - The usable release from ensureEvidenceRelease.
 * @param {string} name - The asset name.
 * @param {Buffer} bytes - The record bytes.
 */
function uploadRecord(context, transport, evidence, name, bytes) {
  const temporary = mkdtempSync(join(tmpdir(), "lisa-completion-proof-"));
  try {
    mkdirSync(temporary, { recursive: true });
    const file = join(temporary, name);
    writeFileSync(file, bytes);
    const uploaded = context.run(
      "gh",
      ["release", "upload", evidence.tag, file, "--repo", context.repository],
      { allowFailure: true }
    );
    if (uploaded.status === 0 && !uploaded.error) return;
    const stderr = uploaded.stderr ?? "";
    const full = uploadHitLimit(stderr, transport, evidence.release);
    const reason = excerpt(stderr);
    throw new CompletionProofError(
      WRITE_ERROR,
      full === false
        ? `Immutable completion-proof upload failed; no acceptance locator was published.${reason ? ` GitHub said: ${reason}` : ""}`
        : fullReleaseMessage(
            evidence.tag,
            context.repository,
            full ?? undefined
          )
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

/** Every asset on a release, from the complete paginated native listing. */
function releaseAssets(transport, release) {
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

/** Recover the monotonic native index without treating old malformed proof as valid. */
function previousLocator(
  context,
  comments,
  transport,
  repositoryId,
  recordId,
  trackerActor
) {
  const candidates = [];
  for (const comment of comments) {
    if (!comment.body?.startsWith(`${PROOF_MARKER}\n`)) continue;
    const actor = comment.user ?? comment.author;
    if (
      context.provider === "github"
        ? !transport.eligibleCommentAuthor(actor, repositoryId)
        : String(actor?.id) !== trackerActor
    )
      continue;
    let locator;
    try {
      locator = parseLocator(comment.body);
    } catch {
      continue;
    }
    if (
      locator.repository === context.repository &&
      locator.record_id === recordId
    )
      candidates.push(locator);
  }
  candidates.sort((left, right) => right.revision - left.revision);
  return candidates[0] ?? null;
}

/** A candidate bot id is only a hint until native upload metadata confirms it. */
function publisherIdentity(context, input, transport, repository) {
  try {
    const actor = JSON.parse(transport.call(["api", "user"]));
    requireProof(
      isId(actor.id) && actor.type === "User",
      "The native publisher identity is unsupported."
    );
    return actor.id;
  } catch (error) {
    const id = input.producer?.github_actor_id;
    const configured = (context.policy.automationPublishers ?? []).some(
      row =>
        row.user_id === id &&
        row.repository_id === repository.id &&
        row.type === "Bot"
    );
    if (!configured) {
      const refusal = new CompletionProofError(
        READ_ERROR,
        "The publisher identity is unreadable and no explicit repository automation identity was configured."
      );
      refusal.cause = error;
      throw refusal;
    }
    return id;
  }
}

/** Strict immutable publication, followed by exact native readback and locator. */
export function publishCompletionProof(context, input) {
  const transport = githubProofTransport(
    context.run,
    context.repository,
    context.policy
  );
  const repository = transport.json(transport.root);
  const subject = {
    ...context.readSubject(),
    comments: context.readComments(),
  };
  const publisher = publisherIdentity(context, input, transport, repository);
  const trackerActor = context.trackerActor(publisher);
  requireProof(
    trackerActor && trackerActor !== "undefined",
    "The native tracker publisher identity could not be established."
  );
  const identity = {
    provider: context.provider,
    ref: context.ref,
    scope: context.scope,
    native_id: subject.native_id,
  };
  const recordId = completionRecordId(identity);
  const previous = previousLocator(
    context,
    subject.comments,
    transport,
    repository.id,
    recordId,
    trackerActor
  );
  const record = {
    ...input,
    schema_version: 1,
    kind: PROOF_KIND,
    record_id: recordId,
    revision: previous ? previous.revision + 1 : 1,
    supersedes: previous?.sha256 ?? null,
    captured_at: new Date().toISOString(),
    subject: identity,
    producer: {
      ...input.producer,
      github_actor_id: publisher,
      tracker_actor_id: trackerActor,
    },
    repository: { name: context.repository, id: repository.id },
    environment: context.environment,
    branch: context.branch,
    spec_sha256: sha256(primarySpecProjection(subject.body)),
  };
  validateRecordShape(record);
  if (record.state === "accepted-for-completion")
    evaluateAcceptedRecord({ record }, context, subject, transport);
  // Refuse an oversized record before any write, such as creating a release.
  requireProof(
    recordBytes(record).length <= MAX_RECORD_BYTES,
    "The completion record exceeds its bounded publication size."
  );
  const evidence = ensureEvidenceRelease(
    context.run,
    transport,
    context.policy
  );
  const adopted = strandedRecord(transport, evidence.assets, record, publisher);
  const published = adopted ?? { record, bytes: recordBytes(record) };
  const digest = sha256(published.bytes);
  const name = `${recordId}-r${record.revision}-${digest}.json`;
  if (!adopted)
    uploadRecord(context, transport, evidence, name, published.bytes);
  return locateRecord(context, transport, {
    ...published,
    evidence,
    name,
    digest,
    publisher,
    trackerActor,
    nativeId: subject.native_id,
  });
}

/**
 * Read the uploaded (or adopted) record back exactly, re-run every trust and
 * acceptance check against it, and only then post and read back its locator.
 * @param {object} context - The canonical publish context.
 * @param {object} transport - The bounded GitHub proof transport.
 * @param {object} published - The record, its bytes, asset name and digest,
 *   the release, the publisher and tracker identities, and the subject id.
 * @returns {object} The publication result.
 */
function locateRecord(context, transport, published) {
  const { record, bytes, evidence, name, digest, publisher } = published;
  const matching = releaseAssets(transport, evidence.release).filter(
    asset => asset.name === name
  );
  requireProof(
    matching.length === 1,
    "The uploaded completion asset cannot be uniquely read back.",
    READ_ERROR
  );
  const stored = transport.asset(matching[0].id, MAX_RECORD_BYTES);
  requireProof(
    stored.bytes.equals(bytes) &&
      sha256(stored.bytes) === digest &&
      stored.metadata.uploader?.id === publisher,
    "The native uploaded acceptance bytes or publisher differ from the producer's record."
  );
  const publisherState = transport.trustedPublisher(stored.metadata, record, {
    publishing: true,
  });
  // Recheck native scope after upload; do not publish acceptance for changed requirements.
  const fresh = {
    ...context.readSubject(),
    comments: context.readComments(),
  };
  requireProof(
    sha256(primarySpecProjection(fresh.body)) === record.spec_sha256,
    "Requirements changed during proof publication; no locator was written.",
    "pending-proof"
  );
  if (record.state === "accepted-for-completion")
    evaluateAcceptedRecord({ record }, context, fresh, transport);
  const locator = {
    schema_version: 1,
    record_id: record.record_id,
    revision: record.revision,
    repository: context.repository,
    asset_id: stored.metadata.id,
    sha256: digest,
  };
  const body = `${PROOF_MARKER}\n${JSON.stringify(locator)}`;
  const comment = context.postLocator(body, published.nativeId);
  const readback = context
    .readComments()
    .find(row => String(row.id) === String(comment.id));
  requireProof(
    readback?.body === body &&
      String((readback.user ?? readback.author)?.id) === published.trackerActor,
    "The native completion locator or publisher did not read back exactly.",
    WRITE_ERROR
  );
  return {
    category: publisherState.ready ? "published" : "published/pending-producer",
    record_id: record.record_id,
    revision: record.revision,
    asset_id: stored.metadata.id,
    sha256: digest,
    comment_id: comment.id,
    ref: context.ref,
    terminal_mutation: false,
  };
}
