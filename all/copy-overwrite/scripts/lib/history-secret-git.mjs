// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file history-secret-git.mjs
 * @description Prove complete pairwise introduced reachability before scanning.
 * @module history-secrets
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Authored guidance is distinguishable from filesystem/vendor exceptions. */
export class HistorySecretError extends Error {}

/** Deterministic Git plumbing must ignore replacements and diff transforms. */
export const gitEnvironment = () => {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (
      key.startsWith("GIT_CONFIG_") ||
      key.startsWith("GITLEAKS_") ||
      [
        "GIT_DIR",
        "GIT_COMMON_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_SHALLOW_FILE",
        "GIT_REPLACE_REF_BASE",
        "GIT_NAMESPACE",
      ].includes(key)
    )
      delete environment[key];
  }
  return {
    ...environment,
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_COUNT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  };
};

/** Git errors can contain arbitrary payloads; only authored guidance leaves here. */
export const gitRead = (args, cwd, input) => {
  const result = spawnSync(
    "git",
    [
      "--no-replace-objects",
      "-c",
      "diff.external=",
      "-c",
      "core.quotePath=true",
      ...args,
    ],
    {
      cwd,
      env: gitEnvironment(),
      encoding: "utf8",
      input,
      timeout: 120000,
      maxBuffer: 64 * 1024 * 1024,
    }
  );
  if (result.error || result.signal || result.status !== 0)
    throw new HistorySecretError(
      "Cannot prove complete Git history. Fetch the actual before/head objects and complete history, then retry; repair missing or corrupt objects."
    );
  return result.stdout.trim();
};

/** Validate the entire stream before any scanner or deletion shortcut. */
export const parsePush = (input, width, cwd = process.cwd()) => {
  if (input === "") return [];
  const lines = input.endsWith("\n")
    ? input.slice(0, -1).split("\n")
    : input.split("\n");
  return lines.map(line => {
    const fields = line.split(" ");
    if (fields.length !== 4 || fields.some(field => !field))
      throw new HistorySecretError(
        "Malformed pre-push input. Supply Git's complete four-field ref records without extra or missing fields."
      );
    const [localRef, after, remoteRef, before] = fields;
    const oid = new RegExp(`^[a-f0-9]{${width}}$`, "u");
    if (!oid.test(before) || !oid.test(after))
      throw new HistorySecretError(
        "Malformed object ID. Supply full lowercase IDs matching the repository object format."
      );
    const validRef = ref =>
      ref.startsWith("refs/") &&
      spawnSync("git", ["check-ref-format", ref], {
        env: gitEnvironment(),
        timeout: 10000,
        stdio: "ignore",
      }).status === 0;
    // Git preserves an explicit revision expression (HEAD~1 or a raw ID) in
    // local-ref. Its actual supplied object ID remains the range boundary.
    const validSource = () => {
      if (localRef.startsWith("refs/")) return validRef(localRef);
      if (localRef === "(delete)") return /^0+$/u.test(after);
      try {
        return (
          gitRead(
            [
              "rev-parse",
              "--verify",
              "--end-of-options",
              `${localRef}^{object}`,
            ],
            cwd
          ) === after
        );
      } catch {
        return false;
      }
    };
    if (!validRef(remoteRef) || !validSource())
      throw new HistorySecretError(
        "Malformed ref record. Supply the original Git pre-push stream with valid refs."
      );
    return { before, after };
  });
};

/** Events carry actual IDs, never a guessed checkout HEAD. */
export const eventPairs = (event, name, width) => {
  if (name === "pull_request")
    return [
      {
        before: event.pull_request?.base?.sha,
        after: event.pull_request?.head?.sha,
      },
    ];
  if (name === "push") {
    const oid = new RegExp(`^[a-f0-9]{${width}}$`, "u");
    if (!oid.test(event.before ?? "") || !oid.test(event.after ?? ""))
      throw new HistorySecretError(
        "Malformed event object IDs. Supply full actual before/after IDs matching the repository object format."
      );
    if (event.deleted === true && event.after !== "0".repeat(width))
      throw new HistorySecretError(
        "Inconsistent deletion event. Supply the original actual push event with a zero after ID for deletion."
      );
    return [{ before: event.before, after: event.after }];
  }
  throw new HistorySecretError(
    "Unsupported CI event. Supply actual pull_request base/head or push before/after event data."
  );
};

/**
 * Resolve Git's pre-push `$1` to a configured remote whose tracking refs may
 * bound a new ref's range. Git passes the remote's NAME when the push named
 * one and the URL otherwise; a URL counts only when exactly one configured
 * remote declares it as its url or pushurl. Anything unresolvable returns null,
 * which keeps the complete-history scan: an unknown remote proves nothing about
 * what the destination already holds.
 * @param {string | undefined} remote Git's pre-push remote argument.
 * @param {string} cwd Repository directory.
 * @returns {string | null} A configured remote name, or null.
 */
