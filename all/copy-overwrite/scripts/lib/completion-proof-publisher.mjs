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
  githubProofTransport,
  targetEvidenceRelease,
} from "./completion-proof-github.mjs";
import {
  ensureEvidenceRelease,
  excerpt,
  fullReleaseMessage,
  releaseAssets,
  uploadHitLimit,
} from "./evidence-release-capacity.mjs";
import { completionRecordId } from "./completion-proof-reader.mjs";
import { evaluateAcceptedRecord } from "./completion-authorization.mjs";

const READ_ERROR = "read-error";
const WRITE_ERROR = "write-error";

export { ensureEvidenceRelease };

/** The exact bytes a record is published as; one serializer, everywhere. */
function recordBytes(record) {
  return Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
}

/**
 * This record, stamped with a stored asset's `captured_at`, when that makes
 * it byte-identical to the stored bytes and a well-formed record; else null.
 * @param {object} record - The record this publish built.
 * @param {Buffer} stored - A candidate asset's bytes.
 * @returns {{record: object, bytes: Buffer}|null} The adoptable record.
 */
function identicalRecord(record, stored) {
  let adopted;
  try {
    adopted = { ...record, captured_at: JSON.parse(stored).captured_at };
    // A missing or malformed captured_at is not a record this publisher
    // could have written; never adopt it.
    validateRecordShape(adopted);
  } catch {
    return null;
  }
  const bytes = recordBytes(adopted);
  return bytes.equals(stored) ? { record: adopted, bytes } : null;
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
 * exact same bytes, that asset is adopted.
 *
 * Every release the capacity check opened is searched, not only the one the
 * upload would go to: the stranded upload may itself have filled a release
 * and pushed this run on to its overflow release (CodySwannGT/lisa#4838). A
 * candidate read that fails (after the transport's retries) refuses, rather
 * than uploading a duplicate. The caller's readback and trust checks still
 * run on the adopted asset, in the release that holds it.
 * @param {object} transport - The bounded GitHub proof transport.
 * @param {object[]} releases - Opened releases, each with its `assets`.
 * @param {object} record - The record this publish built.
 * @param {number} publisher - The native publisher identity.
 * @returns {{record: object, bytes: Buffer, evidence: object}|null} The
 *   adopted record and the release holding it, or null.
 */
function strandedRecord(transport, releases, record, publisher) {
  const prefix = `${record.record_id}-r${record.revision}-`;
  for (const evidence of releases) {
    for (const candidate of evidence.assets ?? []) {
      if (
        !candidate.name?.startsWith(prefix) ||
        candidate.uploader?.id !== publisher
      )
        continue;
      const stored = transport.asset(candidate.id, MAX_RECORD_BYTES).bytes;
      const adopted = identicalRecord(record, stored);
      if (adopted) return { ...adopted, evidence };
    }
  }
  return null;
}

/** Upload one file to a release; the failure's diagnostics, or null on success. */
function attemptUpload(context, transport, evidence, file) {
  const uploaded = context.run(
    "gh",
    ["release", "upload", evidence.tag, file, "--repo", context.repository],
    { allowFailure: true }
  );
  // probe-direction: fail-closed — null means only a zero exit with no spawn
  // error; every other outcome returns the failure and the caller refuses.
  if (uploaded.status === 0 && !uploaded.error) return null;
  const stderr = uploaded.stderr ?? "";
  return { stderr, full: uploadHitLimit(stderr, transport, evidence.release) };
}

/**
 * Upload the record to the checked release, rolling over once to the next
 * overflow release when GitHub reports the release full mid-upload (another
 * publisher filled it after the capacity check). A pinned release is refused
 * instead, as it is before the upload (CodySwannGT/lisa#4838).
 * @param {object} context - The canonical publish context.
 * @param {object} transport - The bounded GitHub proof transport.
 * @param {{tag: string, pinned: boolean}} target - The resolved release.
 * @param {object} checked - The release the capacity check chose.
 * @param {string} file - The record file to upload.
 * @returns {object} The release the record now lives in.
 */
function uploadProof(context, transport, target, checked, file) {
  let evidence = checked;
  let failure = attemptUpload(context, transport, evidence, file);
  if (failure && failure.full !== false && !target.pinned) {
    evidence = ensureEvidenceRelease(context.run, transport, context.policy, {
      tag: target.tag,
      pinned: target.pinned,
      from: evidence.index + 1,
    });
    failure = attemptUpload(context, transport, evidence, file);
  }
  if (!failure) return evidence;
  const reason = excerpt(failure.stderr);
  throw new CompletionProofError(
    WRITE_ERROR,
    failure.full === false
      ? `Immutable completion-proof upload failed; no acceptance locator was published.${reason ? ` GitHub said: ${reason}` : ""}`
      : fullReleaseMessage(
          evidence.tag,
          context.repository,
          failure.full ?? undefined,
          { pinned: target.pinned, policy: context.policy }
        )
  );
}

/**
 * Write the record's bytes to a temporary file named for its asset and upload
 * it; the temporary file is always removed.
 * @returns {object} The release the record now lives in.
 */
function uploadRecord(context, transport, target, checked, name, bytes) {
  const temporary = mkdtempSync(join(tmpdir(), "lisa-completion-proof-"));
  try {
    mkdirSync(temporary, { recursive: true });
    const file = join(temporary, name);
    writeFileSync(file, bytes);
    return uploadProof(context, transport, target, checked, file);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
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
  // Resolved first, so an invalid LISA_EVIDENCE_RELEASE is refused before any
  // read or write, exactly as `evidence-release` refuses it (#4838).
  const target =
    context.evidenceTarget ?? targetEvidenceRelease(context.policy);
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
  const checked = ensureEvidenceRelease(
    context.run,
    transport,
    context.policy,
    { tag: target.tag, pinned: target.pinned }
  );
  const adopted = strandedRecord(
    transport,
    [checked, ...(checked.passed ?? [])],
    record,
    publisher
  );
  const published = adopted ?? { record, bytes: recordBytes(record) };
  const digest = sha256(published.bytes);
  const name = `${recordId}-r${record.revision}-${digest}.json`;
  const evidence =
    adopted?.evidence ??
    uploadRecord(context, transport, target, checked, name, published.bytes);
  return locateRecord(context, transport, {
    record: published.record,
    bytes: published.bytes,
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
