// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Bounded native GitHub transport; no locator URL is executed or fetched. */
import {
  CompletionProofError,
  requireProof,
  isId,
  MAX_ATTACHMENT_BYTES,
  MAX_NATIVE_JSON_BYTES,
} from "./completion-proof-shape.mjs";

const READ_ERROR = "read-error";
const INVALID_CONFIG = "invalid-config";

/**
 * Lisa's historical evidence release. Always accepted, so every proof published
 * before a project rotated its release keeps validating.
 */
export const LEGACY_EVIDENCE_RELEASE = "pr-assets";
/** GitHub refuses the next asset once a release holds this many. */
export const EVIDENCE_RELEASE_ASSET_LIMIT = 1000;
/**
 * Publication refuses at this count, before GitHub's raw HTTP 422, so the
 * operator reads what to change instead of an opaque upload failure (#4692).
 */
export const EVIDENCE_RELEASE_NEAR_FULL = 950;
const MONTH_TOKEN = "{YYYY-MM}";
const MONTH_PATTERN = "\\d{4}-(?:0[1-9]|1[0-2])";
const RELEASE_TAG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const RELEASE_KEY = "verification.completion.evidenceRelease";
const ACCEPTED_KEY = "verification.completion.acceptedEvidenceReleases";

/**
 * Whether a concrete name is a tag GitHub and git both accept: the character
 * set and length, and none of git's ref-name exclusions that the character set
 * still lets through (`..`, a trailing `.`, a `.lock` ending). Exported so the
 * evidence prune validates its archive release by the same rule (#4720).
 * @param {string} name - A concrete release name.
 * @returns {boolean} True when the name is a usable tag.
 */
export function usableTag(name) {
  return (
    RELEASE_TAG.test(name) &&
    !name.includes("..") &&
    !name.endsWith(".") &&
    !name.toLowerCase().endsWith(".lock")
  );
}

/** One configured release name or `{YYYY-MM}` template, validated as a tag. */
function releaseTemplate(value, key) {
  const resolved =
    typeof value === "string" ? value.split(MONTH_TOKEN).join("2000-01") : "";
  if (!usableTag(resolved))
    throw new CompletionProofError(
      INVALID_CONFIG,
      `\`${key}\` in .lisa.config.json is ${JSON.stringify(value)}, which is not a usable GitHub release name. Use letters, digits, ".", "_" or "-" (start with a letter or digit, at most 100 characters); the only placeholder allowed is ${MONTH_TOKEN}, for example \`pr-assets-${MONTH_TOKEN}\`.`
    );
  return value;
}

/** The release new evidence is written to, as configured (still a template). */
function configuredTemplate(policy) {
  const value = policy?.evidenceRelease;
  return value === undefined
    ? LEGACY_EVIDENCE_RELEASE
    : releaseTemplate(value, RELEASE_KEY);
}

/**
 * Every release name or template whose assets validate as completion proof:
 * the legacy release, the configured one, and any listed history.
 * @param {object} [policy] - `verification.completion` from the Lisa config.
 * @returns {string[]} Distinct accepted names and templates, legacy first.
 */
export function acceptedEvidenceReleases(policy = {}) {
  const history = policy?.acceptedEvidenceReleases ?? [];
  if (!Array.isArray(history))
    throw new CompletionProofError(
      INVALID_CONFIG,
      `\`${ACCEPTED_KEY}\` in .lisa.config.json must be a list of release names.`
    );
  return [
    ...new Set([
      LEGACY_EVIDENCE_RELEASE,
      configuredTemplate(policy),
      ...history.map((value, index) =>
        releaseTemplate(value, `${ACCEPTED_KEY}[${index}]`)
      ),
    ]),
  ];
}

/**
 * The exact release tag new evidence is published to.
 * @param {object} [policy] - `verification.completion` from the Lisa config.
 * @param {Date} [now] - Publication time; `{YYYY-MM}` is its UTC year-month.
 * @returns {string} Concrete GitHub release tag.
 */
export function resolveEvidenceRelease(policy = {}, now = new Date()) {
  return configuredTemplate(policy)
    .split(MONTH_TOKEN)
    .join(now.toISOString().slice(0, 7));
}

/**
 * A concrete release named for one run, such as `LISA_EVIDENCE_RELEASE`.
 *
 * Skill scripts resolve the release once and pass it to every step, so the
 * links a template generator writes and the uploads that follow agree even
 * across a month boundary. The name must still be a usable tag and one the
 * validator accepts, or evidence would land where proof cannot be read back.
 * @param {object} [policy] - `verification.completion` from the Lisa config.
 * @param {string} value - The concrete release name supplied for this run.
 * @param {string} [source] - What supplied it, for the refusal message.
 * @returns {string} The accepted concrete tag.
 */
