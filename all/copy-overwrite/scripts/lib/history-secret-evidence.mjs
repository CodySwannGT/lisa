// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.
/** Exact Git preimages and detector spans, independent of caller suppressions. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  gitEnvironment,
  gitRead,
  HistorySecretError,
} from "./history-secret-git.mjs";
import {
  evidenceMaps,
  narrativeSpan,
  safeSourcePath,
} from "./history-secret-evidence-shape.mjs";
const BUDGET = 64 * 1024 * 1024;
const NO_REPLACEMENTS = "--no-replace-objects";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const options = cwd => ({
  cwd,
  env: gitEnvironment(),
  timeout: 120000,
  maxBuffer: 1024 * 1024,
});

/** Authentic regular Git blobs; deduplication charges each actual blob once. */
const readBlob = (file, commit, cwd, state) => {
  if (!safeSourcePath(file)) return null;
  const entries = gitRead(
    ["--literal-pathspecs", "ls-tree", "-z", commit, "--", file],
    cwd
  )
    .split("\0")
    .filter(Boolean);
  if (entries.length !== 1) return null;
  const entry = entries[0].match(
    /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t([\s\S]*)$/u
  );
  if (!entry || entry[3] !== file || entry[2].length !== commit.length)
    return null;
  if (state.blobs.has(entry[2])) return state.blobs.get(entry[2]);
  if (state.blobs.size >= 256) return null;
  const sizeText = gitRead(["cat-file", "-s", entry[2]], cwd);
  const size = Number(sizeText);
  if (!/^\d+$/u.test(sizeText) || !Number.isSafeInteger(size))
    throw new HistorySecretError(
      "Git blob size is invalid. Repair complete Git objects and retry; safety is unproved."
    );
  if (size > state.remaining) return null;
  const result = spawnSync(
    "git",
    [NO_REPLACEMENTS, "cat-file", "blob", entry[2]],
    {
      cwd,
      env: gitEnvironment(),
      timeout: 120000,
      maxBuffer: BUDGET,
    }
  );
  if (
    result.error ||
    result.signal ||
    result.status !== 0 ||
    result.stdout.length !== size ||
    createHash(commit.length === 40 ? "sha1" : "sha256")
      .update(`blob ${size}\0`)
      .update(result.stdout)
      .digest("hex") !== entry[2]
  )
    throw new HistorySecretError(
      "Git blob bytes cannot be verified. Repair complete Git objects and retry; no raw source is published."
    );
  state.remaining -= size;
  state.blobs.set(entry[2], result.stdout);
  return result.stdout;
};

/** Explicit revisions retain exact original commit-type and ancestry requirements. */
const revisionFor = (map, row, cwd) => {
  if (!Object.hasOwn(map.value, "source_revision")) return row.Commit;
  const revision = map.value.source_revision;
  if (
    typeof revision !== "string" ||
    !new RegExp(`^[a-f0-9]{${row.Commit.length}}$`, "u").test(revision)
  )
    return null;
  const type = spawnSync(
    "git",
    [NO_REPLACEMENTS, "cat-file", "-t", revision],
    options(cwd)
  );
  const ancestor = spawnSync(
    "git",
    [NO_REPLACEMENTS, "merge-base", "--is-ancestor", revision, row.Commit],
    options(cwd)
  );
  return !type.error &&
    !type.signal &&
    type.status === 0 &&
    type.stdout.toString() === "commit\n" &&
    !type.stderr.length &&
    !ancestor.error &&
    !ancestor.signal &&
    ancestor.status === 0 &&
    !ancestor.stdout.length &&
    !ancestor.stderr.length
    ? revision
    : null;
};

/** Only explicitly selected introduced commits can supply additional source versions. */
const sourceVersions = (file, row, cwd, commits, cache) => {
  const key = `${row.Commit}\0${file}`;
  if (cache.has(key)) return cache.get(key);
  const candidates = new Set();
  for (let offset = 0; offset < commits.length; offset += 100) {
    const list = gitRead(
      [
        "--literal-pathspecs",
        "log",
        "--no-walk=unsorted",
        "--format=%H",
        ...commits.slice(offset, offset + 100),
        "--",
        file,
      ],
      cwd
    );
    for (const candidate of list.split("\n").filter(Boolean)) {
      if (!commits.includes(candidate))
        throw new HistorySecretError(
          "Source version attribution is invalid. Supply original Git input and retry."
        );
      const ancestor = spawnSync(
        "git",
        [NO_REPLACEMENTS, "merge-base", "--is-ancestor", candidate, row.Commit],
        options(cwd)
      );
      if (
        ancestor.error ||
        ancestor.signal ||
        ![0, 1].includes(ancestor.status) ||
        ancestor.stdout.length ||
        ancestor.stderr.length
      )
        throw new HistorySecretError(
          "Source ancestry cannot be verified. Repair complete Git objects and retry."
        );
      if (ancestor.status === 0) candidates.add(candidate);
    }
  }
  const versions = [...candidates];
  cache.set(key, versions);
  return versions;
};

