#!/usr/bin/env node
/**
 * lint-wiki.mjs — deterministic, dependency-free integrity checker for a lisa-wiki.
 *
 * Read-only: it reports findings, it never modifies the wiki. Default mode is
 * "warning" (exit 1 only on FAIL items); `--strict` (hard-enforcement) also fails
 * on WARN items.
 *
 * Usage: node lint-wiki.mjs [--wiki <wikiRoot>] [--config <path>] [--strict] [--json]
 * Exit 0 = clean (for the active mode), 1 = blocking findings.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadConfig,
  loadStructure,
  pluginRootFrom,
  walkFiles,
  parseFrontmatter,
  extractMarkdownLinks,
  extractCitations,
  SECRET_PATTERNS,
  TEXT_EXTS,
  makeReport,
} from "./_wiki-lib.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = pluginRootFrom(scriptDir);

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const opt = name => {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
};
const strict = flag("--strict");
const asJson = flag("--json");

const { config } = loadConfig(opt("--config"));
const structure = loadStructure(pluginRoot) ?? {};
const wikiRoot = path.resolve(opt("--wiki") ?? config?.wikiRoot ?? "wiki");
const report = makeReport();

if (!config) {
  report.add(
    "config",
    "not-loaded",
    "WARN",
    "config not found/invalid; using structure-manifest defaults"
  );
}

if (!fs.existsSync(wikiRoot)) {
  console.error(`✗ wiki root not found: ${wikiRoot}`);
  process.exit(1);
}

const rel = p => path.relative(process.cwd(), p);
const wrel = p => path.relative(wikiRoot, p);
const categories = config?.categories ?? structure.categoryDirs?.default ?? [];
const frontmatterRequired = config?.frontmatter !== false;

const allMd = walkFiles(wikiRoot, { ext: ".md" });
const allFiles = walkFiles(wikiRoot);
const exists = p => fs.existsSync(p);
const isUnder = (p, dir) => {
  const r = path.relative(path.join(wikiRoot, dir), p);
  return r !== "" && !r.startsWith("..") && !path.isAbsolute(r);
};
const isSynthesisPage = p => categories.some(c => isUnder(p, c));
const isSourceNote = p => isUnder(p, "sources");

// --- A. structure conformance ---------------------------------------------
for (const f of structure.requiredFiles ?? []) {
  report.add(
    "structure",
    `required-file:${f}`,
    exists(path.join(wikiRoot, f)) ? "PASS" : "FAIL",
    exists(path.join(wikiRoot, f))
      ? `present: ${f}`
      : `missing required file: ${f}`
  );
}
for (const d of structure.requiredDirs ?? []) {
  const ok =
    fs.existsSync(path.join(wikiRoot, d)) &&
    fs.statSync(path.join(wikiRoot, d)).isDirectory();
  report.add(
    "structure",
    `required-dir:${d}`,
    ok ? "PASS" : "FAIL",
    ok ? `present: ${d}/` : `missing required dir: ${d}/`
  );
}

// --- B. frontmatter on synthesis pages + source notes ---------------------
if (frontmatterRequired) {
  for (const f of allMd) {
    if (!isSynthesisPage(f) && !isSourceNote(f)) continue;
    const fm = parseFrontmatter(fs.readFileSync(f, "utf8"));
    if (!fm.has) {
      report.add("frontmatter", "missing", "WARN", `no frontmatter`, wrel(f));
    } else {
      const missing = ["type", "created", "updated"].filter(
        k => !fm.keys.includes(k)
      );
      if (missing.length) {
        report.add(
          "frontmatter",
          "incomplete",
          "WARN",
          `frontmatter missing keys: ${missing.join(", ")}`,
          wrel(f)
        );
      }
    }
  }
}

// --- C/D. links: index coverage, broken links, citations ------------------
const indexPath = path.join(wikiRoot, "index.md");
const indexText = exists(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";
const indexTargets = new Set(
  extractMarkdownLinks(indexText).map(t => path.resolve(wikiRoot, t))
);
// dangling index links
for (const t of indexTargets) {
  if (t.endsWith(".md") && !exists(t)) {
    report.add(
      "links",
      "index-dangling",
      "FAIL",
      `index links to a missing page: ${wrel(t)}`,
      "index.md"
    );
  }
}
// pages missing from index
for (const f of allMd) {
  if (!isSynthesisPage(f)) continue;
  if (!indexTargets.has(f)) {
    report.add(
      "index",
      "page-missing",
      "WARN",
      `synthesis page not linked from index.md`,
      wrel(f)
    );
  }
}
// broken internal links + citations across all md; build link graph for orphans.
// A link resolves if it exists relative to the file, OR as a wiki-root-relative /
// repo-root-relative / "wiki/"-prefixed form (reduces false positives).
const wikiBase = path.basename(wikiRoot);
const linkResolution = (f, target) => {
  const primary = path.resolve(path.dirname(f), target);
  const stripped = target
    .replace(/^\/+/, "")
    .replace(new RegExp(`^${wikiBase}/`), "");
  const cands = [
    primary,
    path.resolve(wikiRoot, target),
    path.resolve(wikiRoot, "..", target),
    path.resolve(wikiRoot, stripped),
  ];
  return { primary, hit: cands.find(exists) };
};
const linkedTo = new Set();
for (const f of allMd) {
  const text = fs.readFileSync(f, "utf8");
  for (const target of extractMarkdownLinks(text)) {
    const { primary, hit } = linkResolution(f, target);
    if (target.endsWith(".md") || primary.endsWith(".md")) {
      linkedTo.add(hit ?? primary);
      if (!hit) {
        report.add(
          "links",
          "broken",
          "FAIL",
          `broken link → ${target}`,
          wrel(f)
        );
      }
    } else if (!hit) {
      report.add(
        "links",
        "broken-asset",
        "WARN",
        `link to missing path → ${target}`,
        wrel(f)
      );
    }
  }
  for (const cite of extractCitations(text)) {
    const candidates = [
      path.resolve(wikiRoot, cite),
      path.resolve(wikiRoot, "..", cite),
      path.resolve(path.dirname(f), cite),
    ];
    if (!candidates.some(exists)) {
      report.add(
        "links",
        "citation-unresolved",
        "WARN",
        `citation path not found → ${cite}`,
        wrel(f)
      );
    }
  }
}

// --- E. orphan pages ------------------------------------------------------
for (const f of allMd) {
  if (!isSynthesisPage(f)) continue;
  if (!indexTargets.has(f) && !linkedTo.has(f)) {
    report.add(
      "orphans",
      "orphan",
      "WARN",
      `page is unreferenced (not in index, not linked)`,
      wrel(f)
    );
  }
}

// --- F. log non-empty -----------------------------------------------------
const logPath = path.join(wikiRoot, "log.md");
if (exists(logPath)) {
  const rows = fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter(l => /^\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(l));
  report.add(
    "log",
    "non-empty",
    rows.length > 0 ? "PASS" : "WARN",
    rows.length > 0
      ? `${rows.length} log entr${rows.length === 1 ? "y" : "ies"}`
      : "log.md has no dated entries"
  );
}

// --- G. secret + contamination + binaries ---------------------------------
const terms = (config?.contaminationTerms ?? []).filter(Boolean);
for (const f of allFiles) {
  const ext = path.extname(f);
  if (!TEXT_EXTS.has(ext) && path.basename(f) !== ".gitkeep") {
    report.add(
      "binaries",
      "stray",
      "WARN",
      `non-text file under wiki`,
      wrel(f)
    );
    continue;
  }
  let text;
  try {
    text = fs.readFileSync(f, "utf8");
  } catch {
    continue;
  }
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(text))
      report.add("secrets", "leak", "FAIL", `possible ${name}`, wrel(f));
  }
  // The config file legitimately lists the contamination terms it scans for; don't flag it.
  if (path.basename(f) !== "lisa-wiki.config.json") {
    for (const term of terms) {
      if (text.toLowerCase().includes(term.toLowerCase())) {
        report.add(
          "contamination",
          "term",
          "FAIL",
          `contamination term "${term}"`,
          wrel(f)
        );
      }
    }
  }
}

// --- output + verdict -----------------------------------------------------
const fails = report.items.filter(i => i.status === "FAIL");
const warns = report.items.filter(i => i.status === "WARN");
const blocking = strict ? fails.length + warns.length : fails.length;

if (asJson) {
  console.log(
    JSON.stringify(
      {
        wikiRoot: rel(wikiRoot),
        strict,
        fails: fails.length,
        warns: warns.length,
        items: report.items.filter(i => i.status !== "PASS"),
      },
      null,
      2
    )
  );
} else {
  for (const i of report.items.filter(i => i.status !== "PASS")) {
    console.log(
      `${i.status === "FAIL" ? "✗" : "⚠"} [${i.group}] ${i.message}${i.file ? ` (${i.file})` : ""}`
    );
  }
  console.log(
    `\n${fails.length} fail, ${warns.length} warn${strict ? " (strict: warnings block)" : ""} — ${blocking === 0 ? "OK" : "BLOCKING"}`
  );
}

process.exit(blocking === 0 ? 0 : 1);
