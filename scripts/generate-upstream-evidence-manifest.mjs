#!/usr/bin/env node
/** Generate the exact hash-pinned allowlist for public upstream evidence. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { boundedExecFileSync } from "./lib/bounded-spawn.mjs";
import { formatGeneratedJson } from "./lib/merge-generated-json.mjs";
import {
  describeStaleManifest,
  diagnoseStaleManifest,
} from "./lib/upstream-manifest-staleness.mjs";
import {
  droppedPublicCommits,
  MANIFEST_PATH,
  REFRESH_PUBLIC_COMMITS_COMMAND,
} from "./lib/upstream-public-commits.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
/**
 * Where the manifest data lives.
 *
 * JSON rather than a TypeScript module, for the reason argued at
 * `scripts/generate-export-surface.mjs`: data does not need to be source. Every
 * tracked path and every public commit is one line here, far past the 300-line
 * `max-lines` budget source answers to, so as a module it could only exist
 * behind a file-wide lint waiver. `src/core/upstream-evidence-manifest.ts` is the
 * hand-written loader that turns it into the frozen records the runtime reads.
 */
const outputRelativePath = "src/core/upstream-evidence-manifest.json";
const outputPath = path.join(repoRoot, outputRelativePath);
const packagedEvidencePrefixes = [
  "plugins/src/",
  "all/",
  "cdk/",
  "expo/",
  "eslint-plugin-code-organization/",
  "eslint-plugin-component-structure/",
  "eslint-plugin-phaser/",
  "eslint-plugin-ui-standards/",
  "harper-fabric/",
  "nestjs/",
  "npm-package/",
  "oxlint/",
  "phaser/",
  "rails/",
  "scripts/",
  "tsconfig/",
  "typescript/",
];
const forbiddenSegments = new Set([
  ".claude-plugin",
  ".git",
  ".lisa",
  ".mcp",
  "node_modules",
]);
const forbiddenBasenames = new Set([
  ".lisa.config.json",
  ".mcp.json",
  "audit.local",
]);
/** The repository this manifest may be generated from. Not a URL — see below. */
const canonicalRepository = "CodySwannGT/lisa";

/**
 * The `owner/repo` an origin URL points at, or null if it names none.
 *
 * The guard exists to refuse hash-pinning from a fork, which is a question
 * about **identity**. It used to compare the whole origin URL against a list of
 * spellings, which answers a question about **transport** instead — and the two
 * come apart in ordinary situations, not just exotic ones. `remote.origin.url`
 * and `remote.origin.pushurl` can differ, `url.<base>.insteadOf` rewrites what
 * `git remote get-url` returns, and a cloud container clones through a local
 * git proxy. All three are proxied checkouts of the real repository, and all
 * three were refused before a single hash was checked.
 *
 * Comparing the path keeps the property that matters: a fork is
 * `someone-else/lisa` and is still refused, while `https://…`, `git@…` and
 * `http://local_proxy@127.0.0.1:PORT/git/…` all resolve to the same identity.
 * @param {string} url Whatever `git remote get-url` returned.
 * @returns {string|null} `owner/repo`, lowercased, or null.
 */
function repositoryPath(url) {
  // scp-style (git@host:owner/repo.git) is not a URL, so it is handled first.
  const scp = /^[^/]+@[^:/]+:(?<path>.+)$/u.exec(url);
  const raw =
    scp?.groups?.path ?? (URL.canParse(url) ? new URL(url).pathname : null);
  if (raw === null) return null;
  const segments = raw
    .replace(/\.git$/u, "")
    .split("/")
    .filter(Boolean);
  if (segments.length < 2) return null;
  return segments.slice(-2).join("/").toLowerCase();
}

// The configured value rather than the resolved one, for the same reason the
// comparison is by path: `url.<base>.insteadOf` rewrites what `git remote
// get-url` returns, so it answers "how do I reach this" rather than "what is
// this". Falls back to the resolved URL only if no value is configured.
const originUrl = boundedExecFileSync(
  "git",
  ["config", "--get", "remote.origin.url"],
  { cwd: repoRoot, encoding: "utf8" }
).trim();
if (repositoryPath(originUrl) !== canonicalRepository.toLowerCase()) {
  throw new Error(
    `Refusing to generate from a non-canonical repository.\n` +
      `origin resolves to: ${repositoryPath(originUrl) ?? "(no owner/repo)"}\n` +
      `expected:           ${canonicalRepository}\n` +
      `(origin URL was: ${originUrl})`
  );
}

