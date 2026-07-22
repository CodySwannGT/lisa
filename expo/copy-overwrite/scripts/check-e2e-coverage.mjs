#!/usr/bin/env node
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
import { pathToFileURL } from "node:url";

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
 * Does a visited path satisfy a route? Dynamic segments (`[id]`) match any
 * one segment, catch-alls (`[...rest]`) match one or more, and interpolated
 * spec segments (template `${...}` holes) match any route segment.
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
    const visitedSegment = visitedSegments[visitedIndex];
    const segmentMatches =
      /^\[.*\]$/.test(segment) ||
      visitedSegment.includes("${") ||
      segment === visitedSegment;
    return segmentMatches && isCovered(routeIndex + 1, visitedIndex + 1);
  };
  return isCovered(0, 0);
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
 * @param {object} input - Extraction input
 * @param {string} input.root - Project root
 * @param {string[]} input.directories - Candidate directories to scan
 * @param {RegExp} input.filePattern - Which files to read
 * @param {(source: string) => string[]} input.extract - Path extractor
 * @returns {string[]} Every visited path found
 */
function collectVisitedPaths({ root, directories, filePattern, extract }) {
  return directories.flatMap(directory => {
    const absolute = path.join(root, directory);
    return listFiles(absolute)
      .filter(file => filePattern.test(file))
      .flatMap(file =>
        extract(fs.readFileSync(path.join(absolute, file), "utf8"))
      );
  });
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
  const routes = enumerateRoutes(listFiles(appDir));
  if (routes.length === 0) {
    console.log("[e2e-coverage] OK: no navigable routes — nothing to gate.");
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

  const result = evaluateE2eCoverage({
    routes,
    playwrightVisited: collectVisitedPaths({
      root,
      directories: ["e2e", "tests/e2e"],
      filePattern: SPEC_FILE_PATTERN,
      extract: extractPlaywrightPaths,
    }),
    maestroVisited: collectVisitedPaths({
      root,
      directories: [".maestro"],
      filePattern: FLOW_FILE_PATTERN,
      extract: extractMaestroPaths,
    }),
    thresholds,
  });

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
        `[e2e-coverage] ${runner}: screens with no e2e test yet:\n` +
          verdict.missing.map(route => `  - ${route}`).join("\n")
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
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
