/**
 * Classify recorded phrase-assertion sites in test files
 * (CodySwannGT/lisa#4867).
 *
 * A site is one `toContain` / `toMatch` call in a `*.test.ts` file; it may
 * run many times (loops, `it.each`). The site is WORDING — and deletable —
 * only when EVERY recorded run of it checked a Markdown document a test read
 * and every expected value classifies WORDING. One code-output subject, one
 * STRUCTURAL or MACHINE-TOKEN value, or one unsupported value keeps the
 * whole site. Sites in shared helpers are never deletable (other callers may
 * not have been recorded), and sites that never ran are not seen at all.
 *
 * An expected value that is itself text from another Markdown document — not
 * a literal in the test source — is a cross-document consistency check (a
 * generated copy matching its source), which is STRUCTURAL.
 * @module scripts/lib/markdown-assertions/sites
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { resolveTestImport } from "../phrase-tests/classify.mjs";

/**
 * @typedef {import("./record.mjs").Row} Row
 * @typedef {import("./classify.mjs").Verdict} Verdict
 * @typedef {import("./classify.mjs").Check} Check
 * @typedef {{ site: string, file: string, line: number, column: number, runs: number, class: string, why: string, parser?: string, sample: unknown }} SiteVerdict
 */

/** The class of a site that is not a Markdown assertion at all. */
const NOT_MARKDOWN = "NOT-MARKDOWN";

/** Packages a document-reading test may import without exercising code. */
const READ_ONLY_PACKAGES = new Set([
  "vitest",
  "fs",
  "fs/promises",
  "path",
  "url",
  "os",
  "fs-extra",
  "yaml",
  "js-yaml",
  "gray-matter",
  "minimatch",
  "fast-glob",
  "glob",
  "tinyglobby",
]);

/**
 * Whether a test file exercises code: it imports (statically or
 * dynamically) a module outside `tests/`, a package beyond the read-only
 * set, or `child_process`. In such a file a subject that merely CONTAINS
 * document text may be the code's output (a transformer, a generator, a
 * script's stdout), so only a subject that IS a document's full text counts
 * as Markdown.
 * @param {string} file - Repository-relative test file.
 * @param {string} source - Its text.
 * @param {(file: string) => string | undefined} readSource - Reads a repo file, for following helpers.
 * @param {Set<string>} [seen] - Files already followed.
 * @returns {boolean} True when it exercises code.
 */
