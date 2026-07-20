/**
 * Tests for the aggregate e2e route/screen coverage gate and its wiring.
 * The e2e counterpart of unit-test coverage thresholds: Playwright and
 * Maestro each must reach a configurable percentage of expo-router routes.
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_REL = "expo/copy-overwrite/scripts/check-e2e-coverage.mjs";
const THRESHOLDS_FILENAME = "e2e.thresholds.json";
const THRESHOLDS_REL = `expo/create-only/${THRESHOLDS_FILENAME}`;
const PLAYERS_ROUTE = "/players/[id]";
const DOCS_ROUTE = "/docs/[...slug]";
const PLAYERS_VISIT = "/players/42";

/**
 * Read a repo-relative text file.
 * @param relativePath - Repo-relative path
 * @returns File contents
 */
function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");
}

/** Per-runner thresholds accepted by the evaluator. */
interface E2eThresholds {
  readonly playwright: { readonly routes: number };
  readonly maestro: { readonly routes: number };
}
/** Per-runner verdict from the evaluator. */
interface RunnerVerdict {
  readonly threshold: number;
  readonly total: number;
  readonly covered: number;
  readonly percentage: number;
  readonly missing: string[];
  readonly ok: boolean;
}
/** Whole-gate verdict from the evaluator. */
interface E2eCoverageResult {
  readonly ok: boolean;
  readonly runners: Record<"playwright" | "maestro", RunnerVerdict>;
}

