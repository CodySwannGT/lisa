/**
 * The guard applied to THIS repository (issue #2509).
 *
 * The unit suite proves the rules fire on synthetic roots. This one proves they
 * are actually binding on Lisa's own governance surface — which is the only
 * thing that makes it an executable control rather than a well-tested library
 * nobody points at anything.
 *
 * It runs inside `🧪 Run Unit Tests`, which is already a required context, so a
 * promotion that skips the ledger cannot merge.
 *
 * @module tests/unit/scripts/required-check-promotions.repo
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  collectDeclaredContexts,
  evaluate,
  LEDGER_RELATIVE_PATH,
} from "../../../scripts/check-required-check-promotions.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);

const ledger = (): {
  grandfathered_contexts: string[];
  promotions: {
    context: string;
    headroom: { status: string; debt?: string };
  }[];
} =>
  JSON.parse(readFileSync(path.join(REPO_ROOT, LEDGER_RELATIVE_PATH), "utf8"));

describe("Lisa's own required-check promotions", () => {
  it("has no violations", () => {
    const result = evaluate(REPO_ROOT);
    expect(result.violations).toEqual([]);
  });

  it("covers every context Lisa declares required, in a template or in config", () => {
    const declared = new Set(
      collectDeclaredContexts(REPO_ROOT).map(d => d.context)
    );
    const recorded = new Set(ledger().promotions.map(p => p.context));
    expect([...declared].filter(c => !recorded.has(c))).toEqual([]);
    expect([...recorded].filter(c => !declared.has(c))).toEqual([]);
  });

  it("records the sonar-secrets analogy debt against the unit-test context", () => {
    // #2509 scope item 3: sonar-secrets is the one shipped budget known to be
    // sized by analogy — its 16-way probe ran against plugin-sync-scripts. It
    // rides inside `🧪 Run Unit Tests`, which is already required, so the debt
    // is real today and belongs on the record rather than in a comment.
    const entry = ledger().promotions.find(
      p => p.context === "🔍 Quality Checks / 🧪 Run Unit Tests"
    );
    expect(entry?.headroom.status).toBe("grandfathered");
    expect(entry?.headroom.debt).toContain("sonar-secrets");
  });

  it("freezes incumbency: nothing may be grandfathered that is not already listed", () => {
    const frozen = new Set(ledger().grandfathered_contexts);
    const grandfathered = ledger()
      .promotions.filter(p => p.headroom.status === "grandfathered")
      .map(p => p.context);
    expect(grandfathered.filter(c => !frozen.has(c))).toEqual([]);
  });

  it("is wired to a package script so an operator can run it by hand", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
    );
    expect(pkg.scripts["check:required-check-promotions"]).toBe(
      "node scripts/check-required-check-promotions.mjs"
    );
  });
});
