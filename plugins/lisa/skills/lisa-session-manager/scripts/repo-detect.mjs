/**
 * Which children of a multi-repo project's repos root are real, routable
 * repos, and a first draft of the hints the manager routes on.
 *
 * A host's `projects/` dir collects more than one checkout per repo: linked
 * worktrees agents made for a ticket (`.git` is a FILE pointing back at the
 * main clone), and whole second clones of the same remote (`api-se1234`).
 * Each carries the repo's own `.lisa.config.json`, so counting config files
 * alone proposed 110 routed repos for a project with 4 (CodySwannGT/lisa#4465)
 * and the operator had to prune them by hand. A worker routed into a stale
 * ticket worktree builds on the wrong branch, so the detector keeps one
 * checkout per remote: the one named after the repo when there is one.
 *
 * Not every multi-repo host has a `projects/` dir: some keep each repo as a
 * direct child of the project root (`api/`, `web/`, `infra/`). Setup checks
 * `projects/` first and falls back to the root's own children. At the root a
 * child must also be its own checkout (it has a `.git`): a folder of a
 * single-repo project that happens to hold a `.lisa.config.json` is part of
 * that repo, not a repo to route workers into.
 *
 * Every filesystem call goes through an injectable seam.
 * @module session-manager/repo-detect
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** One path segment that cannot climb out of, or hide inside, its parent. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** `url = <value>` inside the `[remote "origin"]` section of a git config. */
const ORIGIN_SECTION = /^\s*\[remote\s+"origin"\]\s*$/;
const ANY_SECTION = /^\s*\[/;
const URL_LINE = /^\s*url\s*=\s*(\S+)\s*$/;

/**
 * Well-known dependencies and the hint each one implies. Order is the order
 * hints are listed in. A key ending in `/` matches every package under that
 * scope.
 */
const DEPENDENCY_HINTS = Object.freeze([
  ["@nestjs/", "NestJS"],
  ["typeorm", "TypeORM"],
  ["prisma", "Prisma"],
  ["@prisma/client", "Prisma"],
  ["@apollo/server", "GraphQL API"],
  ["graphql", "GraphQL"],
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["serverless", "Serverless"],
  ["expo", "Expo"],
  ["react-native", "React Native"],
  ["next", "Next.js"],
  ["react", "React"],
  ["vue", "Vue"],
  ["@angular/core", "Angular"],
  ["@apollo/client", "Apollo client"],
  ["aws-cdk-lib", "AWS CDK"],
  ["@pulumi/pulumi", "Pulumi"],
  ["@langchain/langgraph", "LangGraph"],
  ["@langchain/core", "LangChain"],
  ["@anthropic-ai/sdk", "Claude API"],
  ["@aws-sdk/client-bedrock-runtime", "Bedrock"],
  ["phaser", "Phaser"],
  ["@playwright/test", "Playwright"],
]);

/** The default filesystem seam. */
const NODE_FS = { existsSync, readdirSync, readFileSync, statSync };

/**
 * Reduce a git remote URL to `host/owner/repo` so the SSH and HTTPS spellings
 * of one remote compare equal. Returns null for anything unparseable.
 * @param {string} url - Remote URL as written in `.git/config`
 * @returns {string | null} Normalized identity, lowercased
 */
export function normalizeRemote(url) {
  const trimmed = String(url ?? "").trim();
  const scp = /^[^@/]+@([^:/]+):(.+)$/.exec(trimmed);
  const parsed = scp
    ? null
    : /^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(trimmed);
  const match = scp ?? parsed;
  if (!match) return null;
  const repoPath = match[2].replace(/\/+$/, "").replace(/\.git$/, "");
  return repoPath ? `${match[1]}/${repoPath}`.toLowerCase() : null;
}

/**
 * The `origin` URL from a clone's `.git/config`, or null.
 * @param {string} dir - Child directory
 * @param {typeof NODE_FS} fs - Filesystem seam
 * @returns {string | null} Raw URL
 */
function readOrigin(dir, fs) {
  let text;
  try {
    text = fs.readFileSync(join(dir, ".git", "config"), "utf8");
  } catch {
    return null;
  }
  let inOrigin = false;
  for (const line of text.split(/\r?\n/)) {
    if (ANY_SECTION.test(line)) inOrigin = ORIGIN_SECTION.test(line);
    const url = inOrigin ? URL_LINE.exec(line) : null;
    if (url) return url[1];
  }
  return null;
}

/** The `gitdir:` line of a linked worktree points into `.git/worktrees/`. */
const WORKTREE_GITDIR = /^gitdir:\s*\S*[\\/]worktrees[\\/]/m;

/**
 * Whether `<dir>` is a linked worktree: its `.git` is a file whose `gitdir:`
 * points into another clone's `worktrees/`. A `.git` file that points
 * anywhere else (a submodule, `--separate-git-dir`) may be the only checkout
 * of its repo, so it is kept.
 * @param {string} dir - Child directory
 * @param {typeof NODE_FS} fs - Filesystem seam
 * @returns {boolean} True for a linked worktree
 */
function isLinkedWorktree(dir, fs) {
  const marker = join(dir, ".git");
  try {
    if (!fs.statSync(marker).isFile()) return false;
    return WORKTREE_GITDIR.test(fs.readFileSync(marker, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Keep one child per remote: the one whose name is the remote's repo name,
 * else the lexically first. Children with no readable origin are each kept.
 * @param {Array<{ name: string, remote: string | null }>} children - Sorted
 * @returns {string[]} Kept names, sorted
 */
function onePerRemote(children) {
  const groups = new Map();
  const kept = [];
  for (const child of children) {
    if (child.remote === null) kept.push(child.name);
    else groups.set(child.remote, [...(groups.get(child.remote) ?? []), child]);
  }
  for (const [remote, members] of groups) {
    const repoName = remote.split("/").at(-1);
    const named = members.find(
      member => member.name.toLowerCase() === repoName
    );
    kept.push((named ?? members[0]).name);
  }
  return kept.sort();
}

/**
 * List the routable child repos of a multi-repo project.
 *
 * A child counts only when it carries its own `.lisa.config.json` (workers
 * run `/lisa:implement` inside it, which needs that file), is not a linked
 * worktree, and is the chosen checkout of its remote.
 * @param {string} root - Project root
 * @param {{ reposRoot?: string, requireGit?: boolean,
 *   fs?: Partial<typeof NODE_FS> }} [options] - Repos root (default
 *   `projects`), whether a child needs its own `.git`, and filesystem seam
 * @returns {string[]} Child directory names, sorted
 */
export function detectRepos(root, options = {}) {
  const fs = { ...NODE_FS, ...options.fs };
  const base = join(root, options.reposRoot ?? "projects");
  if (!fs.existsSync(base)) return [];
  const children = fs
    .readdirSync(base, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && SAFE_SEGMENT.test(entry.name))
    .map(entry => ({ name: entry.name, dir: join(base, entry.name) }))
    .filter(child => fs.existsSync(join(child.dir, ".lisa.config.json")))
    .filter(
      child => !options.requireGit || fs.existsSync(join(child.dir, ".git"))
    )
    .filter(child => !isLinkedWorktree(child.dir, fs))
    .map(child => ({
      name: child.name,
      remote: normalizeRemote(readOrigin(child.dir, fs) ?? ""),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  return onePerRemote(children);
}

/**
 * Where setup looks for child repos, in order. `.` is the root itself, where
 * only children with their own `.git` count.
 */
const LAYOUT_CANDIDATES = Object.freeze([
  { reposRoot: "projects", requireGit: false },
  { reposRoot: ".", requireGit: true },
]);

/**
 * Find where a multi-repo project keeps its repos and which ones are routable.
 * The first candidate that yields any repo wins: `projects/`, then the
 * project root's direct children that are their own checkouts. A project
 * where neither yields one is single-repo, reported with the default
 * `projects` root and no repos.
 * @param {string} root - Project root
 * @param {{ fs?: Partial<typeof NODE_FS> }} [options] - Filesystem seam
 * @returns {{ reposRoot: string, repos: string[] }} Repos root and names
 */
export function detectRepoLayout(root, options = {}) {
  for (const { reposRoot, requireGit } of LAYOUT_CANDIDATES) {
    const repos = detectRepos(root, { ...options, reposRoot, requireGit });
    if (repos.length > 0) return { reposRoot, repos };
  }
  return { reposRoot: LAYOUT_CANDIDATES[0].reposRoot, repos: [] };
}

/**
 * Draft routing hints for one child: its name, then a hint per well-known
 * dependency in its `package.json`. Only a draft; setup asks the operator to
 * review it. A child with no `package.json`, or none of the known
 * dependencies, keeps just its name.
 * @param {string} dir - Child directory
 * @param {string} name - Child name (always the first hint)
 * @param {{ fs?: Partial<typeof NODE_FS> }} [options] - Filesystem seam
 * @returns {string[]} Hints, de-duplicated, name first
 */
export function draftHints(dir, name, options = {}) {
  const fs = { ...NODE_FS, ...options.fs };
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(join(dir, "package.json"), "utf8"));
  } catch {
    return [name];
  }
  const deps = Object.keys({
    ...manifest?.dependencies,
    ...manifest?.devDependencies,
  });
  const hints = DEPENDENCY_HINTS.filter(([key]) =>
    key.endsWith("/")
      ? deps.some(dep => dep.startsWith(key))
      : deps.includes(key)
  ).map(([, hint]) => hint);
  return [...new Set([name, ...hints])];
}