describe("check-e2e-coverage", () => {
  // Dynamic import via a runtime URL keeps this typed as `any` (no .mjs decls).
  let routeFromFile: (relativePath: string) => string | null;
  let enumerateRoutes: (files: string[]) => string[];
  let normalizeVisitedPath: (raw: string) => string | null;
  let extractPlaywrightPaths: (source: string) => string[];
  let extractMaestroPaths: (source: string) => string[];
  let routeMatchesVisit: (route: string, visited: string) => boolean;
  let mergeThresholds: (
    defaults: E2eThresholds,
    overrides: object
  ) => E2eThresholds;
  let evaluateE2eCoverage: (input: {
    routes: string[];
    playwrightVisited: string[];
    maestroVisited: string[];
    thresholds: E2eThresholds;
  }) => E2eCoverageResult;
  let defaultThresholds: E2eThresholds;
  let loadThresholdOverrides: (thresholdsFile: string) => object;

  beforeAll(async () => {
    const url = pathToFileURL(path.join(REPO_ROOT, SCRIPT_REL)).href;
    const mod = await import(url);
    routeFromFile = mod.routeFromFile;
    enumerateRoutes = mod.enumerateRoutes;
    normalizeVisitedPath = mod.normalizeVisitedPath;
    extractPlaywrightPaths = mod.extractPlaywrightPaths;
    extractMaestroPaths = mod.extractMaestroPaths;
    routeMatchesVisit = mod.routeMatchesVisit;
    mergeThresholds = mod.mergeThresholds;
    evaluateE2eCoverage = mod.evaluateE2eCoverage;
    defaultThresholds = mod.defaultThresholds;
    loadThresholdOverrides = mod.loadThresholdOverrides;
  });

  describe("route enumeration", () => {
    it("maps index files to their parent path", () => {
      expect(routeFromFile("index.tsx")).toBe("/");
      expect(routeFromFile("profile/index.tsx")).toBe("/profile");
    });

    it("strips route groups from the URL", () => {
      expect(routeFromFile("(tabs)/home.tsx")).toBe("/home");
      expect(routeFromFile("(app)/(tabs)/settings/index.tsx")).toBe(
        "/settings"
      );
    });

    it("keeps dynamic and catch-all segments", () => {
      expect(routeFromFile("players/[id].tsx")).toBe(PLAYERS_ROUTE);
      expect(routeFromFile("docs/[...slug].tsx")).toBe(DOCS_ROUTE);
      expect(routeFromFile("players/[🚀🚀id].tsx")).toBe("/players/[🚀🚀id]");
    });

    it("maps Metro platform files to their shared route", () => {
      expect(routeFromFile("index.web.tsx")).toBe("/");
      expect(routeFromFile("profile/index.ios.tsx")).toBe("/profile");
      expect(routeFromFile("settings.native.tsx")).toBe("/settings");
      expect(routeFromFile("players/[id].android.tsx")).toBe(PLAYERS_ROUTE);
      expect(routeFromFile("docs/[...slug].web.tsx")).toBe(DOCS_ROUTE);
    });

    it("excludes double-extension companion files", () => {
      expect(routeFromFile("global.d.ts")).toBeNull();
      expect(routeFromFile("Card.stories.tsx")).toBeNull();
      expect(routeFromFile("index.test.tsx")).toBeNull();
      expect(routeFromFile("spike/indexability.spec.ts")).toBeNull();
      expect(routeFromFile("players/[id].test.tsx")).toBeNull();
      expect(routeFromFile("players/[🚀🚀id].test.tsx")).toBeNull();
      expect(routeFromFile("docs/[...slug].stories.tsx")).toBeNull();
      expect(routeFromFile("Card.stories.web.tsx")).toBeNull();
    });

    it("excludes layouts, private files, special files, and API routes", () => {
      expect(routeFromFile("_layout.tsx")).toBeNull();
      expect(routeFromFile("(tabs)/_layout.tsx")).toBeNull();
      expect(routeFromFile("_private/helper.tsx")).toBeNull();
      expect(routeFromFile("+not-found.tsx")).toBeNull();
      expect(routeFromFile("+html.tsx")).toBeNull();
      expect(routeFromFile("api/users+api.ts")).toBeNull();
      expect(routeFromFile("styles.css")).toBeNull();
    });

    it("dedupes routes that collapse to the same URL", () => {
      expect(
        enumerateRoutes(["(a)/home.tsx", "(b)/home.tsx", "_layout.tsx"])
      ).toEqual(["/home"]);
    });

    it("sorts by code-unit order, not locale-aware collation", () => {
      // Code-unit order is deterministic: uppercase code units (< 0x5B) sort
      // before lowercase (>= 0x61), so ["/Zebra", "/apple"] — reproducible
      // regardless of the runtime's ICU locale, unlike locale-sensitive
      // collation.
      expect(enumerateRoutes(["apple.tsx", "Zebra.tsx"])).toEqual([
        "/Zebra",
        "/apple",
      ]);
    });
  });

  describe("visited path normalization", () => {
    it("passes through absolute paths and strips query/hash and trailing slash", () => {
      expect(normalizeVisitedPath("/profile?tab=1#top")).toBe("/profile");
      expect(normalizeVisitedPath("/profile/")).toBe("/profile");
      expect(normalizeVisitedPath("/")).toBe("/");
    });

    it("takes the path of http(s) URLs", () => {
      expect(normalizeVisitedPath("https://example.com/players/42")).toBe(
        PLAYERS_VISIT
      );
      expect(normalizeVisitedPath("https://example.com")).toBe("/");
    });

    it("treats everything after :// as the route for custom schemes", () => {
      expect(normalizeVisitedPath("myapp://profile/42")).toBe("/profile/42");
    });

    it("uses the /--/ suffix of Expo dev-client URLs", () => {
      expect(normalizeVisitedPath("exp://127.0.0.1:8081/--/settings")).toBe(
        "/settings"
      );
    });
  });

  describe("extraction", () => {
    it("extracts page.goto targets and e2e-route annotations from specs", () => {
      const source = [
        'await page.goto("/home");',
        "await page.goto(`/players/${playerId}`);",
        "// e2e-route: /settings (reached by tapping the gear icon)",
      ].join("\n");
      expect(extractPlaywrightPaths(source)).toEqual([
        "/home",
        "/players/${playerId}",
        "/settings",
      ]);
    });

    it("extracts openLink targets and e2e-route annotations from flows", () => {
      const source = [
        "appId: com.example.app",
        "---",
        '- openLink: "myapp://players/42"',
        "# e2e-route: /settings",
      ].join("\n");
      expect(extractMaestroPaths(source)).toEqual([PLAYERS_VISIT, "/settings"]);
    });
  });

  describe("route matching", () => {
    it("matches literal routes exactly", () => {
      expect(routeMatchesVisit("/home", "/home")).toBe(true);
      expect(routeMatchesVisit("/home", "/home/extra")).toBe(false);
      expect(routeMatchesVisit("/home/extra", "/home")).toBe(false);
    });

    it("matches dynamic segments against any value", () => {
      expect(routeMatchesVisit(PLAYERS_ROUTE, PLAYERS_VISIT)).toBe(true);
      expect(routeMatchesVisit(PLAYERS_ROUTE, "/players")).toBe(false);
    });

    it("matches catch-all segments against one or more segments", () => {
      expect(routeMatchesVisit(DOCS_ROUTE, "/docs/a/b")).toBe(true);
      expect(routeMatchesVisit(DOCS_ROUTE, "/docs")).toBe(false);
    });

    it("treats template-literal holes as wildcards", () => {
      expect(routeMatchesVisit(PLAYERS_ROUTE, "/players/${playerId}")).toBe(
        true
      );
    });
  });

  describe("threshold merge", () => {
    it("defaults both runners to 80% route coverage", () => {
      expect(defaultThresholds).toEqual({
        playwright: { routes: 80 },
        maestro: { routes: 80 },
      });
    });

    it("overlays partial project overrides per runner", () => {
      expect(
        mergeThresholds(defaultThresholds, { maestro: { routes: 50 } })
      ).toEqual({ playwright: { routes: 80 }, maestro: { routes: 50 } });
    });
  });

  describe("threshold file loading", () => {
    it("returns an empty object when the thresholds file is absent", () => {
      const missingFile = path.join(
        os.tmpdir(),
        "e2e-coverage-test-missing-thresholds.json"
      );
      expect(loadThresholdOverrides(missingFile)).toEqual({});
    });

    it("parses valid JSON thresholds", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-coverage-test-"));
      const file = path.join(dir, THRESHOLDS_FILENAME);
      fs.writeFileSync(file, JSON.stringify({ maestro: { routes: 50 } }));
      expect(loadThresholdOverrides(file)).toEqual({
        maestro: { routes: 50 },
      });
    });

    it("throws a readable error instead of an uncaught SyntaxError on malformed JSON", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-coverage-test-"));
      const file = path.join(dir, THRESHOLDS_FILENAME);
      fs.writeFileSync(file, "{ not valid json");
      expect(() => loadThresholdOverrides(file)).toThrow(
        /e2e\.thresholds\.json is not valid JSON/
      );
    });
  });

  describe("evaluation", () => {
    it("passes when both runners meet their thresholds", () => {
      const result = evaluateE2eCoverage({
        routes: ["/home", PLAYERS_ROUTE],
        playwrightVisited: ["/home", "/players/1"],
        maestroVisited: ["/home", "/players/1"],
        thresholds: defaultThresholds,
      });
      expect(result.ok).toBe(true);
      expect(result.runners.playwright.percentage).toBe(100);
    });

    it("fails the runner under threshold and lists uncovered routes", () => {
      const result = evaluateE2eCoverage({
        routes: ["/home", "/settings"],
        playwrightVisited: ["/home", "/settings"],
        maestroVisited: ["/home"],
        thresholds: defaultThresholds,
      });
      expect(result.ok).toBe(false);
      expect(result.runners.playwright.ok).toBe(true);
      expect(result.runners.maestro.ok).toBe(false);
      expect(result.runners.maestro.missing).toEqual(["/settings"]);
      expect(result.runners.maestro.percentage).toBe(50);
    });

    it("passes trivially with zero routes", () => {
      const result = evaluateE2eCoverage({
        routes: [],
        playwrightVisited: [],
        maestroVisited: [],
        thresholds: defaultThresholds,
      });
      expect(result.ok).toBe(true);
      expect(result.runners.playwright.percentage).toBe(100);
    });

    it("disables a runner's gate at threshold 0 without hiding its numbers", () => {
      const result = evaluateE2eCoverage({
        routes: ["/home"],
        playwrightVisited: ["/home"],
        maestroVisited: [],
        thresholds: { playwright: { routes: 80 }, maestro: { routes: 0 } },
      });
      expect(result.ok).toBe(true);
      expect(result.runners.maestro.percentage).toBe(0);
      expect(result.runners.maestro.missing).toEqual(["/home"]);
    });
  });

  describe("wiring", () => {
    it("ships the gate script as a managed expo script", () => {
      expect(fs.existsSync(path.join(REPO_ROOT, SCRIPT_REL))).toBe(true);
    });

    it("ships the project-tunable thresholds file at the 0% brownfield-safe default", () => {
      // Shipped defaults are 0/0 so adopting Lisa on a brownfield Expo app does
      // not red-gate CI before any e2e specs exist. It is a ratchet: projects
      // raise the floor as coverage grows. A `_comment` documents that intent.
      const thresholds = JSON.parse(read(THRESHOLDS_REL)) as {
        readonly _comment?: string;
        readonly playwright: { readonly routes: number };
        readonly maestro: { readonly routes: number };
      };
      expect(thresholds.playwright.routes).toBe(0);
      expect(thresholds.maestro.routes).toBe(0);
      expect(typeof thresholds._comment).toBe("string");
    });

    it("wires the e2e_coverage CI job behind script presence", () => {
      const workflow = read(".github/workflows/quality.yml");
      expect(workflow).toContain("e2e_coverage:");
      expect(workflow).toContain("check-e2e-coverage.mjs");
      expect(workflow).toContain("!contains(inputs.skip_jobs, 'e2e_coverage')");
    });

    it("registers the thresholds artifact in the sync registry", () => {
      const registry = read("src/sync/registry.ts");
      expect(registry).toContain("quality.e2eCoverage");
      expect(registry).toContain("e2e.thresholds.json");
    });
  });
});
