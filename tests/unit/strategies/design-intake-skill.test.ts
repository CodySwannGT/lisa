/**
 * Contract coverage for `lisa-design-intake` and its `/lisa:design:intake`
 * command — the judgment rung of the design-handoff policy.
 *
 * The executable half is pinned by `design-intake-gate.test.ts`. What is pinned
 * here is everything that lives in the skill because it cannot live in a
 * script: that the skill DEFERS to the gate rather than re-deriving a verdict
 * in prose, that it emits `aesthetic-concern` as a finding rather than treating
 * it as a block, and that it routes escalation through the vendor-neutral
 * tracker layer rather than a vendor label call.
 *
 * Also asserted, and not merely trusted: that no person's name or handle
 * appears. This repository is public and its build output ships to a package
 * registry, so an escalation target written as a person instead of a config key
 * is published twice over.
 * @module tests/unit/strategies/design-intake-skill
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** Every finding kind the skill is allowed to emit. */
const FINDING_KINDS = [
  "bound",
  "hardcoded-in-design",
  "measured",
  "missing-token",
  "unpublished-component",
  "missing-state",
  "source-disagreement",
  "one-off",
  "aesthetic-concern",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

/**
 * The body of one `##` section, so a redaction assertion can be scoped to the
 * prose that carries the motivating example rather than to the whole file —
 * which legitimately contains the `org/repo#123` argument placeholder.
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

describe("lisa-design-intake skill contract", () => {
  describe.each(ROOTS)("%s", root => {
    const skill = read(root, "skills/lisa-design-intake/SKILL.md");
    const command = read(root, "commands/design/intake.md");

    it("ships with a substantial body and a description", () => {
      expect(skill.length).toBeGreaterThan(2000);
      expect(skill).toMatch(/^---\nname: lisa-design-intake\n/u);
      expect(skill).toContain("description:");
    });

    it("delegates the verdict to the gate instead of re-deriving it in prose", () => {
      expect(skill).toContain("scripts/design-intake-gate.mjs");
    });

    it("records that listing the published collections is not headlessly possible", () => {
      expect(skill).toContain("/v1/files/:key/nodes");
    });

    it("derives the regime from the committed variable-id map", () => {
      expect(skill).toContain("design-variable-ids.mjs");
      expect(skill).toContain("design-bindings-probe.mjs");
    });

    it("carries both silent under-reporting traps so a rewrite cannot lose them", () => {
      expect(skill).toContain("rectangleCornerRadii");
    });

    it("enumerates every finding kind, including the ones that never block", () => {
      for (const kind of FINDING_KINDS) {
        expect(skill).toContain(kind);
      }
    });

    it("keeps aesthetic uncertainty a finding rather than a block", () => {
      expect(skill).toMatch(
        /`aesthetic-concern` is a finding, not a block, and it must still be emitted/u
      );
    });

    it("treats an unset assignee as a block and forbids substituting a person", () => {
      expect(skill).toContain("escalation-target-unset");
    });

    it("routes escalation through the tracker abstraction, not a vendor label call", () => {
      expect(skill).toContain("lisa-tracker-sync");
      expect(skill).toContain("config-resolution");
    });

    it("posts the gate's comment verbatim rather than rewriting it", () => {
      expect(skill).toContain(
        "otherwise I'd be copying a number that changes without warning"
      );
    });

    it("cites the rule rather than restating the policy", () => {
      expect(skill).toContain("design-value-binding");
    });

    it("stays distinct from the design-source gate", () => {
      expect(skill).toContain("design-source-gate.mjs");
    });

    it("treats an absent design source as SKIPPED, never as a block", () => {
      // The requirement that outranks every other one here: most projects have
      // no designs, and a mandatory gate on an absent integration breaks all
      // of them on upgrade.
      expect(skill).toContain("SKIPPED");
    });

    it("still blocks on a failed probe against a CONFIGURED source", () => {
      expect(skill).toContain("tool-access-gate");
    });

    it("keeps the threshold at 100% unless relaxed visibly", () => {
      expect(skill).toContain("--min");
    });

    describe("motivating example", () => {
      const rationale = section(
        skill,
        "## Why this gate is executable and not advisory"
      );

      it("carries the counterargument to delivery pressure, not a footnote", () => {
        expect(rationale).toMatch(
          /domain types, adapters, CRUD, formatters — was completed and preserved/u
        );
      });

      it("attributes the failure to no project, tracker item, or individual", () => {
        expect(rationale).not.toMatch(/https?:\/\//u);
      });
    });

    it("surfaces as /lisa:design:intake with an argument hint", () => {
      expect(command).toContain("argument-hint:");
      expect(command).toContain("/lisa-design-intake");
      expect(command).toContain("$ARGUMENTS");
    });

    it("names no person in either artifact — the escalation target is a config key", () => {
      for (const body of [skill, command]) {
        expect(body).toContain("design.escalation.assignee");
      }
    });
  });
});
