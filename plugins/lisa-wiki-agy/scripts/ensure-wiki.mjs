#!/usr/bin/env node
/**
 * ensure-wiki.mjs — resolve the project's wiki root, mirroring/refreshing a
 * remote wiki when one is configured. Dependency-free (Node built-ins only),
 * so it stays portable to any downstream repo that installs the plugin.
 *
 * This is the single resolver that `lisa-wiki-query` and `lisa-wiki-ingest`
 * call as step 0 so they never hardcode `wiki/` and never have to know whether
 * the wiki is local or remote. The mode decision lives HERE, not in the skills:
 *
 *   - LOCAL  — the wiki lives in this repo (the common case). Resolve the wiki
 *              root from `wiki/lisa-wiki.config.json` (`wikiRoot`, default
 *              `wiki`) and return it. No network, effectively a no-op.
 *   - REMOTE — `.lisa.config.json` declares `wiki.source.url`. Maintain a
 *              gitignored mirror of that repo and return the wiki root inside
 *              it. Clone-if-missing, fetch+fast-forward when stale (TTL), and
 *              tolerate being offline (proceed with the existing mirror + warn).
 *
 * Config (consumer repo `.lisa.config.json`, with `.lisa.config.local.json`
 * overriding per the config-resolution rule):
 *
 *   "wiki": {
 *     "source": {
 *       "url":        "git@github.com:org/wiki.git",  // present => REMOTE mode
 *       "ref":        "main",            // default: remote HEAD / "main"
 *       "mirrorPath": ".lisa/wiki",      // default; always gitignored
 *       "subdir":     "wiki"             // optional: wiki root within the repo
 *     },
 *     "ttlSeconds": 300                  // skip the fetch if synced more recently
 *   }
 *
 * Usage: node ensure-wiki.mjs [--cwd <dir>] [--json] [--ttl <seconds>] [--offline]
 *   --cwd      project dir to resolve config/mirror against (default cwd)
 *   --json     emit {mode, wikiRoot, mirrored, fetched, stale, offline} on stdout
 *   --ttl      override ttlSeconds (0 = always fetch)
 *   --offline  never touch the network; use whatever is already on disk
 *
 * Output: the resolved absolute wiki root is the LAST line on stdout (so a
 * caller can `WIKI_ROOT=$(node ensure-wiki.mjs | tail -1)`). All human-facing
 * progress goes to stderr. Exit 0 = a usable wiki root was resolved; 1 = not.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const GITIGNORE_BEGIN = "# BEGIN: AI GUARDRAILS WIKI MIRROR";
const GITIGNORE_END = "# END: AI GUARDRAILS WIKI MIRROR";
const DEFAULT_MIRROR = ".lisa/wiki";
const DEFAULT_TTL_SECONDS = 300;

function log(msg) {
  process.stderr.write(`${msg}\n`);
}
function fail(msg) {
  log(`✗ ${msg}`);
  process.exit(1);
}
function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}
function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  }).trim();
}

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function flagValue(name) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
}
const projectDir = path.resolve(flagValue("--cwd") ?? process.cwd());
const asJson = argv.includes("--json");
const offline = argv.includes("--offline");
const ttlOverride = flagValue("--ttl");

// ── resolve the wiki source from .lisa.config.json (+ .local override) ────────
const committed =
  readJsonSafe(path.join(projectDir, ".lisa.config.json")) ?? {};
const local =
  readJsonSafe(path.join(projectDir, ".lisa.config.local.json")) ?? {};
const wikiCfg = { ...(committed.wiki ?? {}), ...(local.wiki ?? {}) };
const source = {
  ...(committed.wiki?.source ?? {}),
  ...(local.wiki?.source ?? {}),
};
const ttlSeconds = Number(
  ttlOverride ?? wikiCfg.ttlSeconds ?? DEFAULT_TTL_SECONDS
);

if (source.url !== undefined && typeof source.url !== "string") {
  fail("`wiki.source.url` in .lisa.config.json must be a string");
}

function emit(result) {
  if (asJson) process.stdout.write(`${JSON.stringify(result)}\n`);
  else process.stdout.write(`${result.wikiRoot}\n`);
  process.exit(0);
}

// ── LOCAL mode ────────────────────────────────────────────────────────────────
if (!source.url) {
  const localCfg = readJsonSafe(
    path.join(projectDir, "wiki", "lisa-wiki.config.json")
  );
  const wikiRoot = path.resolve(projectDir, localCfg?.wikiRoot ?? "wiki");
  if (!fs.existsSync(path.join(wikiRoot, "index.md"))) {
    log(
      `⚠ no index.md under ${wikiRoot} — local wiki may not be scaffolded yet (run /lisa-wiki:setup)`
    );
  }
  log(`✓ local wiki: ${wikiRoot}`);
  emit({
    mode: "local",
    wikiRoot,
    mirrored: false,
    fetched: false,
    stale: false,
    offline,
  });
}

// ── REMOTE mode ───────────────────────────────────────────────────────────────
const mirrorPath = path.resolve(
  projectDir,
  source.mirrorPath ?? DEFAULT_MIRROR
);
const ref = source.ref || "";
ensureGitignored(projectDir, source.mirrorPath ?? DEFAULT_MIRROR);

const isClone = fs.existsSync(path.join(mirrorPath, ".git"));
let fetched = false;
let stale = false;

if (!isClone) {
  if (offline) fail(`offline and no mirror present at ${mirrorPath}`);
  log(`↧ cloning wiki ${source.url} → ${mirrorPath}`);
  try {
    fs.mkdirSync(path.dirname(mirrorPath), { recursive: true });
    const cloneArgs = ["clone", "--depth", "1"];
    if (ref) cloneArgs.push("--branch", ref);
    cloneArgs.push(source.url, mirrorPath);
    git(cloneArgs, projectDir);
    fetched = true;
    stampSync(mirrorPath);
  } catch (e) {
    fail(`clone failed: ${String(e.message ?? e).split("\n")[0]}`);
  }
} else if (offline) {
  log("• offline — using existing mirror without fetching");
  stale = true;
} else if (isFresh(mirrorPath, ttlSeconds)) {
  log(`• mirror synced < ${ttlSeconds}s ago — skipping fetch`);
} else {
  // Stale: fetch and hard-reset. The mirror is a read-only working copy of the
  // canonical wiki — never edited in place — so resetting to the remote ref is
  // safe and keeps it byte-identical to upstream.
  try {
    const branch =
      ref || git(["rev-parse", "--abbrev-ref", "HEAD"], mirrorPath);
    log(`↻ refreshing wiki mirror (${branch})`);
    git(["fetch", "--depth", "1", "origin", branch], mirrorPath);
    git(["reset", "--hard", `origin/${branch}`], mirrorPath);
    fetched = true;
    stampSync(mirrorPath);
  } catch (e) {
    // Offline-tolerant: a fetch failure must not block work when we already
    // have a usable (if stale) copy on disk.
    log(
      `⚠ refresh failed (${String(e.message ?? e).split("\n")[0]}) — using stale mirror`
    );
    stale = true;
  }
}

const wikiRoot = resolveWikiRootInMirror(mirrorPath, source.subdir);
if (!fs.existsSync(path.join(wikiRoot, "index.md"))) {
  log(
    `⚠ no index.md under ${wikiRoot} — check wiki.source.subdir / the wiki repo layout`
  );
}
log(`✓ remote wiki mirror: ${wikiRoot}`);
emit({ mode: "remote", wikiRoot, mirrored: true, fetched, stale, offline });

// ── helpers ───────────────────────────────────────────────────────────────────

/** Locate the wiki content root inside a cloned wiki repo. */
function resolveWikiRootInMirror(mirror, subdir) {
  if (subdir) return path.resolve(mirror, subdir);
  if (fs.existsSync(path.join(mirror, "wiki", "index.md")))
    return path.join(mirror, "wiki");
  return mirror; // dedicated wiki repo with content at its root
}

