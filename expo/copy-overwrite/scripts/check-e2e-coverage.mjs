#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * check-e2e-coverage — aggregate e2e route/screen coverage gate (Expo).
 *
 * The e2e counterpart of the unit-test coverage thresholds: where Vitest/Jest
 * gate on line coverage, this gates on SURFACE coverage — the percentage of
 * expo-router routes exercised by at least one e2e spec, computed per runner:
 *
 *   - Playwright: routes visited via `page.goto("<path>")` in e2e specs
 *     (top-level `e2e/` or nested `tests/e2e/` trees).
 *   - Maestro: screens opened via `openLink: <deep link>` in `.maestro/` flows.
 *
 * Maestro is black-box (no code-coverage hook exists for a compiled native
 * app), so route coverage is the shared metric both runners can honor. A spec
 * or flow that reaches a screen by tapping rather than deep-linking can declare
 * it with an `e2e-route: /path` comment annotation (JS/TS or YAML comment).
 *
 * Coverage is inferred from source text, so a navigation the source does not
 * spell out is not coverage this gate can see. It is credited to nothing and
 * PRINTED as an unmatched navigation — never guessed at. An unresolved template
 * hole is the sharpest case: `${...}` matches a route's dynamic segment, which
 * accepts any value anyway, and nothing else. See `routeMatchesVisit`.
 *
 * Thresholds default to 80% per runner and are project-tunable via
 * `e2e.thresholds.json` (create-only, same convention as vitest.thresholds.json):
 *   { "playwright": { "routes": 80 }, "maestro": { "routes": 80 } }
 * A runner threshold of 0 disables that runner's gate (logged, never silent).
 *
 * Inputs (env, CI-friendly):
 *   E2E_COVERAGE_ROOT  project root to scan (default: cwd)
 *
 * Exit 0 = every runner meets its threshold (or nothing to gate).
 * Exit 1 = at least one runner is under threshold; uncovered routes are listed.
 * @module scripts/check-e2e-coverage
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

export const defaultThresholds = {
  playwright: { routes: 80 },
  maestro: { routes: 80 },
};

