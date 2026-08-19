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
      expect(skill).toMatch(/Do not reimplement the decision in prose/iu);
    });

    it("resolves the regime per axis, never by asking a human", () => {
      expect(skill).toMatch(/\*\*Never ask a human\.\*\*/u);
      for (const axis of [
        "color",
        "spacing",
        "typography",
        "radius",
        "elevation",
        "motion",
      ]) {
        expect(skill).toContain(axis);
      }
    });

    it("records that listing the published collections is not headlessly possible", () => {
      // Losing this invites a rewrite to the "obvious" implementation, which
      // runs interactively and silently no-ops in cron and CI.
      expect(skill).toMatch(/Do not try to list the published collections/u);
      expect(skill).toMatch(/Enterprise-plan only/u);
      expect(skill).toMatch(/browser OAuth/u);
      expect(skill).toContain("/v1/files/:key/nodes");
    });

    it("derives the regime from the committed variable-id map", () => {
      expect(skill).toMatch(/committed variable-id map/u);
      expect(skill).toContain("design-variable-ids.mjs");
      expect(skill).toContain("design-bindings-probe.mjs");
    });

    it("probes the implemented subtree rather than the enclosing screen", () => {
      expect(skill).toMatch(
        /Probe the subtree you are implementing, not the enclosing screen/u
      );
      expect(skill).toMatch(/14 bound values at frame level/u);
    });

    it("carries both silent under-reporting traps so a rewrite cannot lose them", () => {
      expect(skill).toContain("rectangleCornerRadii");
      expect(skill).toMatch(/omits zero-valued properties/u);
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
      expect(skill).toMatch(/Do not guess a person/u);
      expect(skill).toMatch(/Do not substitute a person/u);
    });

    it("routes escalation through the tracker abstraction, not a vendor label call", () => {
      expect(skill).toContain("lisa-tracker-sync");
      expect(skill).toMatch(/Never call a vendor label API directly/u);
      expect(skill).toContain("config-resolution");
    });

    it("posts the gate's comment verbatim rather than rewriting it", () => {
      expect(skill).toMatch(/Use `result\.comment` \*\*verbatim\*\*/u);
      expect(skill).toContain(
        "otherwise I'd be copying a number that changes without warning"
      );
    });

    it("never picks a side in a source disagreement", () => {
      expect(skill).toMatch(/Never pick a side in a disagreement/u);
    });

    it("records derived values instead of merely consuming them", () => {
      expect(skill).toContain("result.derived");
      expect(skill).toContain("ranked by what people actually needed");
    });

    it("cites the rule rather than restating the policy", () => {
      expect(skill).toContain("design-value-binding");
      expect(skill).toMatch(/do not re-derive its conditions here/iu);
    });

    it("stays distinct from the design-source gate", () => {
      expect(skill).toContain("design-source-gate.mjs");
      expect(skill).toMatch(/orthogonal question/u);
    });

    it("treats an absent design source as SKIPPED, never as a block", () => {
      // The requirement that outranks every other one here: most projects have
      // no designs, and a mandatory gate on an absent integration breaks all
      // of them on upgrade.
      expect(skill).toContain("SKIPPED");
      expect(skill).toMatch(/A design source is optional/u);
      expect(skill).toMatch(/do not block/iu);
      expect(skill).toMatch(
        /breaks every project that has no designs|breaks every non-design project/u
      );
    });

    it("still blocks on a failed probe against a CONFIGURED source", () => {
      expect(skill).toContain("tool-access-gate");
      expect(skill).toMatch(
        /a failed probe \*\*against a configured source\*\* is a block, not a reason to fall back to reading pixels/u
      );
    });

    it("routes a stale or ambiguous map to us, never to a designer", () => {
      expect(skill).toMatch(/\*\*Route by owner\.\*\*/u);
      expect(skill).toMatch(/Neither is the designer's fault/u);
      expect(skill).toMatch(/wrong person and the wrong work/u);
    });

    it("keeps the threshold at 100% unless relaxed visibly", () => {
      expect(skill).toContain("100%");
      expect(skill).toContain("--min");
    });

    it("surfaces as /lisa:design:intake with an argument hint", () => {
      expect(command).toContain("argument-hint:");
      expect(command).toContain("/lisa-design-intake");
      expect(command).toContain("$ARGUMENTS");
    });

    it("names no person in either artifact — the escalation target is a config key", () => {
      for (const body of [skill, command]) {
        expect(body).toContain("design.escalation.assignee");
        expect(body).not.toMatch(/@[a-z0-9][a-z0-9-]{2,}\b/iu);
        expect(body).not.toMatch(/assignee\s*[:=]\s*["'][a-z][^"']*["']/iu);
      }
    });
  });
});
