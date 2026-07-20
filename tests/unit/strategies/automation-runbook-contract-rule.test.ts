/**
 * Contract coverage for the vendor-neutral automation-runbook-contract rule.
 *
 * The eager head + reference body are the executable contract every registered
 * automation loop conforms to. These assertions pin the closed six-value run
 * outcome vocabulary, the breadcrumb that the cursor generator rewrites, the
 * run-outcome vs work-item-lifecycle disambiguation (conflating them would make
 * healthy intake cycles report `recovery-required`), the ten runbook template
 * sections, the no-silent-exit discipline, and the registration-not-existence
 * membership test.
 * @module tests/unit/strategies/automation-runbook-contract-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const RUN_OUTCOMES = [
  "nothing-needed",
  "candidate-proposed",
  "change-proved",
  "approval-requested",
  "recovery-required",
  "policy-obsolete",
] as const;

const TEMPLATE_SECTIONS = [
  "Intent",
  "Sources of truth",
  "Candidate selection",
  "Scope/bounds",
  "Proof",
  "Autonomous-vs-approval boundary",
  "Escalation",
  "Recovery",
  "Next-run state",
  "Retirement condition",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("automation-runbook-contract rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/eager/automation-runbook-contract.md");
    const reference = read(
      root,
      "rules/reference/automation-runbook-contract.md"
    );

    it("ships as a paired rule with a non-trivial body on both sides", () => {
      expect(eager.length).toBeGreaterThan(500);
      expect(reference.length).toBeGreaterThan(2000);
    });

    it("eager head breadcrumbs to the reference body verbatim", () => {
      expect(eager).toContain(
        "Full contract (template, outcome definitions, escalation packet, retirement): [reference/automation-runbook-contract.md](../reference/automation-runbook-contract.md)."
      );
    });

    it("defines the closed six-value run outcome vocabulary in both halves", () => {
      for (const doc of [eager, reference]) {
        for (const outcome of RUN_OUTCOMES) {
          expect(doc).toContain(outcome);
        }
        expect(doc).toMatch(/exactly one/i);
      }
    });

    it("documents nothing-needed as healthy and needing no operator action", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/`nothing-needed`[^\n]*[Hh]ealthy/);
      }
      expect(reference).toMatch(/no operator action/i);
    });

    it("disambiguates a run outcome from a work-item lifecycle terminal state", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/terminal state/i);
        expect(doc).toMatch(/run outcome[^.]*loop iteration/i);
        expect(doc).toMatch(/never `?recovery-required`?/i);
      }
      expect(reference).toContain("Blocked");
    });

    it("carries one runbook template section per contracted field", () => {
      for (const section of TEMPLATE_SECTIONS) {
        expect(reference).toContain(section);
      }
    });

    it("fills every template section for the intake-tickets worked example", () => {
      expect(reference).toContain("intake-tickets");
      const fence = /```text\n([\s\S]*?)```/.exec(reference)?.[1] ?? "";
      expect(fence).toContain("intake-tickets");
      for (const section of TEMPLATE_SECTIONS) {
        expect(fence).toContain(section);
      }
    });

    it("forbids a silent exit", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain("there is no silent exit");
        expect(doc).toMatch(/one-line[^.]*summary/i);
      }
    });

    it("prescribes a decision-ready escalation packet", () => {
      expect(reference).toMatch(/current state/i);
      expect(reference).toMatch(/already attempted|work attempted/i);
      expect(reference).toMatch(/evidence/i);
      expect(reference).toMatch(/risk of inaction/i);
      expect(reference).toMatch(/smallest unresolved choice/i);
      expect(reference).toContain("status:blocked");
      expect(reference).toContain("human-needed");
      expect(reference).toContain("factory-model");
    });

    it("keeps retirement stateless, tracker-derived, and never self-executed", () => {
      expect(reference).toMatch(/stateless/i);
      expect(reference).toMatch(/never.*(counter|state file)/i);
      expect(reference).toMatch(/quiet/i);
      expect(reference).toMatch(/marker-dedup/i);
      expect(reference).toMatch(/never a self-executed exit/i);
    });

    it("tests membership by registration, not skill existence", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/registration, not skill.existence/i);
      }
    });

    it("cites sibling rules by bare slug rather than restating them", () => {
      for (const slug of [
        "factory-model",
        "rejection-detection",
        "tracked-work",
        "integration-access-layer",
      ]) {
        expect(reference).toContain(slug);
      }
      expect(reference).not.toContain("rules/reference/factory-model.md");
    });

    it("hedges artifacts that ship with sibling tickets", () => {
      expect(reference).toMatch(
        /ships with that ticket, do not\s+assume its file is present/i
      );
    });

    it("names the loop-facing consumers of the contract", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain("lisa-setup-automations");
        expect(doc).toContain("lisa-automation-status");
        expect(doc).toContain("lisa-tear-down-automations");
      }
    });
  });
});