const ROUTE_FILE_PATTERN = /\.(?:tsx|ts|jsx|js)$/;
const PLATFORM_SUFFIX_PATTERN = /\.(?:ios|android|native|web)$/;
const SPEC_FILE_PATTERN = /\.(?:tsx|ts|jsx|js|mjs)$/;
const FLOW_FILE_PATTERN = /\.(?:yaml|yml)$/;
// `e2e-route: /path` inside any comment declares a route as covered even when
// the spec reaches it by tapping/navigating rather than by URL or deep link.
const ROUTE_ANNOTATION_PATTERN = /e2e-route:\s*(\/[^\s'"`,)]*)/g;
// `e2e-route-exempt: /path` is the counterpart to `e2e-route:` — it declares a
// route deliberately uncovered, removing it from the denominator rather than
// leaving a team to reach for a mechanism this gate cannot see.
const EXEMPT_ANNOTATION_PATTERN = /e2e-route-exempt:\s*(\/[^\s'"`,)]*)/g;
const GOTO_PATTERN = /\.goto\(\s*(["'`])([^"'`]+)\1/g;
const OPEN_LINK_PATTERN = /openLink:\s*["']?([^\s"']+)/g;

/**
 * Derive the expo-router route for one file inside the app directory.
 * Layouts (`_layout`), private files (`_*`), special files (`+not-found`,
 * `+html`) and API routes (`*+api`) are not navigable screens and return null.
 * @param {string} relativePath - Path relative to the app directory
 * @returns {string | null} Route path (e.g. "/profile/[id]"), or null
 */
export function routeFromFile(relativePath) {
  if (!ROUTE_FILE_PATTERN.test(relativePath)) {
    return null;
  }
  const withoutExtension = relativePath.replace(ROUTE_FILE_PATTERN, "");
  const rawSegments = withoutExtension.split("/");
  const basename = rawSegments[rawSegments.length - 1].replace(
    PLATFORM_SUFFIX_PATTERN,
    ""
  );
  if (basename.startsWith("+") || basename.endsWith("+api")) {
    return null;
  }
  // Companion files are not screens. Ignore bracket contents before checking
  // for a remaining dot so catch-all routes such as `[...slug]` stay valid.
  if (
    basename
      .split("")
      .some(
        (character, index) =>
          character === "." &&
          basename.lastIndexOf("[", index) <= basename.lastIndexOf("]", index)
      )
  ) {
    return null;
  }
  if (rawSegments.some(segment => segment.startsWith("_"))) {
    return null;
  }
  const segments = [...rawSegments.slice(0, -1), basename]
    // Route groups like "(tabs)" organize files without affecting the URL.
    .filter(segment => !(segment.startsWith("(") && segment.endsWith(")")))
    .filter(segment => segment !== "index");
  return `/${segments.join("/")}`.replace(/\/+/g, "/");
}

/**
 * Enumerate the unique navigable routes for a set of app-directory files.
 * @param {string[]} files - Paths relative to the app directory
 * @returns {string[]} Sorted unique route paths
 */
export function enumerateRoutes(files) {
  const routes = files
    .map(file => routeFromFile(file))
    .filter(route => route !== null);
  // Code-unit comparator (not `localeCompare()`): route order must be
  // reproducible across environments regardless of the runtime's default
  // ICU locale, since localeCompare()'s collation is locale-sensitive.
  return [...new Set(routes)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Normalize a visited URL or deep link to a route-comparable path.
 * Handles absolute paths, http(s) URLs, custom-scheme deep links
 * (`myapp://profile/1` → `/profile/1`), and Expo dev-client URLs
 * (`exp://host:8081/--/profile` → `/profile`).
 * @param {string} raw - The literal URL/path from a spec or flow
 * @returns {string | null} Normalized path, or null when not a navigation
 */
export function normalizeVisitedPath(raw) {
  if (!raw) {
    return null;
  }
  const withoutQuery = raw.split(/[?#]/)[0];
  const devClientSplit = withoutQuery.split("/--/");
  if (devClientSplit.length > 1) {
    return normalizeVisitedPath(`/${devClientSplit[1]}`);
  }
  const schemeMatch = withoutQuery.match(/^([a-zA-Z][\w+.-]*):\/\/(.*)$/);
  const pathPart = schemeMatch
    ? schemeMatch[1] === "http" || schemeMatch[1] === "https"
      ? // http(s): the first segment is the host, the rest is the path.
        `/${schemeMatch[2].split("/").slice(1).join("/")}`
      : // Custom scheme: everything after :// is the route.
        `/${schemeMatch[2]}`
    : withoutQuery.startsWith("/")
      ? withoutQuery
      : `/${withoutQuery.replace(/^\.\//, "")}`;
  const collapsed = pathPart.replace(/\/+/g, "/");
  const trimmed =
    collapsed.length > 1 ? collapsed.replace(/\/$/, "") : collapsed;
  return trimmed || "/";
}

/**
 * Extract every route-comparable path a Playwright spec visits.
 * @param {string} source - Spec file contents
 * @returns {string[]} Normalized visited paths
 */
export function extractPlaywrightPaths(source) {
  const fromGoto = [...source.matchAll(GOTO_PATTERN)].map(match => match[2]);
  const fromAnnotations = [...source.matchAll(ROUTE_ANNOTATION_PATTERN)].map(
    match => match[1]
  );
  return [...fromGoto, ...fromAnnotations]
    .map(visited => normalizeVisitedPath(visited))
    .filter(visited => visited !== null);
}

/**
 * Extract every route-comparable path a Maestro flow opens.
 * @param {string} source - Flow YAML contents
 * @returns {string[]} Normalized visited paths
 */
export function extractMaestroPaths(source) {
  const fromOpenLink = [...source.matchAll(OPEN_LINK_PATTERN)].map(
    match => match[1]
  );
  const fromAnnotations = [...source.matchAll(ROUTE_ANNOTATION_PATTERN)].map(
    match => match[1]
  );
  return [...fromOpenLink, ...fromAnnotations]
    .map(visited => normalizeVisitedPath(visited))
    .filter(visited => visited !== null);
}

/**
 * Does a visited path satisfy a route? Dynamic segments (`[id]`) match any one
 * segment and catch-alls (`[...rest]`) match one or more.
 *
 * A template hole (`${...}`) in the VISITED path is deliberately NOT a
 * wildcard. It used to be, and the direction of that rule was backwards: an
 * unresolved interpolation is the case where the gate knows LEAST about what
 * the spec visits, and it was the case that credited the MOST. A 404 spec
 * navigating to `` page.goto(`${UNKNOWN_PATH}-first`) `` — a URL chosen
 * precisely because nothing serves it — was therefore credited with every
 * single-segment route in the app. Measured in one consumer: nine routes,
 * `/watchlist` and `/shadow-team` among them, credited to a test that proves
 * the 404 screen renders.
 *
 * An interpolated segment still matches a route's DYNAMIC segment, because
 * `[id]` matches any value including an unknown one — `/players/${playerId}`
 * still covers `/players/[id]`. What it no longer does is match a route's
 * LITERAL segment, where the resolved value would have had to be that exact
 * word for the visit to be real.
 *
 * A visit that consequently matches nothing is listed by `unmatchedVisits` and
 * printed every run, so the credit this removes shows up as a named diagnostic
 * rather than as a number that quietly got smaller. A spec that genuinely
 * reaches a screen by a path this gate cannot resolve declares it with an
 * `e2e-route: /path` annotation.
 * @param {string} route - Enumerated route (e.g. "/profile/[id]")
 * @param {string} visited - Normalized visited path (e.g. "/profile/42")
 * @returns {boolean} Whether the visit covers the route
 */
export function routeMatchesVisit(route, visited) {
  const routeSegments = route.split("/").filter(Boolean);
  const visitedSegments = visited.split("/").filter(Boolean);
  const isCovered = (routeIndex, visitedIndex) => {
    if (routeIndex === routeSegments.length) {
      return visitedIndex === visitedSegments.length;
    }
    const segment = routeSegments[routeIndex];
    if (/^\[\.\.\..*\]$/.test(segment)) {
      return visitedIndex < visitedSegments.length;
    }
    if (visitedIndex === visitedSegments.length) {
      return false;
    }
    const segmentMatches =
      /^\[.*\]$/.test(segment) || segment === visitedSegments[visitedIndex];
    return segmentMatches && isCovered(routeIndex + 1, visitedIndex + 1);
  };
  return isCovered(0, 0);
}

/**
 * Visits that credited no route at all, with the file each came from.
 *
 * Removing the `${` wildcard makes a whole class of visit stop counting, and a
 * matcher that silently discards its non-matches is the same defect wearing the
 * opposite sign: the number would just be smaller, with nothing saying why. So
 * every visit that matches nothing is named — an unresolved interpolation, a
 * typo'd path, a route that was renamed out from under a spec. All three read
 * identically in a coverage percentage and differently in this list.
 *
 * This is diagnostic, not a gate. An unmatched visit is often correct (a spec
 * navigating to a 404 on purpose), so failing on one would punish the very test
 * this defect was found in. The gate still fails on the coverage number; this
 * explains the number.
 * @param {object} input - Matching input
 * @param {string[]} input.routes - Enumerated app routes (after exemptions)
 * @param {{path: string, file: string}[]} input.visits - Visits with provenance
 * @returns {{path: string, files: string[]}[]} Unmatched visits, sorted
 */
export function unmatchedVisits({ routes, visits }) {
  const byPath = new Map();
  for (const visit of visits) {
    if (routes.some(route => routeMatchesVisit(route, visit.path))) {
      continue;
    }
    byPath.set(
      visit.path,
      (byPath.get(visit.path) ?? new Set()).add(visit.file)
    );
  }
  // Code-unit comparator, matching enumerateRoutes: output order must be
  // reproducible across environments regardless of the runtime's ICU locale.
  const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return [...byPath.entries()]
    .map(([visitedPath, files]) => ({
      path: visitedPath,
      files: [...files].sort(byCodeUnit),
    }))
    .sort((a, b) => byCodeUnit(a.path, b.path));
}

/**
 * Merge project threshold overrides over the defaults, per runner.
 * @param {typeof defaultThresholds} defaults - Baseline thresholds
 * @param {object} overrides - Contents of e2e.thresholds.json (may be partial)
 * @returns {typeof defaultThresholds} Effective thresholds
 */
export function mergeThresholds(defaults, overrides) {
  return {
    playwright: { ...defaults.playwright, ...overrides?.playwright },
    maestro: { ...defaults.maestro, ...overrides?.maestro },
  };
}

/**
 * Route exemptions a project has deliberately declared.
 *
 * The script could already ADD a coverage claim (`e2e-route:`) but had no way
 * to remove one. A team exempting a route therefore reached for a mechanism the
 * gate cannot see — `testIgnore`, a disabled project, a Maestro tag — and the
 * number silently overstated. Detecting those mechanisms is only half a fix: if
 * there is no supported way to say "this route is deliberately uncovered", the
 * workaround stays the only option.
 *
 * Exemptions leave the denominator, and are always PRINTED. A silent exemption
 * would be the same defect wearing a sanctioned label.
 * @param {object} input - Exemption input
 * @param {string[]} input.routes - Enumerated app routes
 * @param {string[]} [input.declared] - Routes exempted in e2e.thresholds.json
 * @param {string[]} [input.annotated] - Routes exempted by `e2e-route-exempt:`
 * @returns {{kept: string[], exempt: string[], unknown: string[]}} Partition
 */
export function applyExemptions({ routes, declared, annotated }) {
  const asked = [...new Set([...(declared ?? []), ...(annotated ?? [])])];
  const exempt = asked.filter(route => routes.includes(route));
  // An exemption naming a route that does not exist is stale — a renamed or
  // deleted screen whose waiver outlived it. Reported, never silently dropped,
  // because a stale exemption is how a real gap gets permanently excused.
  const unknown = asked.filter(route => !routes.includes(route));
  return {
    kept: routes.filter(route => !exempt.includes(route)),
    exempt,
    unknown,
  };
}

/**
 * Routes exempted by an `e2e-route-exempt: /path` comment in a spec or flow.
 *
 * The comment form exists so an exemption lives next to the thing that would
 * otherwise cover the route, where a reviewer of that file sees it. The
 * thresholds-file form exists for a route no file mentions at all. Both are
 * read; neither is silent.
 * @param {string} root - Project root
 * @returns {string[]} Exempted routes
 */
export function collectExemptAnnotations(root) {
  const scan = (directories, filePattern) =>
    directories.flatMap(directory => {
      const absolute = path.join(root, directory);
      return listFiles(absolute)
        .filter(file => filePattern.test(file))
        .flatMap(file => [
          ...fs
            .readFileSync(path.join(absolute, file), "utf8")
            .matchAll(EXEMPT_ANNOTATION_PATTERN),
        ])
        .map(match => match[1]);
    });
  return [
    ...scan(["e2e", "tests/e2e"], SPEC_FILE_PATTERN),
    ...scan([".maestro"], FLOW_FILE_PATTERN),
  ];
}

/**
 * Glob-ish patterns Playwright is configured to ignore.
 *
 * Read textually rather than by importing the config: it is TypeScript, may
 * import project code, and executing it to compute a coverage number would be a
 * far larger blast radius than reading it. A pattern this misses costs a false
 * INCLUSION — the old behaviour — so the failure mode of imprecision here is
 * the status quo rather than a new one.
 * @param {string} root - Project root
 * @returns {string[]} Ignore patterns, empty when no config is found
 */
export function readPlaywrightIgnores(root) {
  const config = [
    "playwright.config.ts",
    "playwright.config.js",
    "playwright.config.mjs",
  ]
    .map(name => path.join(root, name))
    .find(candidate => fs.existsSync(candidate));
  if (!config) {
    return [];
  }
  const source = fs.readFileSync(config, "utf8");
  const block = source.match(
    /testIgnore\s*:\s*(\[[^\]]*\]|["'`][^"'`]*["'`])/u
  );
  if (!block) {
    return [];
  }
  return [...block[1].matchAll(/["'`]([^"'`]+)["'`]/gu)].map(match => match[1]);
}

/**
 * Whether a spec path is excluded by one of Playwright's ignore patterns.
 * @param {string} relativePath - Spec path relative to its scan directory
 * @param {string[]} patterns - Ignore patterns
 * @returns {boolean} True when the spec will not run
 */
export function isIgnoredSpec(relativePath, patterns) {
  return patterns.some(pattern => globToRegExp(pattern).test(relativePath));
}

/**
 * Translate one glob to an anchored expression.
 *
 * `**` spans directories, `*` does not, and `**\/` must also match nothing at
 * all — `**\/x.spec.ts` names a file at the scan root as well as a nested one.
 * Requiring the slash silently un-ignored every top-level spec, which is the
 * bug this whole function exists to close, so it is the case the tests pin.
 * @param {string} pattern - A glob from Playwright's testIgnore
 * @returns {RegExp} Anchored matcher
 */
function globToRegExp(pattern) {
  const DOUBLE_SLASH = "\u0000";
  const DOUBLE = "\u0001";
  const SINGLE = "\u0002";
  const marked = pattern
    .replaceAll("**/", DOUBLE_SLASH)
    .replaceAll("**", DOUBLE)
    .replaceAll("*", SINGLE);
  const escaped = marked.replace(/[.+^${}()|[\]\\?]/gu, "\\$&");
  const expression = escaped
    .replaceAll(DOUBLE_SLASH, "(?:.*/)?")
    .replaceAll(DOUBLE, ".*")
    .replaceAll(SINGLE, "[^/]*");
  return new RegExp(`(^|/)${expression}$`, "u");
}

/**
 * Whether a Maestro flow carries a tag the running suite excludes.
 *
 * The exclusion is supplied by the caller (`MAESTRO_EXCLUDE_TAGS`) because the
 * suite decides it at invocation time — the flow file cannot know, and neither
 * can this script by reading the repository.
 * @param {string} source - Flow file contents
 * @param {string[]} excluded - Tags the suite excludes
 * @returns {boolean} True when the flow will not run
 */
export function isExcludedFlow(source, excluded) {
  if (excluded.length === 0) {
    return false;
  }
  return flowTags(source).some(tag => excluded.includes(tag));
}

/**
 * The tags a Maestro flow declares, and nothing else.
 *
 * Read line-wise because YAML block structure is indentation, and the previous
 * regex form could not express "until this block ends": it allowed zero
 * indentation before `-`, so it ran past the `---` document separator and
 * lifted `openLink` and `tapOn` out of the flow's COMMANDS. A false tag causes
 * a false EXCLUSION, dropping a flow that really runs — the opposite error from
 * the one this gate exists to fix, and just as wrong.
 * @param {string} source - Flow file contents
 * @returns {string[]} Declared tags
 */
function flowTags(source) {
  const lines = source.split("\n");
  const start = lines.findIndex(line => line.startsWith("tags:"));
  if (start === -1) {
    return [];
  }
  const inline = lines[start].match(/^tags:\s*\[([^\]]*)\]/u);
  if (inline) {
    return inline[1]
      .split(",")
      .map(tag => tag.trim().replace(/^["']|["']$/gu, ""))
      .filter(Boolean);
  }
  const tags = [];
  for (const line of lines.slice(start + 1)) {
    // The block ends at the document separator, at a non-indented line, or at
    // anything that is not a list item. Each of those is what the regex missed.
    // The whitespace either side of the item is trimmed in JS rather than by
    // `\s*(.+?)\s*$`. There, three quantifiers compete for the same spaces, so
    // the engine has a choice to make at each one and the match is
    // super-linear in the line's length — S5852, on a workflow file. `(.+)`
    // holds the same "at least one character after the dash" condition the
    // lazy form did, so no line changes its verdict.
    const item = line.match(/^\s+-(.+)$/u);
    if (!item || line.startsWith("---")) {
      break;
    }
    tags.push(item[1].trim().replace(/^["']|["']$/gu, ""));
  }
  return tags;
}

/**
 * Pure decision: does each runner's route coverage meet its threshold?
 * @param {object} input - Evaluation input
 * @param {string[]} input.routes - Enumerated app routes
 * @param {string[]} input.playwrightVisited - Paths Playwright specs visit
 * @param {string[]} input.maestroVisited - Paths Maestro flows open
 * @param {typeof defaultThresholds} input.thresholds - Effective thresholds
 * @returns {{ok: boolean, runners: Record<string, {threshold: number, total: number, covered: number, percentage: number, missing: string[], ok: boolean}>}} Verdict
 */
export function evaluateE2eCoverage({
  routes,
  playwrightVisited,
  maestroVisited,
  thresholds,
}) {
  const evaluateRunner = (visited, threshold) => {
    const missing = routes.filter(
      route => !visited.some(visit => routeMatchesVisit(route, visit))
    );
    const covered = routes.length - missing.length;
    const percentage =
      routes.length === 0 ? 100 : (covered / routes.length) * 100;
    return {
      threshold,
      total: routes.length,
      covered,
      percentage,
      missing,
      ok: threshold === 0 || percentage >= threshold,
    };
  };
  const runners = {
    playwright: evaluateRunner(playwrightVisited, thresholds.playwright.routes),
    maestro: evaluateRunner(maestroVisited, thresholds.maestro.routes),
  };
  return { ok: runners.playwright.ok && runners.maestro.ok, runners };
}

/**
 * Load project threshold overrides from `e2e.thresholds.json`, if present.
 * Malformed JSON is a readable, operator-facing failure rather than an
 * uncaught SyntaxError and stack trace.
 * @param {string} thresholdsFile - Absolute path to the thresholds file
 * @returns {object} Parsed overrides, or {} when the file is absent
 * @throws {Error} When the file exists but is not valid JSON
 */
export function loadThresholdOverrides(thresholdsFile) {
  if (!fs.existsSync(thresholdsFile)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(thresholdsFile, "utf8"));
  } catch (error) {
    throw new Error(`e2e.thresholds.json is not valid JSON — ${error.message}`);
  }
}

/**
 * Recursively list files under a directory, relative to it.
 * @param {string} directory - Absolute directory path
 * @returns {string[]} Relative file paths (posix separators), or [] if absent
 */
function listFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs
    .readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry =>
      path
        .relative(directory, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/")
    );
}

/**
 * Read every matching file under the given directories and extract paths.
 *
 * Each visit keeps the file it came from. Provenance is what lets an unmatched
 * visit be reported as something an author can act on rather than as an
 * anonymous path, and it costs one field.
 * @param {object} input - Extraction input
 * @param {string} input.root - Project root
 * @param {string[]} input.directories - Candidate directories to scan
 * @param {RegExp} input.filePattern - Which files to read
 * @param {(source: string) => string[]} input.extract - Path extractor
 * @returns {{visited: string[], visits: {path: string, file: string}[], read: string[], skipped: string[]}} Collected paths
 */
function collectVisitedPaths({
  root,
  directories,
  filePattern,
  extract,
  skip,
}) {
  const read = [];
  const skipped = [];
  const visits = directories.flatMap(directory => {
    const absolute = path.join(root, directory);
    return listFiles(absolute)
      .filter(file => filePattern.test(file))
      .flatMap(file => {
        const source = fs.readFileSync(path.join(absolute, file), "utf8");
        // A file that will not run contributes no coverage, however many
        // routes it mentions. Presence on disk was the whole bug.
        if (skip?.({ file, source })) {
          skipped.push(`${directory}/${file}`);
          return [];
        }
        read.push(`${directory}/${file}`);
        return extract(source).map(visitedPath => ({
          path: visitedPath,
          file: `${directory}/${file}`,
        }));
      });
  });
  return { visited: visits.map(visit => visit.path), visits, read, skipped };
}

/**
 * CLI entry: scan the project, evaluate, and exit non-zero when under threshold.
 * @returns {void}
 */
function main() {
  const root = process.env.E2E_COVERAGE_ROOT || process.cwd();
  const appDir = ["app", "src/app"]
    .map(candidate => path.join(root, candidate))
    .find(candidate => fs.existsSync(candidate));
  if (!appDir) {
    console.log(
      "[e2e-coverage] OK: no expo-router app directory found — nothing to gate."
    );
    return;
  }
  const allRoutes = enumerateRoutes(listFiles(appDir));
  if (allRoutes.length === 0) {
    // An app directory that enumerates ZERO navigable routes is a discovery
    // bug, not an empty app — a renamed tree or a changed file pattern. The
    // old behaviour reported "nothing to gate" and exited 0, so the gate
    // passed loudest exactly when it had measured nothing.
    console.error(
      `[e2e-coverage] FAIL: found an app directory (${path.relative(root, appDir) || "."}) but enumerated no navigable routes. That is a discovery failure, not an empty app — check the route file patterns before trusting any coverage number.`
    );
    process.exit(1);
    return;
  }

  const thresholdsFile = path.join(root, "e2e.thresholds.json");
  let overrides;
  try {
    overrides = loadThresholdOverrides(thresholdsFile);
  } catch (error) {
    console.error(`[e2e-coverage] FAIL: ${error.message}`);
    process.exit(1);
    return;
  }
  const thresholds = mergeThresholds(defaultThresholds, overrides);

  const ignores = readPlaywrightIgnores(root);
  const excludedTags = (process.env.MAESTRO_EXCLUDE_TAGS ?? "")
    .split(",")
    .map(tag => tag.trim())
    .filter(Boolean);

  const playwright = collectVisitedPaths({
    root,
    directories: ["e2e", "tests/e2e"],
    filePattern: SPEC_FILE_PATTERN,
    extract: extractPlaywrightPaths,
    skip: ({ file }) => isIgnoredSpec(file, ignores),
  });
  const maestro = collectVisitedPaths({
    root,
    directories: [".maestro"],
    filePattern: FLOW_FILE_PATTERN,
    extract: extractMaestroPaths,
    skip: ({ source }) => isExcludedFlow(source, excludedTags),
  });

  const {
    kept: routes,
    exempt,
    unknown,
  } = applyExemptions({
    routes: allRoutes,
    declared: overrides?.exempt,
    annotated: collectExemptAnnotations(root),
  });

  for (const [runner, collected] of [
    ["playwright", playwright],
    ["maestro", maestro],
  ]) {
    if (collected.skipped.length > 0) {
      console.log(
        `[e2e-coverage] ${runner}: ${collected.skipped.length} file(s) excluded from the run and NOT counted as coverage:\n${collected.skipped
          .map(file => `  - ${file}`)
          .join("\n")}`
      );
    }
  }
  if (exempt.length > 0) {
    console.log(
      `[e2e-coverage] ${exempt.length} route(s) deliberately exempt (removed from the denominator):\n${exempt
        .map(route => `  - ${route}`)
        .join("\n")}`
    );
  }
  if (unknown.length > 0) {
    console.error(
      `[e2e-coverage] FAIL: ${unknown.length} exemption(s) name a route that does not exist. A waiver that outlived its screen permanently excuses whatever replaces it:\n${unknown
        .map(route => `  - ${route}`)
        .join("\n")}`
    );
    process.exit(1);
    return;
  }
  if (routes.length === 0) {
    console.error(
      "[e2e-coverage] FAIL: every route is exempt, so this gate measures nothing. Remove exemptions or disable the gate explicitly with a threshold of 0."
    );
    process.exit(1);
    return;
  }

  const result = evaluateE2eCoverage({
    routes,
    playwrightVisited: playwright.visited,
    maestroVisited: maestro.visited,
    thresholds,
  });

  for (const [runner, collected] of [
    ["playwright", playwright],
    ["maestro", maestro],
  ]) {
    const unmatched = unmatchedVisits({ routes, visits: collected.visits });
    if (unmatched.length > 0) {
      console.log(
        `[e2e-coverage] ${runner}: ${unmatched.length} navigation(s) matched no route and credited nothing. An unresolved \`\${...}\` hole, a typo, or a renamed screen all look like this — declare a real one with an \`e2e-route: /path\` comment:\n${unmatched
          .map(visit => `  - ${visit.path}  (${visit.files.join(", ")})`)
          .join("\n")}`
      );
    }
  }

  for (const [runner, verdict] of Object.entries(result.runners)) {
    const summary = `${verdict.covered}/${verdict.total} routes (${verdict.percentage.toFixed(1)}% vs ${verdict.threshold}% required)`;
    if (verdict.threshold === 0) {
      console.log(
        `[e2e-coverage] ${runner}: gate disabled (threshold 0) — ${summary}`
      );
    } else if (verdict.ok) {
      console.log(`[e2e-coverage] ${runner}: OK — ${summary}`);
    } else {
      console.error(`[e2e-coverage] ${runner}: FAIL — ${summary}`);
      console.error(
        `[e2e-coverage] ${runner}: screens with no e2e test yet:\n${verdict.missing
          .map(route => `  - ${route}`)
          .join("\n")}`
      );
    }
  }
  if (!result.ok) {
    console.error(
      "[e2e-coverage] FAIL: some screens have no end-to-end test. Add a Playwright spec (page.goto) or Maestro flow (openLink) that reaches each screen listed above, add an `e2e-route: /path` comment to a spec that already reaches it by navigation, or adjust e2e.thresholds.json."
    );
    process.exit(1);
  }
  console.log("[e2e-coverage] OK");
}

// Run only when invoked directly — importing for tests must have no side effects.
if (invokedAsScript(import.meta.url)) {
  main();
}
