import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @file harper-fabric-template-no-advisory-pollution.test.ts
 * @description Regression guard for the cross-project package.json corruption bug.
 *
 * Root cause: the `harper-fabric/package-lisa/package.lisa.json` template was
 * originally seeded wholesale from the `advisory-rankings` project's package.json
 * (advisory-rankings was the first harper-fabric project). That copy dragged in
 * advisory-rankings *application* content — a `cheerio` dependency and ~15
 * project-specific scripts (`brokercheck`, `crawl:*`, `seed:rest`, `ingest`,
 * etc.) — into the SHARED governance template.
 *
 * Because `package.lisa.json` is applied to every harper-fabric project on
 * install (`force` / `defaults` semantics), every other harper-fabric project
 * (e.g. harperstarter) had advisory-rankings' scripts and `cheerio` merged into
 * its own package.json during Lisa's postinstall apply. This reproduced in full
 * isolation with no concurrent install, because the pollution lives in committed
 * template data, not in any runtime race.
 *
 * This test reads the REAL shipped template (not a synthetic fixture) and asserts
 * that no advisory-rankings application script or dependency is present. It fails
 * on the polluted template and passes once the advisory content is removed.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const HARPER_FABRIC_TEMPLATE = path.join(
  REPO_ROOT,
  "harper-fabric",
  "package-lisa",
  "package.lisa.json"
);

/**
 * One force/defaults section of a package.lisa.json template (the subset this
 * test inspects).
 */
interface PackageLisaSection {
  readonly scripts?: Record<string, string>;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

/**
 * Minimal shape of a package.lisa.json governance template.
 */
interface PackageLisaTemplate {
  readonly force?: PackageLisaSection;
  readonly defaults?: PackageLisaSection;
  readonly merge?: Record<string, unknown[]>;
}

/**
 * advisory-rankings application-specific script names that leaked into the
 * shared harper-fabric governance template. None of these belong in a generic
 * harper-fabric starter — they reference dist/scripts/*.js files that only exist
 * in the advisory-rankings project.
 */
const ADVISORY_ONLY_SCRIPTS: readonly string[] = [
  "seed:rest",
  "verify:rest",
  "preview",
  "smoke",
  "smoke:brokercheck",
  "token",
  "crawl:wpjson",
  "crawl:html",
  "crawl:playwright",
  "extract:fields",
  "extract:helper",
  "ingest",
  "load:extractions",
  "brokercheck",
  "brokercheck:crawl",
];

/**
 * advisory-rankings application dependencies that must not be forced onto every
 * harper-fabric project. `cheerio` is an HTML-scraping library specific to the
 * advisory-rankings crawlers; a generic harper-fabric project has no use for it.
 */
const ADVISORY_ONLY_DEPENDENCIES: readonly string[] = ["cheerio"];

describe("harper-fabric package.lisa.json — no advisory-rankings pollution", () => {
  const template = JSON.parse(
    readFileSync(HARPER_FABRIC_TEMPLATE, "utf-8")
  ) as PackageLisaTemplate;

  const allScriptNames = [
    ...Object.keys(template.force?.scripts ?? {}),
    ...Object.keys(template.defaults?.scripts ?? {}),
  ];

  const allDependencyNames = [
    ...Object.keys(template.force?.dependencies ?? {}),
    ...Object.keys(template.defaults?.dependencies ?? {}),
  ];

  it.each(ADVISORY_ONLY_SCRIPTS)(
    "does not contain advisory-rankings script %s",
    scriptName => {
      expect(allScriptNames).not.toContain(scriptName);
    }
  );

  it.each(ADVISORY_ONLY_DEPENDENCIES)(
    "does not contain advisory-rankings dependency %s",
    depName => {
      expect(allDependencyNames).not.toContain(depName);
    }
  );

  it("keeps the legitimate generic harper-fabric scaffolding scripts", () => {
    // These scripts have backing source files in a generic harper-fabric
    // starter (harperstarter): build, seed, verify, dev:server, deploy.
    const defaultsScripts = Object.keys(template.defaults?.scripts ?? {});
    expect(defaultsScripts).toEqual(
      expect.arrayContaining([
        "build",
        "seed",
        "verify",
        "dev:server",
        "deploy",
      ])
    );
  });

  it("forces only harperdb as a runtime dependency", () => {
    expect(template.force?.dependencies).toEqual({ harperdb: "^4.7.29" });
  });
});