export function exercisesCode(file, source, readSource, seen = new Set()) {
  seen.add(file);
  const specifiers = [
    ...source.matchAll(
      /^\s*(?:import|export)\b[^"'`;]*?from\s+["']([^"']+)["']/gmu
    ),
    ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gmu),
    ...source.matchAll(/\bimport\(\s*["'`]([^"'`]+)["'`]/gu),
  ].map(match => match[1] ?? "");
  return specifiers.some(specifier => {
    if (!specifier.startsWith(".")) {
      const bare = specifier.replace(/^node:/u, "");
      return bare === "child_process" || !READ_ONLY_PACKAGES.has(bare);
    }
    const target = path.posix.normalize(
      path.posix.join(path.posix.dirname(file), specifier)
    );
    if (!target.startsWith("tests/")) return true;
    const helper = resolveTestImport(
      file,
      specifier,
      candidate => readSource(candidate) !== undefined
    );
    if (helper === undefined) return true;
    if (seen.has(helper)) return false;
    return exercisesCode(helper, readSource(helper) ?? "", readSource, seen);
  });
}

/**
 * Whether a string value is spelled literally in the test source.
 * @param {string} value - The expected value.
 * @param {string} source - The test file's text.
 * @returns {boolean} True when it is a literal pin.
 */
function isLiteralIn(value, source) {
  return (
    source.includes(value) ||
    source.includes(JSON.stringify(value).slice(1, -1))
  );
}

/**
 * The verdict for one recorded run.
 * @param {Row} row - The run.
 * @param {{ source: string, code: boolean }} test - The test file's text, and whether it exercises code.
 * @param {(check: Check) => Verdict} classify - The classifier.
 * @returns {Verdict} The verdict.
 */
function runVerdict(row, { source, code }, classify) {
  if (!row.markdown) {
    return {
      class: NOT_MARKDOWN,
      why: "subject is not a document a test read",
    };
  }
  if (code && !row.markdownExact) {
    return {
      class: NOT_MARKDOWN,
      why: "test exercises code and the subject is not a whole document",
    };
  }
  const { value } = row;
  if (typeof value === "object" && "unsupported" in value) {
    return {
      class: NOT_MARKDOWN,
      why: `expected value is ${value.unsupported}`,
    };
  }
  if (
    typeof value === "string" &&
    row.valueMarkdown &&
    !isLiteralIn(value, source)
  ) {
    return {
      class: "STRUCTURAL",
      why: `expected text comes from ${row.valueMarkdown} (cross-document consistency)`,
    };
  }
  return classify(
    /** @type {Check} */ ({
      file: row.markdown,
      polarity: row.negated ? "forbidden" : "required",
      kind: typeof value === "string" ? "string" : "pattern",
      value,
    })
  );
}

/** Rank of each class when a site's runs disagree; the highest wins. */
const RANK = Object.freeze({
  WORDING: 0,
  STRUCTURAL: 1,
  "MACHINE-TOKEN": 2,
  [NOT_MARKDOWN]: 3,
});

/**
 * Classify every recorded site in a `*.test.ts` file.
 * @param {Row[]} rows - Recorded runs.
 * @param {string} root - Repository root.
 * @param {(check: Check) => Verdict} classify - The classifier.
 * @returns {SiteVerdict[]} One verdict per site, sorted by file and line.
 */
export function classifySites(rows, root, classify) {
  /** @type {Map<string, Row[]>} */
  const bySite = new Map();
  for (const row of rows) {
    if (!row.site) continue;
    bySite.set(row.site, [...(bySite.get(row.site) ?? []), row]);
  }
  /** @param {string} file */
  const readSource = file => {
    try {
      return readFileSync(path.join(root, file), "utf8");
    } catch {
      return undefined;
    }
  };
  /** @type {Map<string, { source: string, code: boolean }>} */
  const tests = new Map();
  /** @param {string} file */
  const testOf = file => {
    const known = tests.get(file);
    if (known) return known;
    const source = readSource(file) ?? "";
    const test = { source, code: exercisesCode(file, source, readSource) };
    tests.set(file, test);
    return test;
  };
  return [...bySite.entries()]
    .map(([site, runs]) => {
      const [file = "", line = "0", column = "0"] = site.split(":");
      const helper = !file.endsWith(".test.ts");
      const verdicts = helper
        ? [{ class: NOT_MARKDOWN, why: "site is in a shared helper" }]
        : runs.map(run => runVerdict(run, testOf(file), classify));
      const worst = verdicts.reduce((a, b) =>
        RANK[/** @type {keyof typeof RANK} */ (b.class)] >
        RANK[/** @type {keyof typeof RANK} */ (a.class)]
          ? b
          : a
      );
      return {
        site,
        file,
        line: Number(line),
        column: Number(column),
        runs: runs.length,
        ...worst,
        sample: runs[0]?.value,
      };
    })
    .sort(
      (a, b) =>
        a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column
    );
}

/** Longest expected-value sample kept in the evidence file. */
const SAMPLE_LIMIT = 160;

/**
 * The evidence form of the classified sites: every Markdown site (NOT-MARKDOWN
 * sites are counted, not listed), one compact line each.
 * @param {SiteVerdict[]} sites - Classified sites.
 * @returns {object[]} Evidence rows.
 */
export function evidenceSites(sites) {
  return sites
    .filter(site => site.class !== NOT_MARKDOWN)
    .map(site => {
      const sample =
        typeof site.sample === "string"
          ? site.sample.slice(0, SAMPLE_LIMIT)
          : site.sample;
      return site.class === "WORDING"
        ? { site: site.site, class: site.class, runs: site.runs, sample }
        : {
            site: site.site,
            class: site.class,
            why: site.why,
            ...(site.parser ? { parser: site.parser } : {}),
            sample,
          };
    });
}

/**
 * Counts per class, and what a cull changed.
 * @param {SiteVerdict[]} sites - Classified sites.
 * @param {number} recordedFiles - Test files recorded.
 * @param {{ edits: { file: string, deleted: boolean }[], removedSites: number, keptUneditable: number } | undefined} result - The cull, when applied.
 * @returns {Record<string, number>} Counts.
 */
export function siteCounts(sites, recordedFiles, result) {
  /** @type {Record<string, number>} */
  const counts = { recordedFiles, sites: sites.length };
  for (const site of sites) counts[site.class] = (counts[site.class] ?? 0) + 1;
  counts.filesWithWordingSites = new Set(
    sites.filter(site => site.class === "WORDING").map(site => site.file)
  ).size;
  if (result) {
    counts.sitesRemoved = result.removedSites;
    counts.wordingSitesKeptUneditable = result.keptUneditable;
    counts.filesEdited = result.edits.filter(edit => !edit.deleted).length;
    counts.filesDeleted = result.edits.filter(edit => edit.deleted).length;
  }
  return counts;
}
