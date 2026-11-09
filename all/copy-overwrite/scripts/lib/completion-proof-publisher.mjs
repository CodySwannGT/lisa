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
  MAX_NATIVE_JSON_BYTES,
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
 * @returns {{tag: string, release: object, count: number}} The usable release.
 */
export function ensureEvidenceRelease(run, transport, policy, options = {}) {
  const tag =
    options.tag ?? resolveEvidenceRelease(policy, options.now ?? new Date());
  let release = readRelease(run, transport, tag);
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
    release = readRelease(run, transport, tag);
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
  return { tag, release, count: assets.length };
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
  const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
  requireProof(
    bytes.length <= MAX_RECORD_BYTES,
    "The completion record exceeds its bounded publication size."
  );
  const digest = sha256(bytes);
  const name = `${recordId}-r${record.revision}-${digest}.json`;
  const evidence = ensureEvidenceRelease(
    context.run,
    transport,
    context.policy
  );
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
    if (uploaded.status !== 0 || uploaded.error) {
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
    }
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
      record_id: recordId,
      revision: record.revision,
      repository: context.repository,
      asset_id: stored.metadata.id,
      sha256: digest,
    };
    const body = `${PROOF_MARKER}\n${JSON.stringify(locator)}`;
    const comment = context.postLocator(body, subject.native_id);
    const readback = context
      .readComments()
      .find(row => String(row.id) === String(comment.id));
    requireProof(
      readback?.body === body &&
        String((readback.user ?? readback.author)?.id) === trackerActor,
      "The native completion locator or publisher did not read back exactly.",
      WRITE_ERROR
    );
    const deferredProducer = !publisherState.ready;
    return {
      category: deferredProducer ? "published/pending-producer" : "published",
      record_id: recordId,
      revision: record.revision,
      asset_id: stored.metadata.id,
      sha256: digest,
      comment_id: comment.id,
      ref: context.ref,
      terminal_mutation: false,
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