/** TTL stamp lives under .git so it is never part of the wiki content. */
function stampPath(mirror) {
  return path.join(mirror, ".git", "lisa-wiki-sync");
}
function stampSync(mirror) {
  try {
    fs.writeFileSync(stampPath(mirror), String(Date.now()));
  } catch {
    /* best-effort */
  }
}
function isFresh(mirror, ttl) {
  if (ttl <= 0) return false;
  let last = NaN;
  try {
    last = Number(fs.readFileSync(stampPath(mirror), "utf8"));
  } catch {
    return false;
  }
  if (!Number.isFinite(last)) return false;
  return Date.now() - last < ttl * 1000;
}

/** Idempotently keep the mirror path out of version control. */
function ensureGitignored(dir, relPath) {
  const gitignorePath = path.join(dir, ".gitignore");
  const line = `/${relPath.replace(/^\/+/, "").replace(/\/+$/, "")}/`;
  const block = `${GITIGNORE_BEGIN}\n# Remote wiki mirror — gitignored working copy, managed by ensure-wiki.\n${line}\n${GITIGNORE_END}`;
  const existing = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, "utf8")
    : null;
  if (existing && existing.includes(line)) return; // already ignored (any block)
  const start = existing?.indexOf(GITIGNORE_BEGIN) ?? -1;
  let merged;
  if (existing === null) {
    merged = `${block}\n`;
  } else if (start !== -1) {
    const end = existing.indexOf(GITIGNORE_END, start) + GITIGNORE_END.length;
    merged = `${existing.slice(0, start)}${block}${existing.slice(end)}`;
  } else {
    const base = existing.endsWith("\n") ? existing : `${existing}\n`;
    merged = `${base}\n${block}\n`;
  }
  fs.writeFileSync(gitignorePath, merged);
  log(`✓ ensured ${line} is gitignored`);
}
