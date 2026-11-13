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

/** Lets gh >= 2.97 print a raw body holding terminal escape sequences. */
const ESCAPE_FLAG = "--allow-escape-sequences";
/** How gh < 2.97, which has no escape check, rejects that flag. */
const UNKNOWN_ESCAPE_FLAG = /unknown flag:? --allow-escape-sequences/;
const OCTET_STREAM = "Accept: application/octet-stream";
/**
 * Backoff before each retry of a transient read: three retries, four attempts
 * in all (CodySwannGT/lisa#4733). A publish makes about a hundred reads, and a
 * replay of one caller repo's read set lost roughly 1% of them at random.
 */
const READ_RETRY_DELAYS_MS = Object.freeze([250, 1000, 3000]);
/**
 * Diagnostics of a network fault that a later identical read can outlive: a
 * connect or dial timeout, a TLS handshake timeout, a reset connection, a cut
 * stream, an i/o timeout, or GitHub's own 500/502/503/504.
 */
const TRANSIENT_STDERR =
  /(?:connect|dial)[^\n]*(?:timed out|timeout)|TLS handshake timeout|connection reset|ECONNRESET|unexpected EOF|i\/o timeout|HTTP 50[0234]\b/i;
/** The longest stderr excerpt a read failure quotes. */
const STDERR_EXCERPT = 200;
const ESC = 0x1b;
/** Repository-relative read paths and the read each one is. */
const READ_KINDS = [
  [/^releases\/assets\/\d+$/, "asset-metadata"],
  [/^releases\/tags\//, "release"],
  [/^releases\/\d+\/assets/, "release-assets"],
  [/^collaborators\/[^/]+\/permission$/, "collaborator-permission"],
  [/^compare\//, "compare"],
  [/^pulls\//, "pull"],
  [/^commits\//, "commit"],
  [/^actions\/runs\//, "actions-run"],
  [/^branches\//, "branch"],
  [/^issues\/\d+\/comments/, "comments"],
  [/^user$/, "user"],
];

/**
 * The endpoint a `gh api` argument vector reads: the first operand after
 * `api` that is neither a flag nor a flag's value.
 * @param {string[]} args - Exact `gh` argument vector.
 * @returns {string} The endpoint, or "" when there is none.
 */
function readPath(args) {
  return (
    args.find(
      (value, index) =>
        index > 0 &&
        !value.startsWith("-") &&
        !["--header", "-H"].includes(args[index - 1])
    ) ?? ""
  );
}

/**
 * Text with terminal control removed: CSI escape sequences whole, every other
 * C0/C1 control character except the newline. Scanned, not matched, so no
 * control character has to appear in a pattern.
 * @param {string} text - Untrusted diagnostics.
 * @returns {string} The printable text and its newlines.
 */
function stripControl(text) {
  const kept = [];
  // "text" | "escape" (just read ESC) | "csi" (inside ESC [ ... final).
  // `[` is itself in the final-byte range, so the introducer must be consumed
  // on its own or `ESC [31m` would leave `31m` glued to the next word.
  let state = "text";
  for (const character of text) {
    const code = character.codePointAt(0);
    if (state === "escape") {
      state = code === 0x5b ? "csi" : "text";
      continue;
    }
    if (state === "csi") {
      if (code >= 0x40 && code <= 0x7e) state = "text";
      continue;
    }
    if (code === ESC) state = "escape";
    else if (code === 0x0a || (code >= 0x20 && (code < 0x7f || code > 0x9f)))
      kept.push(character);
  }
  return kept.join("");
}

/**
 * Stderr made safe to quote: control stripped, credentials redacted, first
 * non-empty line only, bounded.
 * @param {string} [stderr] - Raw `gh` diagnostics.
 * @returns {string} One quotable line, possibly empty.
 */
function quotableStderr(stderr) {
  const line =
    stripControl(String(stderr ?? ""))
      // No word boundary: a token glued to preceding text must still redact.
      .replace(/(?:gh[pousr]_|github_pat_)\w+/g, "[redacted]")
      .split("\n")
      .map(row => row.trim())
      .find(Boolean) ?? "";
  return line.length > STDERR_EXCERPT
    ? `${line.slice(0, STDERR_EXCERPT)}…`
    : line;
}

/**
 * How a bounded `gh` run failed, or null when it completed in full.
 * @param {object} result - The canonical runner's spawn result.
 * @param {number} maxBuffer - The byte ceiling the read ran under.
 * @returns {string|null} Exit, timeout, overflow or ceiling detail.
 */
function readFailure(result, maxBuffer) {
  const code = result.error?.code;
  if (code === "ETIMEDOUT") return "timed out";
  if (code === "ENOBUFS")
    return `output exceeded the ${maxBuffer}-byte ceiling (ENOBUFS)`;
  if (result.error) return `gh could not run (${code ?? result.error.message})`;
  if (result.status !== 0)
    return result.signal
      ? `killed by ${result.signal}`
      : `exit ${result.status}`;
  if (Buffer.byteLength(result.stdout ?? "") > maxBuffer)
    return `response exceeded the ${maxBuffer}-byte ceiling`;
  return null;
}

/**
 * Whether a failed `gh` run may succeed if repeated unchanged. A spawn timeout
 * and the network faults above are; a 4xx, a byte ceiling, a missing gh or an
 * unknown flag would fail the same way again, so they are reported at once.
 * @param {object} result - The canonical runner's spawn result.
 * @returns {boolean} True when the read is worth repeating.
 */
function transientRun(result) {
  if (result.error) return result.error.code === "ETIMEDOUT";
  return result.status !== 0 && TRANSIENT_STDERR.test(result.stderr ?? "");
}

/** `gh api` flags that send a request body, which makes the call a write. */
const BODY_FLAGS = new Set(["-f", "-F", "--field", "--raw-field", "--input"]);
/** `gh api` flags that pick the HTTP method. */
const METHOD_FLAGS = new Set(["-X", "--method"]);

/**
 * The HTTP method one `gh api` argument names, or null when it names none:
 * `-X POST`, `--method POST`, `--method=POST` and `-XPOST` all count.
 * @param {string[]} args - Exact `gh` argument vector.
 * @param {number} index - Position of the argument to read.
 * @returns {string|null} The upper-cased method, or null.
 */
function methodAt(args, index) {
  const value = args[index];
  if (METHOD_FLAGS.has(value)) return String(args[index + 1]).toUpperCase();
  const joined = /^(?:--method=|-X)(.+)$/.exec(value);
  return joined ? joined[1].toUpperCase() : null;
}

/**
 * Whether a `gh` call can change GitHub state. Such a call is never repeated:
 * a write that timed out may still have landed, and a retry would apply it
 * twice (CodySwannGT/lisa#4733).
 * @param {string[]} args - Exact `gh` argument vector.
 * @returns {boolean} True for any body flag or a non-GET method.
 */
function writes(args) {
  return args.some((value, index) => {
    if (BODY_FLAGS.has(value) || /^--(?:raw-)?field=|^--input=/.test(value))
      return true;
    const method = methodAt(args, index);
    return method !== null && method !== "GET";
  });
}

/**
 * Block the thread for a retry backoff. The transport is synchronous end to
 * end (its runner is spawnSync-based), so the wait is too.
 * @param {number} ms - Milliseconds to wait.
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** How many attempts a read took, when it took more than one. */
function attemptsNote(attempts) {
  return attempts > 1 ? `; after ${attempts} attempts` : "";
}

/** The refusal for a read that did not complete. */
function incompleteRead(detail) {
  return new CompletionProofError(
    READ_ERROR,
    `A required GitHub completion-proof read did not complete (${detail}); restore repository access and retry canonical Verify/evidence.`
  );
}

/** The refusal for a read whose body never parsed. */
function unparseableRead(detail) {
  return new CompletionProofError(
    READ_ERROR,
    `A required GitHub proof response is not complete JSON (${detail}).`
  );
}

/** The refusal for an asset whose download never matched its metadata. */
function incompleteDownload(detail) {
  return new CompletionProofError(
    "invalid-proof",
    `The proof attachment download is incomplete (${detail}).`
  );
}

/**
 * Which read an endpoint is, for the operator.
 * @param {string} target - Repository-relative endpoint ("" for the repository).
 * @param {boolean} raw - Whether the read downloads raw asset bytes.
 * @returns {string} A stable read kind.
 */
function readKind(target, raw) {
  if (raw) return "asset-download";
  if (target === "") return "repository";
  return READ_KINDS.find(([pattern]) => pattern.test(target))?.[1] ?? "api";
}

/**
 * Name a failed read: what it was, where, and how it ended (#4773). Repository
 * paths keep their ids, so the exact asset, PR or commit is identifiable.
 * @param {object} read - The read that failed.
 * @param {string} [read.kind] - Explicit kind, when the endpoint is ambiguous.
 * @param {string[]} read.args - Exact `gh` argument vector.
 * @param {string} read.root - `repos/<owner>/<repo>` of the transport.
 * @param {string} read.failure - Exit, timeout, overflow or ceiling detail.
 * @param {string} [read.stderr] - Raw `gh` diagnostics.
 * @returns {string} One bounded, credential-free description.
 */
function describeRead({ kind, args, root, failure, stderr }) {
  const path = readPath(args);
  const target = path.startsWith(`${root}/`)
    ? path.slice(root.length + 1)
    : path === root
      ? ""
      : path;
  const http = /HTTP (\d{3})/.exec(stderr ?? "")?.[1];
  const said = quotableStderr(stderr);
  return [
    `${kind ?? readKind(target, args.includes(OCTET_STREAM))} ${target || root}: ${failure}`,
    http ? `HTTP ${http}` : "",
    said ? `gh said: ${said}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** `/<owner>/<repo>/releases/download/<tag>/<asset>`, and nothing nested. */
const DOWNLOAD_PATH = /^\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\/[^/]+$/;

/**
 * The transport reuses the canonical CLI's deadline and failure boundary.
 * @param {Function} run - The canonical spawnSync-based runner.
 * @param {string} repository - `<owner>/<repo>` every read is confined to.
 * @param {object} [policy] - `verification.completion` from the Lisa config.
 * @param {object} [retry] - Read retry pacing; tests replace the wait.
 * @param {readonly number[]} [retry.delays] - Backoff before each retry.
 * @param {Function} [retry.sleep] - Synchronous wait, given milliseconds.
 */
export function githubProofTransport(
  run,
  repository,
  policy = {},
  { delays = READ_RETRY_DELAYS_MS, sleep = sleepSync } = {}
) {
  requireProof(
    /^[\w.-]+\/[\w.-]+$/.test(repository),
    "The implementation repository is not canonical."
  );
  const root = `repos/${repository}`;
  /**
   * Run one bounded `gh` read and report, rather than throw, how it ended.
   * @param {string[]} args - Exact `gh` argument vector.
   * @param {object} [options] - Runner options plus an optional `kind`.
   * @returns {object} The run, its bytes as `value` and, when it failed, a
   *   `failure` naming the read, whether it is `transient`, and how to
   *   `refuse` it.
   */
  function attempt(args, options = {}) {
    const { kind, ...runOptions } = options;
    const maxBuffer = runOptions.maxBuffer ?? MAX_NATIVE_JSON_BYTES;
    const result = run("gh", args, {
      allowFailure: true,
      ...runOptions,
      maxBuffer,
    });
    const failure = readFailure(result, maxBuffer);
    return {
      result,
      value: result.stdout,
      failure:
        failure &&
        describeRead({ kind, args, root, failure, stderr: result.stderr }),
      transient: failure !== null && transientRun(result),
      refuse: incompleteRead,
    };
  }
  /**
   * Repeat a whole read unit while it fails transiently, within the bound.
   * A unit is the read plus whatever proves it whole (a parse, a size check),
   * so a truncated body is retried exactly like a dropped connection.
   * @param {Function} unit - One read attempt, returning an attempt outcome.
   * @returns {object} The final outcome, with how many attempts it took.
   */
  function retried(unit) {
    let outcome = unit();
    let attempts = 1;
    while (outcome.failure && outcome.transient && attempts <= delays.length) {
      sleep(delays[attempts - 1]);
      outcome = unit();
      attempts += 1;
    }
    return { ...outcome, attempts };
  }
  /** The failure detail of an outcome, with its attempt count. */
  function detail(outcome) {
    return `${outcome.failure}${attemptsNote(outcome.attempts)}`;
  }
  /** The value of a completed read; a failed one names itself (#4773). */
  function settle(outcome) {
    if (outcome.failure) throw outcome.refuse(detail(outcome));
    return outcome.value;
  }
  /**
   * One read whose body must be complete JSON. A body that does not parse is
   * transient, since a cut stream is how that usually happens.
   * @param {string[]} args - Exact `gh` argument vector.
   * @returns {object} One attempt outcome holding the parsed body.
   */
  function parsedAttempt(args) {
    const read = attempt(args);
    if (read.failure) return read;
    try {
      return { ...read, value: JSON.parse(read.value) };
    } catch {
      return {
        ...read,
        failure: describeRead({ args, root, failure: "unparseable response" }),
        transient: true,
        unparseable: true,
        refuse: unparseableRead,
      };
    }
  }
  /**
   * One bounded `gh` read.
   * @param {string[]} args - Exact `gh` argument vector.
   * @param {object} [options] - Runner options; `kind` names the read when
   *   its endpoint alone does not.
   * @returns {string|Buffer} The complete response.
   */
  function call(args, options = {}) {
    if (writes(args)) return settle({ ...attempt(args, options), attempts: 1 });
    return settle(retried(() => attempt(args, options)));
  }
  // gh >= 2.97 needs the flag and gh < 2.97 rejects it. Assumed supported
  // until gh rejects it once; remembered for this transport's later downloads.
  let escapeFlagSupported = true;
  /**
   * Download a release asset's raw bytes on either side of gh's
   * escape-sequence check (GHSA-3m3g-3wcr-px46, gh v2.97.0). Since then
   * `gh api` refuses to print a raw body holding terminal escape sequences
   * without `--allow-escape-sequences`, so an ANSI-coloured test log failed
   * every terminal transition on CI's gh while an older local gh, which
   * rejects the flag, read it fine (CodySwannGT/lisa#4773). The bytes go to a
   * Buffer and are hashed, never to a terminal, so allowing them is safe. A
   * rejected flag is a probe, not an attempt, so it never counts as one.
   * @param {number} id - Native asset identifier.
   * @param {number} max - Byte ceiling for this attachment.
   * @returns {object} One attempt outcome holding the raw bytes.
   */
  function downloadAttempt(id, max) {
    const args = [
      "api",
      `${root}/releases/assets/${id}`,
      "--header",
      OCTET_STREAM,
    ];
    const options = { binary: true, maxBuffer: max };
    if (escapeFlagSupported) {
      const flagged = attempt([...args, ESCAPE_FLAG], options);
      const rejected =
        flagged.result.status !== 0 &&
        UNKNOWN_ESCAPE_FLAG.test(flagged.result.stderr ?? "");
      if (!rejected) return flagged;
      escapeFlagSupported = false;
    }
    return attempt(args, options);
  }
  /**
   * One download checked against its metadata: a body of any other length
   * is a cut transfer, so it is transient like a dropped connection.
   * @param {number} id - Native asset identifier.
   * @param {number} max - Byte ceiling for this attachment.
   * @param {number} size - The byte size native metadata declares.
   * @returns {object} One attempt outcome holding the raw bytes.
   */
  function wholeDownload(id, max, size) {
    const read = downloadAttempt(id, max);
    if (read.failure) return read;
    if (Buffer.isBuffer(read.value) && read.value.length === size) return read;
    return {
      ...read,
      failure: `asset-download releases/assets/${id}: ${Buffer.byteLength(read.value ?? "")} of ${size} bytes`,
      transient: true,
      refuse: incompleteDownload,
    };
  }
  function json(path, paginated = false) {
    requireProof(
      path.startsWith(`${root}/`) || path === root,
      "A completion read selected another repository."
    );
    const args = paginated
      ? ["api", "--paginate", "--slurp", path]
      : ["api", path];
    const parsed = settle(retried(() => parsedAttempt(args)));
    if (paginated)
      requireProof(
        Array.isArray(parsed) && parsed.length <= 100,
        "The required GitHub pagination is incomplete or exceeds its bound."
      );
    return parsed;
  }
  /**
   * A JSON read GitHub may answer with an explicit 404. Only that 404 is an
   * answer; every other failure is retried when transient and then refused.
   * @param {string} path - Repository-confined endpoint.
   * @returns {object} The final outcome; `absent` is true for the 404.
   */
  function optionalRead(path) {
    requireProof(
      path.startsWith(`${root}/`),
      "A completion read selected another repository."
    );
    const read = retried(() => parsedAttempt(["api", path]));
    const absent =
      Boolean(read.failure) &&
      !read.unparseable &&
      read.result.status !== 0 &&
      /HTTP 404/.test(read.result.stderr ?? "");
    return { ...read, absent };
  }
  /**
   * Read JSON that may not exist, such as a release looked up by tag.
   * @param {string} path - Repository-confined endpoint.
   * @returns {object|null} The parsed body, or null for GitHub's explicit 404.
   */
  function optionalJson(path) {
    const read = optionalRead(path);
    return read.absent ? null : settle(read);
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
    const read = optionalRead(
      `${root}/collaborators/${encodeURIComponent(user.login)}/permission`
    );
    if (read.absent) return false;
    if (read.failure)
      throw new CompletionProofError(
        READ_ERROR,
        read.unparseable
          ? `Native publisher permissions are unreadable (${detail(read)}).`
          : `The native proof publisher's repository authority could not be read (${detail(read)}).`
      );
    const permission = read.value;
    return (
      permission?.user?.id === user.id &&
      ["write", "maintain", "admin"].includes(permission?.permission)
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
    const bytes = settle(retried(() => wholeDownload(id, max, metadata.size)));
    return { metadata, bytes };
  }
  return {
    call,
    json,
    optionalJson,
    asset,
    trustedPublisher,
    eligibleCommentAuthor,
    root,
    repository,
  };
}
