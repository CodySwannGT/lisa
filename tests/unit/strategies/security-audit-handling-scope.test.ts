/**
 * The agent-facing audit ladder must teach the scoped exclusion shape (#4521).
 *
 * An agent that reaches rung 5 writes whatever exclusion the rule shows it. If
 * the rule only shows `id`/`package`/`reason`, every agent-authored exception is
 * advisory-wide — it silences a later production copy as well as the reviewed
 * dev-only one. Both tiers must therefore name `versions` and `paths`, and the
 * reference tier must recommend path scope for a dev-only copy. Checked in the
 * source tree and the generated Claude plugin so a stale build cannot hide drift.
 * @module tests/unit/strategies/security-audit-handling-scope
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const RULE = "security-audit-handling.md";
const DOC_URL =
  "https://github.com/CodySwannGT/lisa/blob/main/docs/dependency-audit-exclusions.md";

const read = (root: string, tier: "eager" | "reference"): string =>
  readFileSync(path.resolve(root, "rules", tier, RULE), "utf8");

describe.each(ROOTS)("security-audit-handling scope guidance (%s)", root => {
  it("the eager ladder names versions and paths for a dev-only copy", () => {
    const eager = read(root, "eager");
    expect(eager).toContain("`versions`");
    expect(eager).toContain("`paths`");
    expect(eager).toMatch(/dev-only/u);
  });

  it("the reference ladder documents both scope fields with lockfile keys", () => {
    const reference = read(root, "reference");
    expect(reference).toContain("`versions`");
    expect(reference).toContain("`paths`");
    expect(reference).toMatch(/lockfile key path/u);
    expect(reference).toContain('"paths": ["lint-plugin/pkg"]');
  });

  it("both tiers link the exclusion guide by absolute URL (docs/ is not shipped)", () => {
    for (const tier of ["eager", "reference"] as const)
      expect(read(root, tier), tier).toContain(DOC_URL);
  });

  it("the reference ladder states the weaker isolation of Yarn and hoisted npm keys", () => {
    const reference = read(root, "reference");
    expect(reference).toMatch(/requested range, not a parent/u);
    expect(reference).toMatch(/hoisted/u);
  });

  it("the reference ladder recommends paths over an ID-wide entry for dev-only copies", () => {
    const reference = read(root, "reference");
    expect(reference).toMatch(
      /Whenever the vulnerable copy is dev-only[^\n]*add `versions` and `paths` rather than an ID-wide entry/u
    );
    expect(reference).toMatch(/never widens into an ID-wide exclusion/u);
  });
});

describe("the exclusion guide the rules link to (docs/dependency-audit-exclusions.md)", () => {
  const guide = readFileSync(
    path.resolve("docs", "dependency-audit-exclusions.md"),
    "utf8"
  );

  it("documents paths as exact lockfile keys", () => {
    expect(guide).toContain('"paths": ["lint-tool/schema-lib"]');
    expect(guide).toMatch(/Paths are exact keys, without glob expansion/u);
  });

  it("recommends path scope over an advisory-wide exception for dev-only copies", () => {
    expect(guide).toMatch(
      /Prefer `paths` over an advisory-wide exception whenever the\s+accepted vulnerable copy belongs only to a development tool/u
    );
  });

  it("documents that a narrower entry is never widened by an advisory-wide one", () => {
    expect(guide).toMatch(/A narrower entry always wins/u);
    expect(guide).toMatch(/advisory-wide exclusion was not applied/u);
  });

  it("documents that a misspelled scope field fails closed and other keys are ignored", () => {
    expect(guide).toMatch(
      /nearly\s+matches one of the five scope fields fails the audit/u
    );
    expect(guide).toMatch(/is ignored by the audit as before/u);
  });

  it("names only genuinely unrecognized keys as ignored, and accepts advisory metadata", () => {
    // `url` and `title` are known metadata fields, so doctor does not report them.
    expect(guide).not.toMatch(/such as `url` or `title`, is ignored/u);
    expect(guide).toMatch(/`cwe`,\s+`ghsa`,\s+`url`,\s+`title`,\s+`severity`/u);
  });

  it("does not claim doctor matches advisories against lockfile copies", () => {
    expect(guide).not.toMatch(/CI audit job,\s+and doctor share/u);
    expect(guide).toMatch(/doctor does not match advisories against/u);
  });
});

describe("the reference rule separates doctor's checks from advisory matching", () => {
  it.each(ROOTS)("%s", root => {
    const reference = read(root, "reference");
    expect(reference).not.toMatch(
      /and `lisa doctor` all use the same matcher/u
    );
    expect(reference).toMatch(/`lisa doctor` checks the scope fields/u);
  });
});
