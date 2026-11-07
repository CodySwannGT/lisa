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

  it("the reference ladder recommends paths over an ID-wide entry for dev-only copies", () => {
    const reference = read(root, "reference");
    expect(reference).toMatch(
      /Whenever the vulnerable copy is dev-only[^\n]*add `versions` and `paths` rather than an ID-wide entry/u
    );
    expect(reference).toMatch(/never widens into an ID-wide exclusion/u);
  });
});