/** One reconstructed redacted capture must coincide with one actual Git byte span. */
const attribution = (row, bytes) => {
  let lineStart = 0;
  for (let line = 1; line < row.StartLine; line++) {
    const next = bytes.indexOf(10, lineStart);
    if (next < 0) return null;
    lineStart = next + 1;
  }
  const newline = bytes.indexOf(10, lineStart);
  const lineEnd = newline < 0 ? bytes.length : newline;
  const replacements = row.Match.split("REDACTED");
  if (replacements.length !== 2) return null;
  const line = bytes.subarray(lineStart, lineEnd);
  const matches = span => {
    const template = replacements.join(span.hash);
    if (template.split(span.hash).length !== 2) return false;
    const original = Buffer.from(template);
    const offset = line.indexOf(original);
    if (offset < 0 || line.indexOf(original, offset + 1) >= 0) return false;
    const start = lineStart + offset;
    const end = start + original.length;
    if (
      span.start !== start + Buffer.byteLength(replacements[0]) ||
      span.end !== span.start + Buffer.byteLength(span.hash)
    )
      return false;
    // The pinned vendor can count one preceding fragment newline in columns.
    return (
      [0, 1].filter(
        extra =>
          start === lineStart + row.StartColumn - 1 - extra &&
          end === lineStart + row.EndColumn - extra
      ).length === 1
    );
  };
  return { lineStart, lineEnd, matches };
};

/** Catalogue labels are never dereferenced; only actual introduced head Git bytes count. */
const proofMatches = (span, heads, blob) =>
  heads.some(head => {
    const bytes = blob(
      `.lisa/history-secret-preimages/sha256/${span.hash}`,
      head
    );
    return bytes !== null && digest(bytes) === span.hash;
  });

/** Source mappings retain whole-map verification and exact path-specific preimages. */
const verifiedMap = (map, row, cwd, commits, heads, blob, versions) => {
  if (map.kind === "proof")
    return map.spans.filter(span => proofMatches(span, heads, blob));
  const revision = revisionFor(map, row, cwd);
  if (revision === null) return [];
  for (const span of map.spans) {
    const bytes = blob(span.file, revision);
    if (bytes !== null && digest(bytes) === span.hash) continue;
    if (map.kind === "strict" || Object.hasOwn(map.value, "source_revision"))
      return [];
    if (
      !sourceVersions(span.file, row, cwd, commits, versions).some(commit => {
        const historical = blob(span.file, commit);
        return historical !== null && digest(historical) === span.hash;
      })
    )
      return [];
  }
  return map.spans;
};

/** Clear a finding only after syntax, original span and independently verified bytes agree. */
export const classifyEvidence = (cwd, commits, heads) => {
  const state = { remaining: BUDGET, blobs: new Map() };
  const refs = new Map();
  const maps = new Map();
  const versions = new Map();
  const blob = (file, commit) => {
    const key = `${commit}\0${file}`;
    if (!refs.has(key)) {
      if (refs.size >= 4096) return null;
      refs.set(key, readBlob(file, commit, cwd, state));
    }
    return refs.get(key);
  };
  return row => {
    if (
      row.RuleID !== "generic-api-key" ||
      !safeSourcePath(row.File) ||
      row.SymlinkFile !== "" ||
      row.Secret !== "REDACTED" ||
      typeof row.Match !== "string" ||
      row.EndLine !== row.StartLine ||
      !Number.isSafeInteger(row.StartColumn) ||
      !Number.isSafeInteger(row.EndColumn) ||
      row.StartColumn < 1 ||
      row.EndColumn < row.StartColumn
    )
      return false;
    const bytes = blob(row.File, row.Commit);
    if (!bytes) return false;
    const span = attribution(row, bytes);
    if (!span) return false;
    const narrative = narrativeSpan(bytes, span.lineStart, span.lineEnd);
    if (narrative !== null && span.matches(narrative)) return true;
    const key = `${row.Commit}\0${row.File}`;
    if (!maps.has(key))
      maps.set(
        key,
        evidenceMaps(bytes).flatMap(map =>
          verifiedMap(map, row, cwd, commits, heads, blob, versions)
        )
      );
    return maps.get(key).filter(span.matches).length === 1;
  };
};
