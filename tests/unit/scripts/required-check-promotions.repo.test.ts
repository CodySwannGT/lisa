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
    headroom: {
      status: string;
      debt?: string;
      observed_on?: string;
      budget_ms?: number;
      observed_worst_ms?: number;
      budgets?: { observed_on?: string }[];
    };
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

  it("states the provenance of every proven measurement, with none grandfathered out of it", () => {
    // #2528 refuses a missing `observed_on` outright rather than exempting the
    // entries that predate it. That is affordable precisely here: every proven
    // entry in this ledger already recorded, in prose, that its worst case came
    // from runs that COMPLETED, so backfilling states what was already proved.
    // A grandfather clause would have exempted the only entries the new rule
    // could bind on, which is the "prose is enough" failure #2509 exists to
    // refute.
    const proven = ledger().promotions.filter(
      p => p.headroom.status === "proven"
    );
    expect(proven.length).toBeGreaterThan(0);
    expect(proven.map(p => p.headroom.observed_on)).toEqual(
      proven.map(() => "pass")
    );
    for (const entry of proven) {
      for (const budget of entry.headroom.budgets ?? []) {
        expect(budget.observed_on).toBe("pass");
      }
    }
  });

  it("publishes no worst case at or above the budget it justifies", () => {
    // The self-refuting pairing #2523 shipped: 60,245ms cited against a
    // 60,000ms budget. Checked here on the live ledger, not only on fixtures.
    for (const entry of ledger().promotions) {
      if (entry.headroom.status !== "proven") continue;
      expect(entry.headroom.observed_worst_ms).toBeLessThan(
        entry.headroom.budget_ms ?? 0
      );
    }
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
