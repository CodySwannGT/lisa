/**
 * The agent-facing audit ladder must teach the scoped exclusion shape (#4521).
 *
 * An agent that reaches rung 5 writes whatever exclusion the rule shows it. If
 * the rule only shows `id`/`package`/`reason`, every agent-authored exception is
 * advisory-wide — it silences a later production copy as well as the reviewed
 * dev-only one. Both tiers must therefore name `versions` and `paths`, and the
 * ladder must recommend path scope for a dev-only copy. The ladder now lives in
 * the `lisa-security-audit-handling` skill, which the audit's failure message
 * names. Checked in the source tree and the generated Claude plugin so a stale
 * build cannot hide drift.
 * @module tests/unit/strategies/security-audit-handling-scope
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const SKILL = "skills/lisa-security-audit-handling/SKILL.md";
const DOC_URL =
  "https://github.com/CodySwannGT/lisa/blob/main/docs/dependency-audit-exclusions.md";

const read = (root: string): string =>
  readFileSync(path.resolve(root, SKILL), "utf8");

describe.each(ROOTS)("security-audit-handling scope guidance (%s)", root => {
  it("documents both scope fields with lockfile keys", () => {
    const skill = read(root);
    expect(skill).toContain("`versions`");
    expect(skill).toContain("`paths`");
    expect(skill).toMatch(/lockfile key path/u);
    expect(skill).toContain('"paths": ["lint-plugin/pkg"]');
  });

  it("links the exclusion guide by absolute URL (docs/ is not shipped)", () => {
    expect(read(root)).toContain(DOC_URL);
  });

  it("states the weaker isolation of Yarn and hoisted npm keys", () => {
    const skill = read(root);
    expect(skill).toMatch(/requested range, not a parent/u);
    expect(skill).toMatch(/hoisted/u);
  });

  it("recommends paths over an ID-wide entry for dev-only copies", () => {
    const skill = read(root);
    expect(skill).toMatch(
      /Whenever the vulnerable copy is dev-only[^\n]*add `versions` and `paths` rather than an ID-wide entry/u
    );
    expect(skill).toMatch(/never widens into an ID-wide exclusion/u);
  });

  it("is named by the audit's failure message", () => {
    for (const script of [
      "all/copy-overwrite/scripts/lisa-audit.mjs",
      "scripts/lisa-audit.mjs",
    ])
      expect(readFileSync(script, "utf8"), script).toContain(
        "lisa-security-audit-handling"
      );
  });
});
