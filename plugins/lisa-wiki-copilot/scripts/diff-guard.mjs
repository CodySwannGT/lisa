#!/usr/bin/env node
/**
 * diff-guard.mjs — enforce a connector's touched-file boundary. Dependency-free
 * (git + Node built-ins).
 *
 * Run AFTER a connector returns and BEFORE the kernel synthesizes: a connector may
 * write ONLY its declared source-note path(s) and run-metadata. Any repo change
 * outside the allowed globs is a hard failure (this is what makes "source-note only"
 * enforceable, not aspirational). Writes outside the repo (e.g. external-write to a
 * remote system) are not git-visible and so are not policed here.
 *
 * The change set ALWAYS includes untracked files (connectors create new files), so a
 * stray new file can never bypass the guard. `--base <ref>` additionally unions a
 * committed range. Paths are read NUL-safe to handle renames/quoting.
 *
 * Usage: node diff-guard.mjs --allow <glob> [--allow <glob>...] [--base <ref>]
 * Exit 0 = all changes within allowed globs, 1 = out-of-bounds change (or git error).
 */
import { execFileSync } from "node:child_process";
import { globToRegExp } from "./_wiki-lib.mjs";

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const allows = [];
let base;
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === "--allow") {
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) fail("--allow requires a glob argument");
    allows.push(v);
    i += 1;
  } else if (a === "--base") {
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) fail("--base requires a ref argument");
    base = v;
    i += 1;
  } else {
    fail(`unknown argument: ${a}`);
  }
}

if (allows.length === 0) {
  fail(
    "diff-guard requires at least one --allow <glob> (the connector's permitted paths)"
  );
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

let repoRoot;
try {
  repoRoot = git(["rev-parse", "--show-toplevel"]).trim();
} catch {
  fail("not inside a git repository");
}
const inRepo = args => ["-C", repoRoot, ...args];

// Working-tree change set, NUL-safe, including untracked files. Renames/copies
// (status starts with R/C) emit the destination then the source as separate NUL
// records — include both so neither side can slip outside the allow-list.
function workingTreePaths() {
  const out = git(
    inRepo(["status", "--porcelain=v1", "-z", "--untracked-files=all"])
  );
  const records = out.split("\0");
  const paths = [];
  for (let i = 0; i < records.length; i += 1) {
    const rec = records[i];
    if (!rec) continue;
    const status = rec.slice(0, 2);
    const p = rec.slice(3);
    if (p) paths.push(p);
    if (status[0] === "R" || status[0] === "C") {
      i += 1;
      if (records[i]) paths.push(records[i]);
    }
  }
  return paths;
}

let changed = [];
try {
  changed = workingTreePaths();
  if (base) {
    changed = changed.concat(
      git(inRepo(["diff", "--name-only", "-z", base])).split("\0")
    );
  }
} catch (e) {
  fail(`git failed: ${e.message}`);
}

changed = [...new Set(changed.map(s => s.trim()).filter(Boolean))];
const matchers = allows.map(globToRegExp);
const isAllowed = p => matchers.some(re => re.test(p));
const violations = changed.filter(p => !isAllowed(p));

if (violations.length > 0) {
  console.error(
    `✗ diff-guard: ${violations.length} change(s) outside the allowed connector paths:`
  );
  for (const v of violations) console.error(`  - ${v}`);
  console.error(`  allowed: ${allows.join(", ")}`);
  process.exit(1);
}

console.log(
  `✓ diff-guard: ${changed.length} change(s) all within allowed paths (${allows.join(", ")}).`
);