const tracked = boundedExecFileSync("git", ["ls-files", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
const explicitlyIncluded = ["scripts/generate-upstream-evidence-manifest.mjs"];
const publicSurfaceMembers = [...new Set([...tracked, ...explicitlyIncluded])]
  .filter(file => file !== outputRelativePath)
  .filter(file => existsSync(path.join(repoRoot, file)))
  .filter(file => {
    const segments = file.split("/");
    const basename = segments.at(-1) ?? "";
    return (
      !segments.some(segment => forbiddenSegments.has(segment)) &&
      !forbiddenBasenames.has(basename) &&
      !basename.endsWith(".local")
    );
  })
  .sort();
const evidenceMembers = publicSurfaceMembers.filter(file =>
  packagedEvidencePrefixes.some(prefix => file.startsWith(prefix))
);
/**
 * The public commits the checked-in manifest already records.
 *
 * Seeded forward rather than recomputed: a clone without every origin ref
 * cannot rediscover them, and the generator refuses to emit an empty set. An
 * unreadable or malformed file carries nothing forward, which the empty-set
 * refusal below then reports.
 * @returns {string[]} Recorded full commit SHAs
 */
function readExistingPublicCommits() {
  if (!existsSync(outputPath)) return [];
  try {
    const recorded = JSON.parse(
      readFileSync(outputPath, "utf8")
    ).UPSTREAM_PUBLIC_COMMITS;
    return Object.keys(recorded ?? {}).filter(commit =>
      /^[a-f0-9]{40}$/u.test(commit)
    );
  } catch {
    return [];
  }
}
const existingPublicCommits = readExistingPublicCommits();
const refreshPublicCommits = process.argv.includes("--refresh-public-commits");

/**
 * Every commit reachable from a public origin ref, read from local history.
 *
 * The release hook runs this (`.versionrc` `postbump`), which makes the two
 * ways the read can come back short a release defect rather than a developer's
 * inconvenience (CodySwannGT/lisa#4960):
 *
 * - **A shallow clone holds only the commits above its cut-off**, and
 *   `git rev-list` reports those without complaint. The result would still
 *   contain the newest commit, so nothing downstream could tell it from a
 *   complete list — while every commit merged since the previous release was
 *   missing, which is the defect the release-time refresh exists to end. So a
 *   shallow clone is refused outright. A linked worktree is not affected: it
 *   shares its repository's refs and reads the same history.
 * - **Node caps a child's output at one megabyte by default**, which this
 *   command reaches at about 25,500 commits. Past that it throws `ENOBUFS` on
 *   every run. The ceiling is therefore stated, far above any real history.
 * @returns {string[]} Full SHAs, in the order git listed them.
 */
function discoverPublicCommits() {
  const shallow = boundedExecFileSync(
    "git",
    ["rev-parse", "--is-shallow-repository"],
    { cwd: repoRoot, encoding: "utf8" }
  ).trim();
  if (shallow !== "false") {
    throw new Error(
      "Refusing to refresh the public commit list from a shallow clone.\n" +
        "A shallow clone holds only its most recent commits, so the list would\n" +
        "silently omit every older commit that is not on it yet.\n" +
        "Fetch the full history first (`git fetch --unshallow origin`, or\n" +
        "`fetch-depth: 0` on the checkout step in CI), then rerun:\n" +
        `  ${REFRESH_PUBLIC_COMMITS_COMMAND}`
    );
  }
  return boundedExecFileSync("git", ["rev-list", "--remotes=origin"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
    .split("\n")
    .filter(commit => /^[a-f0-9]{40}$/.test(commit));
}

const discoveredPublicCommits = refreshPublicCommits
  ? discoverPublicCommits()
  : [];
const publicCommits = [
  ...new Set([...existingPublicCommits, ...discoveredPublicCommits]),
].sort();

if (publicSurfaceMembers.length === 0 || evidenceMembers.length === 0) {
  throw new Error("Refusing to generate an empty upstream evidence manifest");
}
if (publicCommits.length === 0) {
  throw new Error(
    "Refusing to generate an empty public origin commit manifest; rerun with --refresh-public-commits from a full canonical-origin clone"
  );
}
// The list is carried forward by matching the exact line shape written below.
// If the recorded file ever stops matching it, the carry-forward comes back
// short and the new list is simply smaller — no error, just lost commits. The
// looser read in `droppedPublicCommits` is what notices.
const droppedCommits = droppedPublicCommits(existingOutput, publicCommits);
if (droppedCommits.length > 0) {
  throw new Error(
    `Refusing to write a public commit list that would drop ${droppedCommits.length} recorded commit(s):\n` +
      `${droppedCommits
        .slice(0, 10)
        .map(commit => `  ${commit}`)
        .join("\n")}\n` +
      "The list only ever grows. The recorded file lists these commits in a\n" +
      "form this generator does not read back, which usually means the\n" +
      "generated file was reformatted or edited by hand. Restore\n" +
      `${MANIFEST_PATH} from git and rerun.`
  );
}

const output = formatGeneratedJson({
  UPSTREAM_EVIDENCE_MANIFEST: Object.fromEntries(
    evidenceMembers.map(file => [
      file,
      createHash("sha256")
        .update(readFileSync(path.join(repoRoot, file)))
        .digest("hex"),
    ])
  ),
  UPSTREAM_SURFACE_MANIFEST: Object.fromEntries(
    publicSurfaceMembers.map(file => [file, true])
  ),
  UPSTREAM_PUBLIC_COMMITS: Object.fromEntries(
    publicCommits.map(commit => [commit, true])
  ),
});

if (process.argv.includes("--check")) {
  const current = readFileSync(outputPath, "utf8");
  if (current !== output) {
    // Not just "this file is out of date" — WHICH input moved, and the recovery
    // for that particular way of moving. Naming only the file that is stale
    // points at regenerating it, which is the fix for one of three causes and a
    // loop for the other two. See scripts/lib/upstream-manifest-staleness.mjs.
    throw new Error(
      describeStaleManifest(diagnoseStaleManifest(current, output))
    );
  }
} else {
  writeFileSync(outputPath, output);
}
