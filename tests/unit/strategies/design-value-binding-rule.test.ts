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

/** The four entries on the non-block list. */
const NON_BLOCK_ENTRIES = [
  "untyped",
  "One-off values",
  "token exists and is bound",
  "Aesthetic uncertainty",
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

    it("states the per-axis regime on both sides, not a per-project one", () => {
      for (const body of [eager, reference]) {
        expect(body).toMatch(/per[- ]axis/iu);
        expect(body).toContain("color");
        expect(body).toContain("spacing");
        expect(body).toContain("typography");
        expect(body).toContain("radius");
        expect(body).toContain("elevation");
        expect(body).toContain("motion");
      }
    });

    it("records that a live collection query is not headlessly possible", () => {
      // The premise this contract was first written on. Losing it invites a
      // rewrite to the "obvious" implementation, which works interactively and
      // silently no-ops in cron and CI.
      for (const body of [eager, reference]) {
        expect(body).toMatch(/Enterprise-plan only/u);
        expect(body).toMatch(/browser OAuth/u);
      }
      expect(reference).toContain("/v1/files/:key/nodes");
    });

    it("derives the regime from a committed id map whose staleness is self-detecting", () => {
      for (const body of [eager, reference]) {
        expect(body).toMatch(/committed variable-id map|committed id map/u);
        expect(body).toMatch(/fail loudly|fails loudly/u);
        expect(body).toMatch(/never silently resolves to the wrong variable/u);
      }
    });

    it("carries both silent under-reporting traps in the reference body", () => {
      expect(reference).toContain("rectangleCornerRadii");
      expect(reference).toMatch(/zero bound radii on a fully bound file/u);
      expect(reference).toMatch(/omits zero-valued properties/u);
      expect(reference).toMatch(/never inferred from a resolved value/u);
    });

    it("requires the implemented subtree to be measured, not the enclosing frame", () => {
      for (const body of [eager, reference]) {
        expect(body).toMatch(/subtree/u);
      }
      expect(reference).toMatch(/14 bound values at frame level/u);
    });

    it("makes the design source optional, and says so on both sides", () => {
      // The requirement that outranks every other one here: a mandatory gate on
      // an absent integration breaks every project with no designs.
      for (const body of [eager, reference]) {
        expect(body).toContain("SKIPPED");
        expect(body).toMatch(
          /breaks every (non-design project|project that has no designs)/u
        );
      }
    });

    it("attributes every failure to an owner, keeping design and us distinct", () => {
      for (const body of [eager, reference]) {
        expect(body).toMatch(/\*\*design\*\*/u);
        expect(body).toMatch(/\*\*us\*\*/u);
        expect(body).toMatch(/stale|ambiguous/u);
      }
      expect(eager).toMatch(/wrong person the wrong work/u);
    });

    it("defaults the threshold to 100% and keeps any relaxation visible", () => {
      for (const body of [eager, reference]) {
        expect(body).toContain("100%");
        expect(body).toContain("--min");
      }
      expect(reference).toMatch(
        /rather than by quietly softening the gate in code/u
      );
    });

    it("carries all five block conditions on both sides", () => {
      for (const condition of BLOCK_CONDITIONS) {
        expect(eager).toContain(condition);
        expect(reference).toContain(condition);
      }
    });

    it("carries the whole non-block list, which is what keeps it from firing constantly", () => {
      for (const entry of NON_BLOCK_ENTRIES) {
        expect(eager).toContain(entry);
        expect(reference).toContain(entry);
      }
    });

    it("blocks on unbound rather than on unsure", () => {
      for (const body of [eager, reference]) {
        expect(body).toMatch(/block on \*?unbound\*?, never on \*?unsure\*?/iu);
      }
    });

    it("keeps visual matching legitimate in an untyped axis", () => {
      for (const body of [eager, reference]) {
        expect(body).toContain(
          "do not derive a value from pixels when a binding exists"
        );
      }
    });

    it("requires derived values to be recorded, not merely used", () => {
      expect(eager).toMatch(/record/iu);
      expect(reference).toContain("ranked by what people actually needed");
    });

    it("names every escalation input as a config key", () => {
      for (const key of CONFIG_KEYS) {
        expect(eager).toContain(key);
        expect(reference).toContain(key);
      }
    });

    it("treats an unset assignee as a block condition of its own", () => {
      for (const body of [eager, reference]) {
        expect(body).toContain("assigned to nobody");
      }
    });

    it("routes escalation through the tracker abstraction, not a hardcoded label", () => {
      expect(eager).toContain("never a hardcoded label call");
      expect(reference).toContain("lisa-tracker-write");
      expect(reference).toContain("Linear");
      expect(reference).toContain("GitHub");
      expect(reference).toContain("JIRA");
    });

    it("stays distinct from design-source-of-truth rather than absorbing it", () => {
      for (const body of [eager, reference]) {
        expect(body).toContain("design-source-of-truth");
      }
      expect(eager).toMatch(/declares? where its design came from/iu);
      expect(reference).toMatch(/values on it bound/iu);
    });

    it("defers to host design-system rules rather than replacing them", () => {
      expect(reference).toContain("stay authoritative");
      expect(reference).toContain("design-system");
    });

    it("keeps the blocked comment in plain language a non-technical reader can act on", () => {
      expect(reference).toContain(
        "otherwise I'd be copying a number that changes without warning"
      );
      expect(reference).toMatch(/no engineering vocabulary/iu);
    });

    describe("motivating example", () => {
      const rationale = section(
        eager,
        "## Why this is a block and not a warning — the measured case"
      );

      it("carries the observed failure rather than an abstract argument", () => {
        expect(rationale).toMatch(
          /A block downgraded to a warning, by the agent enforcing it, inside the document enforcing it/u
        );
        expect(rationale).toContain(
          "snap unbound dimensions via the snap tables (ties round down) and flag the rest"
        );
      });

      it("keeps the coverage figures, which are the argument", () => {
        for (const figure of [
          "96-100%",
          "82-97%",
          "88-93%",
          "1-4%",
          "0-2%",
          "0-3%",
        ]) {
          expect(rationale).toContain(figure);
        }
        expect(rationale).toMatch(
          /Five of the eleven items blocked back to design; six proceeded/u
        );
        expect(rationale).toMatch(/\*\*zero variable references\*\*/u);
        expect(rationale).toMatch(/every style value was invented/u);
      });

      it("answers the delivery pressure that produced the softening", () => {
        expect(rationale).toMatch(
          /domain types, adapters, CRUD, formatters — was completed and preserved/u
        );
        expect(rationale).toMatch(
          /Blocking cost far less than it appeared it would/u
        );
      });

      it("carries the rationale line the executable rung rests on", () => {
        expect(rationale).toMatch(
          /A gate that depends on an agent choosing to honour it under delivery pressure is not a gate/u
        );
      });

      it("attributes the failure to no project, tracker item, or individual", () => {
        expect(rationale).not.toMatch(/\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/u);
        expect(rationale).not.toMatch(/#\d/u);
        expect(rationale).not.toMatch(/https?:\/\//u);
      });
    });

    it("calls the frame-vs-subtree distinction decision-changing on both sides", () => {
      expect(eager).toMatch(/decision-changing, not a refinement/u);
      for (const body of [eager, reference]) {
        expect(body).toMatch(/5 of 11 real work/u);
      }
    });

    it("names no person anywhere — the escalation target is a config key", () => {
      for (const body of [eager, reference]) {
        // An `@handle`, or an assignee written as a literal value rather than
        // as the config key that supplies one.
        expect(body).not.toMatch(/@[a-z0-9][a-z0-9-]{2,}\b/iu);
        expect(body).not.toMatch(/assignee\s*[:=]\s*["'][^"']+["']/iu);
      }
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