export function evidenceReleaseOverride(
  policy,
  value,
  source = "LISA_EVIDENCE_RELEASE"
) {
  if (
    typeof value !== "string" ||
    !usableTag(value) ||
    !isAcceptedEvidenceRelease(policy, value)
  )
    throw new CompletionProofError(
      INVALID_CONFIG,
      `${source} is ${JSON.stringify(value)}, which is not one of this project's evidence releases (${acceptedEvidenceReleases(policy).join(", ")}). Unset it, or set it to the name \`node scripts/lisa-work-item.mjs evidence-release\` prints.`
    );
  return value;
}

/** An anchored pattern where only `{YYYY-MM}` varies; all else is literal. */
function templatePattern(template) {
  const literal = template
    .split(MONTH_TOKEN)
    .map(part => part.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&"));
  return new RegExp(`^${literal.join(MONTH_PATTERN)}$`);
}

/**
 * Whether a release tag holds evidence the validator accepts.
 * @param {object} [policy] - `verification.completion` from the Lisa config.
 * @param {string} tag - Release tag read from native asset metadata.
 * @returns {boolean} True for the legacy, configured or listed releases.
 */
export function isAcceptedEvidenceRelease(policy, tag) {
  return (
    typeof tag === "string" &&
    acceptedEvidenceReleases(policy).some(template =>
      templatePattern(template).test(tag)
    )
  );
}

/** `/<owner>/<repo>/releases/download/<tag>/<asset>`, and nothing nested. */
const DOWNLOAD_PATH = /^\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\/[^/]+$/;

/** The transport reuses the canonical CLI's deadline and failure boundary. */
export function githubProofTransport(run, repository, policy = {}) {
  requireProof(
    /^[\w.-]+\/[\w.-]+$/.test(repository),
    "The implementation repository is not canonical."
  );
  const root = `repos/${repository}`;
  function call(args, options = {}) {
    const maxBuffer = options.maxBuffer ?? MAX_NATIVE_JSON_BYTES;
    const result = run("gh", args, {
      allowFailure: true,
      maxBuffer,
      ...options,
    });
    if (
      result.status !== 0 ||
      result.error ||
      Buffer.byteLength(result.stdout ?? "") > maxBuffer
    )
      throw new CompletionProofError(
        READ_ERROR,
        "A required GitHub completion-proof read did not complete; restore repository access and retry canonical Verify/evidence."
      );
    return result.stdout;
  }
  function json(path, paginated = false) {
    requireProof(
      path.startsWith(`${root}/`) || path === root,
      "A completion read selected another repository."
    );
    const bytes = call(
      paginated ? ["api", "--paginate", "--slurp", path] : ["api", path]
    );
    try {
      const parsed = JSON.parse(bytes);
      if (paginated) {
        requireProof(
          Array.isArray(parsed) && parsed.length <= 100,
          "The required GitHub pagination is incomplete or exceeds its bound."
        );
      }
      return parsed;
    } catch (error) {
      if (error instanceof CompletionProofError) throw error;
      throw new CompletionProofError(
        READ_ERROR,
        "A required GitHub proof response is not complete JSON."
      );
    }
  }
  function trustedPublisher(
    asset,
    record,
    { publishing = false, identityOnly = false } = {}
  ) {
    requireProof(
      isId(asset.uploader?.id),
      "The proof asset has no native uploader identity."
    );
    if (asset.uploader.type === "User") {
      const user = json(
        `${root}/collaborators/${encodeURIComponent(asset.uploader.login)}/permission`
      );
      requireProof(
        user.user?.id === asset.uploader.id &&
          ["write", "maintain", "admin"].includes(user.permission),
        "The completion-proof publisher does not have repository write authority."
      );
      return { ready: true };
    }
    const allowed = policy.automationPublishers ?? [];
    const rule = allowed.find(
      row =>
        row.user_id === asset.uploader.id &&
        row.type === asset.uploader.type &&
        row.type === "Bot" &&
        row.repository_id === record.repository.id
    );
    requireProof(
      rule && isId(record.producer?.workflow_run_id),
      "The proof uploader is not an explicitly configured repository automation publisher."
    );
    requireProof(
      isId(record.producer.workflow_attempt),
      "The automation publisher attempt is not pinned."
    );
    const runInfo = json(
      `${root}/actions/runs/${record.producer.workflow_run_id}/attempts/${record.producer.workflow_attempt}`
    );
    requireProof(
      runInfo.repository?.id === rule.repository_id &&
        runInfo.workflow_id === rule.workflow_id &&
        runInfo.path === rule.workflow_path &&
        rule.events?.includes(runInfo.event) &&
        runInfo.head_branch === rule.ref &&
        runInfo.head_sha === record.producer.workflow_head &&
        runInfo.run_attempt === record.producer.workflow_attempt &&
        Date.parse(asset.created_at) >= Date.parse(runInfo.run_started_at) &&
        Date.parse(asset.created_at) <=
          (runInfo.status === "completed"
            ? Date.parse(runInfo.updated_at)
            : Date.now()),
      "The automation proof publisher has no matching native repository workflow provenance."
    );
    if (identityOnly)
      return {
        ready:
          runInfo.status === "completed" && runInfo.conclusion === "success",
      };
    if (!publishing) {
      requireProof(
        runInfo.status === "completed",
        "The pinned proof-publisher attempt is still pending.",
        "pending-proof"
      );
      requireProof(
        runInfo.conclusion === "success",
        "The pinned proof-publisher attempt did not succeed; a rerun cannot upgrade this record."
      );
    } else
      requireProof(
        runInfo.status !== "completed" || runInfo.conclusion === "success",
        "The pinned proof-publisher attempt has already failed."
      );
    // Native run facts corroborate repository policy; they do not claim which
    // workflow step uploaded a release asset or identify the triggering user.
    return {
      ready: runInfo.status === "completed" && runInfo.conclusion === "success",
    };
  }
  function eligibleCommentAuthor(user, repositoryId) {
    if (!isId(user?.id)) return false;
    if (user.type !== "User")
      return (policy.automationPublishers ?? []).some(
        row =>
          row.user_id === user.id &&
          row.type === user.type &&
          row.type === "Bot" &&
          row.repository_id === repositoryId
      );
    const result = run(
      "gh",
      [
        "api",
        `${root}/collaborators/${encodeURIComponent(user.login)}/permission`,
      ],
      { allowFailure: true, maxBuffer: MAX_NATIVE_JSON_BYTES }
    );
    if (result.status !== 0) {
      if (/HTTP 404/.test(result.stderr ?? "")) return false;
      throw new CompletionProofError(
        READ_ERROR,
        "The native proof publisher's repository authority could not be read."
      );
    }
    let permission;
    try {
      permission = JSON.parse(result.stdout);
    } catch {
      throw new CompletionProofError(
        READ_ERROR,
        "Native publisher permissions are unreadable."
      );
    }
    return (
      permission.user?.id === user.id &&
      ["write", "maintain", "admin"].includes(permission.permission)
    );
  }
  function asset(id, max = MAX_ATTACHMENT_BYTES) {
    requireProof(
      isId(id),
      "An attached proof selected an invalid native asset identifier."
    );
    const metadata = json(`${root}/releases/assets/${id}`);
    let url;
    try {
      url = new URL(metadata.browser_download_url ?? "https://invalid.invalid");
    } catch {
      requireProof(
        false,
        "The native proof attachment metadata has an unreadable repository URL."
      );
    }
    requireProof(
      metadata.id === id &&
        metadata.state === "uploaded" &&
        Number.isSafeInteger(metadata.size) &&
        metadata.size > 0 &&
        metadata.size <= max &&
        url.origin === "https://github.com",
      "The proof attachment is absent, empty, too large or outside GitHub."
    );
    // The release is checked by name against the accepted set, not by a fixed
    // prefix, so a project can rotate its evidence release past GitHub's
    // 1000-asset cap without stranding proof published earlier (#4692).
    const download = DOWNLOAD_PATH.exec(url.pathname);
    requireProof(
      download?.[1] === repository &&
        isAcceptedEvidenceRelease(policy, download[2]),
      `The proof attachment is outside the implementation repository's accepted evidence releases (${acceptedEvidenceReleases(policy).join(", ")}).`
    );
    const bytes = call(
      [
        "api",
        `${root}/releases/assets/${id}`,
        "--header",
        "Accept: application/octet-stream",
      ],
      { binary: true, maxBuffer: max }
    );
    requireProof(
      Buffer.isBuffer(bytes) && bytes.length === metadata.size,
      "The proof attachment download is incomplete."
    );
    return { metadata, bytes };
  }
  return {
    call,
    json,
    asset,
    trustedPublisher,
    eligibleCommentAuthor,
    root,
    repository,
  };
}
