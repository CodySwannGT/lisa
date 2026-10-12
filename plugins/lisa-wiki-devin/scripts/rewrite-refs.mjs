#!/usr/bin/env node
/**
 * rewrite-refs.mjs — deterministically fix wiki references after files have moved.
 * Dependency-free. Assumes the files are ALREADY moved (e.g. by absorb-docs/migrate
 * via `git mv`); this script only repairs references and verifies no dangling links.
 *
 * It correctly handles both directions:
 *   - a moved file's relative links to unmoved targets (re-based to its new location),
 *   - unmoved files' relative links to moved targets,
 *   - moved → moved,
 *   - plain-text `Source: <path>` citations (wiki-root-relative).
 *
 * Usage:
 *   node rewrite-refs.mjs --wiki <root> --move <oldPath>:<newPath> [--move ...] [--check]
 *   paths are resolved relative to CWD; --check verifies only (no writes).
 * Exit 0 = rewritten/clean, 1 = dangling links remain (or bad args).
 */
import fs from "node:fs";
import path from "node:path";
import { walkFiles, extractMarkdownLinks } from "./_wiki-lib.mjs";

const argv = process.argv.slice(2);
const check = argv.includes("--check");
const wikiArgIdx = argv.indexOf("--wiki");
if (
  wikiArgIdx !== -1 &&
  (!argv[wikiArgIdx + 1] || argv[wikiArgIdx + 1].startsWith("--"))
) {
  console.error("✗ --wiki requires a path argument");
  process.exit(1);
}
const wikiRoot = path.resolve(
  wikiArgIdx !== -1 ? argv[wikiArgIdx + 1] : "wiki"
);
const moves = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--move") {
    const spec = argv[i + 1] ?? "";
    const sep = spec.lastIndexOf(":");
    if (sep === -1) {
      console.error(`✗ bad --move "${spec}" (expected old:new)`);
      process.exit(1);
    }
    moves.push([
      path.resolve(spec.slice(0, sep)),
      path.resolve(spec.slice(sep + 1)),
    ]);
    i += 1;
  }
}

const moveMap = new Map(moves); // oldAbs -> newAbs
const newToOld = new Map(moves.map(([o, n]) => [n, o])); // newAbs -> oldAbs
const currentLocation = abs => moveMap.get(abs) ?? abs;
const toPosix = p => p.split(path.sep).join("/");

const isExternal = t =>
  !t ||
  t.startsWith("#") ||
  /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ||
  t.startsWith("mailto:") ||
  t.includes("{{") ||
  t.includes("<") ||
  t.includes(">");

let rewriteCount = 0;
const mdFiles = walkFiles(wikiRoot, { ext: ".md" });

for (const file of mdFiles) {
  const oldOfFile = newToOld.get(file) ?? file; // where this file's links were authored relative to
  const authorBase = path.dirname(oldOfFile);
  const curDir = path.dirname(file);
  const original = fs.readFileSync(file, "utf8");

  // 1) markdown links
  let updated = original.replace(
    /(\]\()([^)]+)(\))/g,
    (whole, open, target, close) => {
      // split off an optional markdown link title: (url "title") — preserve it
      const tm = target.match(/^(\S+)(\s[\s\S]*)?$/);
      if (!tm) return whole;
      const urlAnchor = tm[1];
      const title = tm[2] ?? "";
      if (isExternal(urlAnchor)) return whole;
      const [pathPart, anchor] = urlAnchor.split("#");
      const resolvedFromAuthor = path.resolve(authorBase, pathPart);
      const correctAbs = currentLocation(resolvedFromAuthor);
      let nextRel = toPosix(path.relative(curDir, correctAbs));
      if (!nextRel.startsWith(".")) nextRel = `./${nextRel}`;
      const nextUrl = anchor !== undefined ? `${nextRel}#${anchor}` : nextRel;
      const nextTarget = `${nextUrl}${title}`;
      return nextTarget === target ? whole : `${open}${nextTarget}${close}`;
    }
  );

  // 2) plain-text citations: Source: <wiki-root-relative path>
  updated = updated.replace(
    /(Source:\s*)([^\s)]+\.md)/g,
    (whole, pre, cite) => {
      if (cite.includes("{{") || cite.includes("<")) return whole;
      // citations are wiki-root-relative (or repo-relative); map via moveMap if they point to a moved file
      const candidates = [
        path.resolve(wikiRoot, cite),
        path.resolve(wikiRoot, "..", cite),
      ];
      const hit = candidates.find(c => moveMap.has(c));
      if (!hit) return whole;
      const nextAbs = moveMap.get(hit);
      const nextCite = toPosix(path.relative(wikiRoot, nextAbs));
      return `${pre}${nextCite}`;
    }
  );

  if (updated !== original) {
    rewriteCount += 1;
    if (!check) fs.writeFileSync(file, updated);
  }
}

// verification: no dangling internal .md links remain (at current locations)
const dangling = [];
for (const file of mdFiles) {
  const text = fs.readFileSync(file, "utf8");
  for (const target of extractMarkdownLinks(text)) {
    const resolved = path.resolve(path.dirname(file), target);
    if (resolved.endsWith(".md") && !fs.existsSync(resolved)) {
      dangling.push(`${toPosix(path.relative(wikiRoot, file))} → ${target}`);
    }
  }
}

if (dangling.length > 0) {
  console.error(
    `✗ ${dangling.length} dangling internal link(s) ${check ? "found" : "remain after rewrite"}:`
  );
  for (const d of dangling) console.error(`  - ${d}`);
  process.exit(1);
}

console.log(
  check
    ? `✓ no dangling internal links (${mdFiles.length} files checked).`
    : `✓ rewrote refs in ${rewriteCount} file(s); no dangling internal links remain.`
);
