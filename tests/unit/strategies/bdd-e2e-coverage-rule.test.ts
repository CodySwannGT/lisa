/**
 * Contract coverage for the vendor-neutral bdd-e2e-coverage rule.
 *
 * The eager head + reference body are the executable contract every frontend
 * work item conforms to. These assertions pin the thing most likely to rot:
 * vendor neutrality. The rule generalizes prose that previously named Playwright
 * and Maestro as mandates inside four separate skills, so the head must stay
 * free of runner names, the citing skills must reference the slug instead of
 * re-growing their own divergent copies, and the waiver mechanism must keep
 * reading as a dated IOU rather than as coverage.
 * @module tests/unit/strategies/bdd-e2e-coverage-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const LIFECYCLE_STATUSES = [
  "@blocked",
  "@reference-only",
  "@superseded",
] as const;

/** Runner names that must never appear as a mandate in the eager head. */
const RUNNER_NAMES = [
  "Playwright",
  "Maestro",
  "Cypress",
  "Detox",
  "Appium",
  "WebdriverIO",
] as const;

/** Every skill wired to cite the contract rather than restate it. */
const CITING_SKILLS = [
  "lisa-research",
  "lisa-acceptance-criteria",
  "lisa-task-decomposition",
  "lisa-test-strategy",
  "lisa-tdd-implementation",
  "lisa-implement",
  "lisa-codify-verification",
  "lisa-verification-lifecycle",
  "lisa-spec-conformance",
  "lisa-verify",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("bdd-e2e-coverage rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const reference = read(root, "rules/reference/bdd-e2e-coverage.md");
    // #3992 folded the eager head into the body under its own H2, above a
    // horizontal rule. The vendor-neutrality assertions below are scoped to
    // that section deliberately: the full contract names runners as examples,
    // and the property being pinned is that the SUMMARY mandates none.
    const eager = reference.slice(
      reference.indexOf("## BDD Behavior Contract"),
      reference.indexOf("\n---\n")
    );

    it("ships as a paired rule with a non-trivial body on both sides", () => {
      expect(eager.length).toBeGreaterThan(500);
      expect(reference.length).toBeGreaterThan(2000);
    });

    it("stays reachable from the eager rule index", () => {
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/bdd-e2e-coverage.md"
      );
    });

    it("names no test runner as a mandate in the eager head", () => {
      for (const runner of RUNNER_NAMES) {
        expect(eager).not.toContain(runner);
      }
      expect(eager).toMatch(/configured runner/i);
    });

    it("states vendor neutrality explicitly, with runner names only as examples", () => {
      expect(reference).toContain("This contract never names a test runner");
      // The one paragraph allowed to list tools frames them as interchangeable
      // project configuration, never as the contract's requirement. `\s+` here
      // and below tolerates the ~100-char hard wrap prettier applies to bodies.
      expect(reference).toMatch(/example,\s+never\s+a\s+mandate/i);
      expect(reference).toMatch(/runnerPlatforms/);
    });

    it("defines membership by user-observable surface, not repo or label", () => {
      expect(eager).toMatch(/surface, not repo name or ticket label/i);
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/user.observable/i);
      }
    });

    it("requires stable scenario IDs that survive rewrites", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/stable/i);
        expect(doc).toMatch(/never renumbered/i);
      }
      expect(eager).toMatch(/@BDD-<DOMAIN>-<NNN>/);
    });

    it("carries the four-value scenario lifecycle vocabulary", () => {
      for (const status of LIFECYCLE_STATUSES) {
        expect(eager).toContain(status);
      }
      // The unmarked fourth value — the only one in the coverage denominator.
      expect(eager).toMatch(/no tag/i);
      expect(eager).toMatch(/denominator/i);
    });

    it("counts coverage per scenario-platform obligation", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/scenario-platform\s+(obligation|pair)/i);
      }
      // A pass on one platform never seals another's obligation. `\W+` tolerates
      // the markdown emphasis the head puts on "different".
      expect(eager).toMatch(/different\W+platform/i);
    });

    it("keeps a waiver a dated IOU and never coverage", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/never\s+coverage/i);
        expect(doc).toMatch(/recordedAt|dated/i);
      }
      // The four ways a waiver is itself invalid.
      expect(eager).toMatch(/nonexistent scenario/i);
      expect(eager).toMatch(/undeclared platform/i);
      expect(eager).toMatch(/already-excluded/i);
      expect(eager).toMatch(
        /masks a scenario-platform that already has a mapping/i
      );
    });

    it("distinguishes a waiver from @blocked", () => {
      expect(reference).toMatch(/Waivers versus `@blocked`/);
      expect(reference).toMatch(/the \*\*product\*\* does not do this yet/i);
      expect(reference).toMatch(/this \*\*runner\*\* cannot decide it/i);
    });

    it("makes missing coverage a verification failure rather than a warning", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/not a warning|verification \*\*failure\*\*/i);
      }
      expect(eager).toContain(
        "**Missing BDD coverage is a verification failure, not a warning**"
      );
    });

    it("states the definition-of-done clause with all three conjuncts", () => {
      const dod = /## Definition of done\n\n([\s\S]*?)\n\n## /.exec(eager)?.[1];
      expect(dod).toBeDefined();
      expect(dod).toMatch(/\(1\)[\s\S]*stable ID/);
      expect(dod).toMatch(/\(2\)[\s\S]*dated waiver/);
      expect(dod).toMatch(/\(3\)[\s\S]*coverage gate passes/);
      expect(dod).toMatch(/same PR/);
    });

    it("gives a bootstrap path that never demands a retroactive backfill", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/bootstrap/i);
        expect(doc).toMatch(/burndown/i);
      }
      expect(eager).toMatch(/never backfills/i);
      expect(reference).toMatch(/not a backfill project/i);
      // Mid-life adoption works because the floor is an absolute bar set once,
      // and what protects earned coverage is a per-obligation check against
      // the base revision — not a number somebody has to keep nudging.
      expect(reference).toMatch(/absolute bar/i);
      expect(reference).toMatch(/mapped or waived/i);
      expect(reference).not.toMatch(/may rise and may never fall/i);
    });

    it("forbids a silent skip when a platform has no runner", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/silent skip|Silence is never an exit/i);
      }
      expect(reference).toContain("Silence is never an exit.");
    });

    it("cites sibling rules and consumer skills by bare slug", () => {
      expect(eager).toContain("leaf-only-lifecycle");
      expect(eager).toContain("repo-scope-split");
      for (const skill of CITING_SKILLS) {
        expect(eager).toContain(skill);
      }
      expect(eager).not.toContain("rules/reference/leaf-only-lifecycle.md");
    });
  });

  describe.each(ROOTS)("%s consumers", root => {
    it.each(CITING_SKILLS)("%s cites the contract by slug", skill => {
      const doc = read(root, `skills/${skill}/SKILL.md`);
      expect(doc).toContain("bdd-e2e-coverage");
    });

    it("verification and intent-routing rules defer to the contract", () => {
      for (const rel of [
        "rules/eager/verification.md",
        "rules/reference/verification.md",
        "rules/reference/intent-routing.md",
      ]) {
        expect(read(root, rel)).toContain("bdd-e2e-coverage");
      }
    });

    it("no consumer re-grows the retired dual-runner prose", () => {
      for (const skill of CITING_SKILLS) {
        expect(read(root, `skills/${skill}/SKILL.md`)).not.toMatch(
          /dual-runner/i
        );
      }
      for (const rel of [
        "rules/eager/verification.md",
        "rules/reference/verification.md",
      ]) {
        expect(read(root, rel)).not.toMatch(/dual-runner/i);
      }
    });
  });
});
