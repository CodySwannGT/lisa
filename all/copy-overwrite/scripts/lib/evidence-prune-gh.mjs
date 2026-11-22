// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * The `gh` calls the evidence prune makes, each failing closed in plain words.
 *
 * Every read the prune decides from must be complete: a listing cut short or a
 * record that cannot be read would make a depended-on file look unpinned, and
 * an unpinned file is one the prune may delete. So a partial answer is always
 * an error here, never an empty result (CodySwannGT/lisa#4720).
 * @module scripts/lib/evidence-prune-gh
 */
import { createHash } from "node:crypto";

import { EvidencePruneError, reportedSha256 } from "./evidence-prune.mjs";

const PAGE_SIZE = 100;
/** Ten pages already exceed GitHub's 1000-file release cap. */
const MAX_PAGES = 20;
/** Release listings are not capped by GitHub; this only bounds a runaway. */
const MAX_RELEASE_PAGES = 1000;
const JSON_BUFFER = 64 * 1024 * 1024;
const TRANSFER_TIMEOUT_MS = 600_000;
const OCTET = "application/octet-stream";

/** The first line of a child's stderr, for a message an operator can act on. */
function said(result) {
  const text = Buffer.isBuffer(result.stderr)
    ? result.stderr.toString("utf8")
    : (result.stderr ?? "");
  const line = text.trim().split("\n")[0]?.slice(0, 300);
  return line ? ` GitHub said: ${line}` : "";
}

/**
 * sha256 of bytes as lowercase hex.
 * @param {Buffer} bytes - File content.
 * @returns {string} Hex digest.
 */
export function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The refusal for any listing that cannot be shown complete. */
function incompleteListing(what) {
  return new EvidencePruneError(
    `The file listing for ${what} is incomplete, so nothing was changed. Retry when GitHub answers fully.`
  );
}

/** A release-asset listing row the prune can decide from. */
const assetRow = row =>
  Number.isSafeInteger(row?.id) &&
  typeof row.name === "string" &&
  Number.isSafeInteger(row.size);

/** A repository release listing row. */
const releaseRow = row =>
  Number.isSafeInteger(row?.id) && typeof row.tag_name === "string";

/** Pages from `--paginate --slurp`, refused unless provably complete. */
function completePages(pages, { what, valid, maxPages }) {
  if (
    !Array.isArray(pages) ||
    pages.length === 0 ||
    pages.length >= maxPages ||
    !pages.every(Array.isArray) ||
    pages.slice(0, -1).some(page => page.length !== PAGE_SIZE) ||
    pages.at(-1).length > PAGE_SIZE
  )
    throw incompleteListing(what);
  const rows = pages.flat();
  const ids = new Set(rows.map(row => row?.id));
  if (ids.size !== rows.length || !rows.every(valid))
    throw incompleteListing(what);
  return rows;
}

/** `gh` bound to one repository: raw output, JSON, and binary downloads. */
function client(run, repository) {
  const root = `repos/${repository}`;
  function gh(args, failure, options = {}) {
    const result = run("gh", args, { maxBuffer: JSON_BUFFER, ...options });
    if (result.status !== 0 || result.error)
      throw Object.assign(new EvidencePruneError(`${failure}${said(result)}`), {
        notFound: /HTTP 404/.test(String(result.stderr ?? "")),
      });
    return result.stdout;
  }
  function json(args, failure, options = {}) {
    const text = gh(args, failure, options);
    try {
      return JSON.parse(text);
    } catch {
      throw new EvidencePruneError(
        `${failure} The answer was not complete JSON.`
      );
    }
  }
  function download(asset) {
    const bytes = gh(
      [
        "api",
        `${root}/releases/assets/${asset.id}`,
        "--header",
        `Accept: ${OCTET}`,
      ],
      `Could not download ${asset.name} from ${repository}.`,
      { binary: true, maxBuffer: asset.size + 1, timeout: TRANSFER_TIMEOUT_MS }
    );
    if (!Buffer.isBuffer(bytes) || bytes.length !== asset.size)
      throw new EvidencePruneError(
        `The download of ${asset.name} was incomplete (${bytes?.length ?? 0} of ${asset.size} bytes).`
      );
    return bytes;
  }
  return { run, repository, root, gh, json, download };
}

/** Every row of a paginated listing, proven complete. */
function listComplete({ json }, path, shape) {
  const failure = `Could not list ${shape.what}.`;
  const pages = json(["api", "--paginate", "--slurp", path], failure);
  const rows = completePages(pages, shape);
  // A full last page is ambiguous: the listing may end there, or the
  // pagination may have been cut short. The page after it must be empty.
  if (rows.length === 0 || rows.length % PAGE_SIZE !== 0) return rows;
  const next = json(["api", `${path}&page=${pages.length + 1}`], failure);
  if (!Array.isArray(next) || next.length !== 0)
    throw incompleteListing(shape.what);
  return rows;
}

/** Every file in a release. */
function listAssets(bound, release) {
  return listComplete(
    bound,
    `${bound.root}/releases/${release.id}/assets?per_page=${PAGE_SIZE}`,
    {
      what: `the files in release ${release.tag_name}`,
      valid: assetRow,
      maxPages: MAX_PAGES,
    }
  );
}

/** Every release in the repository. */
function listReleases(bound) {
  return listComplete(bound, `${bound.root}/releases?per_page=${PAGE_SIZE}`, {
    what: `the releases in ${bound.repository}`,
    valid: releaseRow,
    maxPages: MAX_RELEASE_PAGES,
  });
}

/**
 * Whether `gh` can act: installed, and signed in to github.com.
 * @param {Function} run - Child-process runner.
 * @returns {"ok"|"missing"|"signed-out"} The state.
 */
export function ghAccess(run) {
  const result = run("gh", ["auth", "status", "--hostname", "github.com"], {});
  if (result.status === null || result.error?.code === "ENOENT")
    return "missing";
  return result.status === 0 ? "ok" : "signed-out";
}

/** A release by tag, or null when GitHub says it does not exist. */
function readRelease({ root, repository, json }, tag) {
  try {
    return json(
      ["api", `${root}/releases/tags/${encodeURIComponent(tag)}`],
      `Could not read the release ${tag} in ${repository}.`
    );
  } catch (error) {
    if (error.notFound) return null;
    throw error;
  }
}

/** The three writes the prune makes: create the archive, upload, delete. */
function writes({ root, repository, gh, json }) {
  return {
    createRelease: (tag, branch) =>
      gh(
        [
          "release",
          "create",
          tag,
          "--repo",
          repository,
          "--target",
          branch,
          "--title",
          tag,
          "--notes",
          "Archived Lisa evidence",
          "--latest=false",
        ],
        `Could not create the archive release ${tag} in ${repository}.`
      ),
    upload: (release, name, bytes) =>
      json(
        [
          "api",
          "--method",
          "POST",
          `https://uploads.github.com/${root}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
          "--header",
          `Content-Type: ${OCTET}`,
          // gh does not set a length for a body read from stdin, and the
          // upload host refuses it: "Bad Content-Length (HTTP 400)".
          "--header",
          `Content-Length: ${bytes.length}`,
          "--input",
          "-",
        ],
        `Could not upload ${name} to the archive release ${release.tag_name}.`,
        { input: bytes, timeout: TRANSFER_TIMEOUT_MS }
      ),
    remove: asset =>
      gh(
        ["api", "--method", "DELETE", `${root}/releases/assets/${asset.id}`],
        `Archived ${asset.name}, but could not delete it from the evidence release.`
      ),
  };
}

/**
 * Bind the prune's GitHub reads and writes to one repository.
 * @param {Function} run - `(command, args, options) => {status, stdout, stderr, error}`.
 * @param {string} repository - `owner/name`.
 * @returns {object} The prune's GitHub operations.
 */
export function pruneGitHub(run, repository) {
  const bound = client(run, repository);
  return {
    repository,
    repo: () =>
      bound.json(
        ["api", bound.root],
        `Could not read the repository ${repository}; check that gh can see it.`
      ),
    release: tag => readRelease(bound, tag),
    assets: release => listAssets(bound, release),
    releases: () => listReleases(bound),
    asset: id =>
      bound.json(
        ["api", `${bound.root}/releases/assets/${id}`],
        `Could not read back release file ${id}.`
      ),
    download: bound.download,
    sha256: asset => reportedSha256(asset) ?? hashBytes(bound.download(asset)),
    ...writes(bound),
  };
}
