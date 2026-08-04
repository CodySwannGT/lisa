#!/usr/bin/env node
/** Generate the exact hash-pinned allowlist for public upstream evidence. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const outputPath = path.join(
  repoRoot,
  "src/core/upstream-evidence-manifest.ts"
);
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
  "ui/",
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
const originUrl = execFileSync(
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

const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
const explicitlyIncluded = ["scripts/generate-upstream-evidence-manifest.mjs"];
const publicSurfaceMembers = [...new Set([...tracked, ...explicitlyIncluded])]
  .filter(file => file !== "src/core/upstream-evidence-manifest.ts")
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
const existingOutput = existsSync(outputPath)
  ? readFileSync(outputPath, "utf8")
  : "";
const existingPublicCommits = [
  ...existingOutput.matchAll(
    /^\s+(?:"([0-9][a-f0-9]{39})"|([a-f][a-f0-9]{39})):\s+true,$/gmu
  ),
]
  .map(match => match[1] ?? match[2] ?? "")
  .filter(Boolean);
const refreshPublicCommits = process.argv.includes("--refresh-public-commits");
const discoveredPublicCommits = refreshPublicCommits
  ? execFileSync("git", ["rev-list", "--remotes=origin"], {
      cwd: repoRoot,
      encoding: "utf8",
    })
      .split("\n")
      .filter(commit => /^[a-f0-9]{40}$/.test(commit))
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

const formatObjectKey = value =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : JSON.stringify(value);
const surfaceEntries = publicSurfaceMembers.map(
  file => `    ${formatObjectKey(file)}: true,`
);
const evidenceEntries = evidenceMembers.map(file => {
  const digest = createHash("sha256")
    .update(readFileSync(path.join(repoRoot, file)))
    .digest("hex");
  return `    ${JSON.stringify(file)}:\n      ${JSON.stringify(digest)},`;
});
const commitEntries = publicCommits.map(commit => {
  return `    ${formatObjectKey(commit)}: true,`;
});
const output = `/* eslint-disable max-lines -- generated exact public-evidence allowlist */
/** Generated by scripts/generate-upstream-evidence-manifest.mjs. Do not edit. */
export const UPSTREAM_EVIDENCE_MANIFEST: Readonly<Record<string, string>> =
  Object.freeze({
${evidenceEntries.join("\n")}
  });

/** Exact paths tracked by the public Lisa repository at generation time. */
export const UPSTREAM_SURFACE_MANIFEST: Readonly<Record<string, true>> =
  Object.freeze({
${surfaceEntries.join("\n")}
  });

/** Full commit SHAs reachable from public origin refs when this package was built. */
export const UPSTREAM_PUBLIC_COMMITS: Readonly<Record<string, true>> =
  Object.freeze({
${commitEntries.join("\n")}
  });
/* eslint-enable max-lines -- end generated exact public-evidence allowlist */
`;

if (process.argv.includes("--check")) {
  const current = readFileSync(outputPath, "utf8");
  if (current !== output) {
    throw new Error(
      "src/core/upstream-evidence-manifest.ts is stale; run bun run build:upstream-evidence-manifest"
    );
  }
} else {
  writeFileSync(outputPath, output);
}
