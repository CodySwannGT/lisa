#!/usr/bin/env node
/**
 * ingest-git.mjs — git/PR-history connector. Dependency-free (git + optional gh).
 * Read-only: it never checks out, fetches, or mutates the target repo.
 *
 * Writes a sanitized, dated source note under <source-dir> summarizing commits (and
 * merged PRs, if `gh` is available) since the cursor, and emits a PROPOSED next cursor
 * to --emit-meta. It does NOT advance final state — the kernel does that after
 * verification (per the §7 connector contract).
 *
 * Usage:
 *   node ingest-git.mjs --repo <path> [--slug <name>] [--config <p>]
 *     [--source-dir <dir>] [--state <file>] [--emit-meta <file>]
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readJsonSafe, writeSanitizedSourceNote } from "./_wiki-lib.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i !== -1 ? argv[i + 1] : d;
};
const repo = path.resolve(opt("--repo", "."));
const slug = opt("--slug", path.basename(repo));
const githubRepo = opt("--github-repo"); // owner/repo for PR history (else inferred via gh)
const fileSlug = slug.replace(/[^A-Za-z0-9_.-]+/g, "-"); // safe for filenames
const sourceDir = path.resolve(opt("--source-dir", "wiki/sources/git"));
const statePath = opt("--state");
const emitMeta = opt("--emit-meta");

const fail = m => {
  console.error(`✗ ${m}`);
  process.exit(1);
};
const git = args =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
const tryGit = args => {
  try {
    return git(args);
  } catch {
    return "";
  }
};
const commitExists = c => {
  try {
    execFileSync("git", ["-C", repo, "cat-file", "-e", `${c}^{commit}`], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};
if (
  !fs.existsSync(path.join(repo, ".git")) &&
  !tryGit(["rev-parse", "--is-inside-work-tree"])
) {
  fail(`not a git repository: ${repo}`);
}

const cursor = statePath ? (readJsonSafe(statePath)?.cursor ?? {}) : {};
const lastCommit = cursor.lastCommit;
const head = tryGit(["rev-parse", "HEAD"]);
if (!head) fail("could not resolve HEAD (empty repo?)");
if (lastCommit && !commitExists(lastCommit)) {
  fail(
    `cursor commit ${lastCommit} not found in ${repo}; refusing to silently re-window from HEAD`
  );
}

const range = lastCommit ? `${lastCommit}..HEAD` : "HEAD";
const logLines = tryGit([
  "log",
  range,
  "--pretty=format:%h\t%ad\t%s",
  "--date=short",
])
  .split("\n")
  .filter(Boolean);
const totalCommits = Number(tryGit(["rev-list", "--count", "HEAD"]) || "0");

// merged PRs via gh (optional, read-only); resolve the GitHub repo explicitly
let lastPr = cursor.lastPr ?? null;
let prSummary = "(no GitHub repo resolved — PR history skipped)";
let ghRepo = githubRepo;
if (!ghRepo) {
  try {
    ghRepo = execFileSync(
      "gh",
      ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
      { cwd: repo, encoding: "utf8" }
    ).trim();
  } catch {
    ghRepo = "";
  }
}
if (ghRepo) {
  try {
    const prs = JSON.parse(
      execFileSync(
        "gh",
        [
          "pr",
          "list",
          "--repo",
          ghRepo,
          "--state",
          "merged",
          "--limit",
          "20",
          "--json",
          "number,title,mergedAt",
        ],
        { cwd: repo, encoding: "utf8" }
      )
    );
    if (prs.length) {
      lastPr = prs[0].number;
      prSummary = `${prs.length} recent merged PR(s) in ${ghRepo}; latest #${prs[0].number} "${prs[0].title}"`;
    } else {
      prSummary = `no merged PRs found in ${ghRepo}`;
    }
  } catch {
    prSummary = `(gh pr list failed for ${ghRepo} — PR history skipped)`;
  }
}

const date = new Date().toISOString().slice(0, 10);
const newCommits = logLines.length;
const notePath = path.join(sourceDir, `${date}-${fileSlug}-git.md`);
const note = `---
type: source
created: ${date}
updated: ${date}
related: []
sources: []
source_system: git
project: ${slug}
---

# git history — ${slug} (${date})

- Repo: \`${repo}\`
- HEAD: \`${head}\`
- Total commits on HEAD: ${totalCommits}
- New commits since last ingest${lastCommit ? ` (\`${lastCommit}\`)` : " (first run)"}: ${newCommits}
- Merged PRs: ${prSummary}

## New commits
${
  newCommits
    ? logLines
        .slice(0, 200)
        .map(l => `- ${l.replace(/\t/g, " · ")}`)
        .join("\n")
    : "_(none)_"
}
`;

const safety = writeSanitizedSourceNote(notePath, note, {
  sourceId: path.relative(process.cwd(), notePath),
  sourceSystem: "git",
  project: slug,
});

const meta = {
  connector: "git",
  profile: slug,
  ranAt: new Date().toISOString(),
  proposedCursor: { lastCommit: head, lastPr },
  sourceNotes: [path.relative(process.cwd(), notePath)],
  safety: {
    reviewRequired: safety.reviewRequired,
    findings: safety.findings,
  },
};
if (emitMeta) {
  fs.mkdirSync(path.dirname(emitMeta), { recursive: true });
  fs.writeFileSync(emitMeta, `${JSON.stringify(meta, null, 2)}\n`);
}

console.log(
  `✓ git connector: ${newCommits} new commit(s) → ${path.relative(process.cwd(), notePath)}`
);
if (emitMeta)
  console.log(
    `  proposed cursor → ${path.relative(process.cwd(), emitMeta)} (kernel advances final state after verification)`
  );
