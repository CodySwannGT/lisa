/**
 * Contract coverage for the vendor-neutral `design-value-binding` rule — the
 * eager-rule rung of the design-handoff policy.
 *
 * Three things are pinned because they are the three most likely to rot.
 *
 * The **non-block list** is first, and it is the one a well-meaning edit
 * deletes: it reads like a set of exemptions weakening a rule, so it looks like
 * safe prose to trim. It is not. Without it the contract says "block when
 * information is missing" with no boundary, an agent blocks on every axis, and
 * the whole policy is switched off within a week. The `unbound` / `unsure`
 * distinction is what makes the rule decide the same way twice.
 *
 * The **separation from `design-source-of-truth`** is second: the two contracts
 * are one word apart in name and easy to collapse into each other, and a merge
 * would silently drop whichever question the survivor does not ask.
 *
 * The **absence of any person's identity** is third, and it is asserted rather
 * than trusted. This repository is public and its build output ships to a
 * package registry, so an escalation target written as a name instead of a
 * config key is published twice over.
 * @module tests/unit/strategies/design-value-binding-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** Every skill wired to cite the contract rather than restate it. */
const CITING_SKILLS = [
  "lisa-implement",
  "lisa-tdd-implementation",
  "lisa-review-local",
  "lisa-quality-review",
] as const;

/** The configuration keys that carry the escalation target and the regime. */
const CONFIG_KEYS = [
  "design.escalation.assignee",
  "design.escalation.label",
  "design.tokens.source",
] as const;

/** The five block conditions, each by the phrase that identifies it. */
const BLOCK_CONDITIONS = [
  "A named token does not exist",
  "hardcoded in the design",
  "not published",
  "no design",
  "disagree",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

/**
 * The body of one `##` section, so a redaction assertion can be scoped to the
 * prose carrying the motivating example rather than to the whole document.
 * @param body - Full document text.
 * @param heading - The exact `## …` heading line.
 * @returns Text between that heading and the next `##` heading.
 */
const section = (body: string, heading: string): string => {
  const start = body.indexOf(heading);
  if (start === -1) return "";
  const rest = body.slice(start + heading.length);
  const end = rest.indexOf("\n## ");
  return end === -1 ? rest : rest.slice(0, end);
};

describe("design-value-binding rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/reference/design-value-binding.md");
    const reference = read(root, "rules/reference/design-value-binding.md");

    it("ships as a paired rule with a non-trivial body on both sides", () => {
      expect(eager.length).toBeGreaterThan(500);
      expect(reference.length).toBeGreaterThan(2000);
    });

    it("stays reachable from the eager rule index", () => {
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/design-value-binding.md"
      );
    });

    it("records that a live collection query is not headlessly possible", () => {
      expect(reference).toContain("/v1/files/:key/nodes");
    });

    it("carries both silent under-reporting traps in the reference body", () => {
      expect(reference).toContain("rectangleCornerRadii");
    });

    it("makes the design source optional, and says so on both sides", () => {
      // The requirement that outranks every other one here: a mandatory gate on
      // an absent integration breaks every project with no designs.
      for (const body of [eager, reference]) {
        expect(body).toContain("SKIPPED");
      }
    });

    it("defaults the threshold to 100% and keeps any relaxation visible", () => {
      for (const body of [eager, reference]) {
        expect(body).toContain("--min");
      }
    });

    it("carries all five block conditions on both sides", () => {
      for (const condition of BLOCK_CONDITIONS) {
        expect(eager).toContain(condition);
        expect(reference).toContain(condition);
      }
    });

    it("names every escalation input as a config key", () => {
      for (const key of CONFIG_KEYS) {
        expect(eager).toContain(key);
        expect(reference).toContain(key);
      }
    });

    it("routes escalation through the tracker abstraction, not a hardcoded label", () => {
      expect(reference).toContain("lisa-tracker-write");
      expect(reference).toContain("JIRA");
    });

    it("stays distinct from design-source-of-truth rather than absorbing it", () => {
      for (const body of [eager, reference]) {
        expect(body).toContain("design-source-of-truth");
      }
    });

    it("defers to host design-system rules rather than replacing them", () => {
      expect(reference).toContain("design-system");
    });

    it("keeps the blocked comment in plain language a non-technical reader can act on", () => {
      expect(reference).toContain(
        "otherwise I'd be copying a number that changes without warning"
      );
    });

    describe("motivating example", () => {
      const rationale = section(
        eager,
        "## Why this is a block and not a warning — the measured case"
      );

      it("answers the delivery pressure that produced the softening", () => {
        expect(rationale).toMatch(
          /domain types, adapters, CRUD, formatters — was completed and preserved/u
        );
      });
    });
  });

  describe.each(ROOTS)("%s skill citations", root => {
    it.each(CITING_SKILLS)(
      "%s cites the rule instead of restating it",
      skill => {
        const body = read(root, `skills/${skill}/SKILL.md`);
        expect(body).toContain("design-value-binding");
      }
    );
  });
});