export const pushRemoteName = (remote, cwd) => {
  if (typeof remote !== "string" || remote === "") return null;
  // A remote name becomes a ref-prefix pattern below. Glob metacharacters,
  // a leading dash and path tricks would make that prefix mean something else,
  // so such a name never bounds the range.
  const safe = name =>
    /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u.test(name) &&
    !name.startsWith("-") &&
    !name.split("/").some(part => part === "." || part === "..") &&
    spawnSync("git", ["check-ref-format", `refs/remotes/${name}/probe`], {
      env: gitEnvironment(),
      timeout: 10000,
      stdio: "ignore",
    }).status === 0;
  const names = gitRead(["remote"], cwd).split("\n").filter(Boolean);
  if (names.includes(remote)) return safe(remote) ? remote : null;
  // `--get-regexp` exits 1 when nothing matches, which is an answer here, not
  // a failure, so this one read does not go through gitRead.
  const configured = spawnSync(
    "git",
    ["config", "--null", "--get-regexp", "^remote\\..*\\.(url|pushurl)$"],
    {
      cwd,
      env: gitEnvironment(),
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    }
  );
  // probe-direction: fail-closed — an unreadable remote list resolves no
  // remote, so nothing is subtracted and the complete history is scanned.
  if (configured.error || configured.signal || configured.status !== 0)
    return null;
  const owners = new Set();
  for (const record of configured.stdout.split("\0").filter(Boolean)) {
    const split = record.indexOf("\n");
    const key = record.slice(0, split);
    const value = record.slice(split + 1);
    const name = key
      .replace(/^remote\./u, "")
      .replace(/\.(?:url|pushurl)$/u, "");
    if (split > 0 && value === remote && names.includes(name)) owners.add(name);
  }
  if (owners.size !== 1) return null;
  const [owner] = owners;
  return safe(owner) ? owner : null;
};

/**
 * Commit IDs the push remote already holds, read from its local tracking refs.
 *
 * Tracking refs are the repository's record of what the remote advertised at
 * the last fetch or push. A stale record only ever under-reports, which widens
 * the scan rather than narrowing it, so reading them is fail-closed.
 * @param {string | null} remote A configured remote name from pushRemoteName.
 * @param {string} cwd Repository directory.
 * @returns {string[]} Commit IDs to exclude; empty when none are known.
 */
export const remoteTips = (remote, cwd) => {
  if (remote === null) return [];
  const refs = gitRead(
    [
      "for-each-ref",
      "--format=%(objectname)",
      "--end-of-options",
      `refs/remotes/${remote}/`,
    ],
    cwd
  );
  return [...new Set(refs.split("\n").filter(Boolean))];
};

/** Pairwise subtraction prevents one ref's old tip from hiding another update. */
export const introducedCommits = (pairs, cwd, width, remote) => {
  const oid = new RegExp(`^[a-f0-9]{${width}}$`, "u");
  for (const pair of pairs) {
    if (!oid.test(pair.before ?? "") || !oid.test(pair.after ?? ""))
      throw new HistorySecretError(
        "Malformed event object IDs. Supply full actual before/base/head IDs matching the repository object format."
      );
  }
  const updates = pairs.filter(pair => !/^0+$/u.test(pair.after));
  if (updates.length === 0) return [];
  if (gitRead(["rev-parse", "--is-shallow-repository"], cwd) !== "false")
    throw new HistorySecretError(
      "Incomplete shallow history. Fetch complete required history (unshallow the checkout) and actual before/head objects before retrying."
    );
  const metadata = gitRead(["rev-parse", "--absolute-git-dir"], cwd);
  if (
    existsSync(join(metadata, "info/grafts")) &&
    readFileSync(join(metadata, "info/grafts"), "utf8").trim()
  )
    throw new HistorySecretError(
      "Legacy Git grafts prevent complete history proof. Use an unmodified complete repository checkout."
    );
  const commits = new Set();
  // A new remote ref (zero `before`) has no old tip to subtract, and scanning
  // everything reachable from it counts the remote's own published history as
  // introduced: every new branch of an old repository then re-litigates its
  // root commit. What a push introduces is what the destination does not
  // already hold, so a new ref subtracts the push remote's tracking refs.
  // Without a resolvable remote, or with no tracking refs, nothing is
  // subtracted and the complete reachable history is scanned as before.
  const published = updates.some(pair => /^0+$/u.test(pair.before))
    ? remoteTips(pushRemoteName(remote, cwd), cwd)
    : [];
  for (const { before, after } of updates) {
    const next = gitRead(["rev-parse", "--verify", `${after}^{commit}`], cwd);
    const previous = /^0+$/u.test(before)
      ? null
      : gitRead(["rev-parse", "--verify", `${before}^{commit}`], cwd);
    for (const tip of [next, previous].filter(Boolean)) {
      const objects = gitRead(
        ["rev-list", "--objects", "--missing=print", tip],
        cwd
      );
      if (objects.split("\n").some(line => line.startsWith("?")))
        throw new HistorySecretError(
          "Required Git trees or blobs are missing. Fetch complete objects, repair the checkout and retry."
        );
    }
    // Exclusions go through stdin: a remote can hold more refs than one
    // command line carries.
    const exclusions = previous ? [previous] : published;
    const list = gitRead(
      ["rev-list", "--stdin", next],
      cwd,
      exclusions.map(oid => `^${oid}\n`).join("")
    );
    for (const commit of list.split("\n").filter(Boolean)) commits.add(commit);
  }
  return [...commits].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  );
};

/** Git's negotiated storage format determines accepted IDs. */
export const objectWidth = cwd => {
  const format = gitRead(["rev-parse", "--show-object-format"], cwd);
  if (format === "sha1") return 40;
  if (format === "sha256") return 64;
  throw new HistorySecretError(
    "Unsupported Git object format. Use a supported SHA-1 or SHA-256 checkout."
  );
};
