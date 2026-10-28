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
        url.origin === "https://github.com" &&
        url.pathname.startsWith(`/${repository}/releases/download/pr-assets/`),
      "The proof attachment is absent, empty, too large or outside the implementation repository's pr-assets release."
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
