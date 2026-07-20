/**
 * Contract coverage for the vendor-neutral rejection-detection rule.
 *
 * The eager head + reference body are the executable contract for backward-
 * transition detection at claim time. These assertions pin the classification
 * vocabulary, the config-driven (never hardcoded) lane names, the vendor
 * history bindings, the never-block-the-build degrade, and the no-learning-loops
 * exclusion — and confirm all three build-intake arms cite the ONE shared slug
 * rather than reimplementing detection.
 * @module tests/unit/strategies/rejection-detection-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const BUILD_INTAKES = [
  "lisa-jira-build-intake",
  "lisa-github-build-intake",
  "lisa-linear-build-intake",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("rejection-detection rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/eager/rejection-detection.md");
    const reference = read(root, "rules/reference/rejection-detection.md");

    it("eager head breadcrumbs to the reference body", () => {
      expect(eager).toContain(
        "[reference/rejection-detection.md](../reference/rejection-detection.md)"
      );
    });

    it("defines the four-way classification vocabulary", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain("rejection-reclaim");
        expect(doc).toContain("forward-only");
        expect(doc).toContain("never-left-ready");
        expect(doc).toContain("unknown");
      }
    });

    it("runs at claim time before the relabel", () => {
      expect(eager).toMatch(/before the relabel/i);
      expect(reference).toMatch(/top of `?3b`?/i);
    });

    it("binds all three vendor history sources through the access layers", () => {
      expect(reference).toContain("lisa-github-read-issue");
      expect(reference).toContain("changelog key:<K>");
      expect(reference).toContain("history id:<ID>");
      expect(reference).toMatch(/LabeledEvent/);
    });

    it("sources lane names from config, never hardcoded", () => {
      expect(reference).toContain("github.labels.build");
      expect(reference).toMatch(/never hardcode/i);
      expect(reference).toContain("BUILD_LABEL_DEFAULTS");
    });

    it("never blocks the build (unknown is first-class)", () => {
      expect(reference).toMatch(/never block the build/i);
      expect(reference).toMatch(/unknown.*first-class|first-class result/i);
    });

    it("suppresses the learning-loop trigger at the source", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain("[lisa-learning-drop]");
        expect(doc).toContain("[lisa-learning-pr]");
        expect(doc).toContain("[lisa-learning-upstream-handoff]");
        expect(doc).toContain("learning:needs-triage");
      }
    });

    it("every build-intake arm cites the one shared slug at claim time", () => {
      for (const skill of BUILD_INTAKES) {
        const doc = read(root, `skills/${skill}/SKILL.md`);
        expect(doc).toContain("rejection-detection");
        expect(doc).toMatch(/before the (relabel|transition)/i);
      }
    });

    it("routes a candidate learning with provenance into the judgment gate", () => {
      expect(reference).toContain("lisa-persist-learning");
      expect(reference).toContain("provenance");
      expect(reference).toContain("fingerprint");
      expect(reference).toContain("triggering_issue");
      expect(reference).toMatch(/sll4-/);
    });

    it("dedupes candidates by issue + backward-transition timestamp", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain("[lisa-rejection-candidate]");
        expect(doc).toMatch(/key=<issue>-<transition-ts>/);
      }
      expect(reference).toMatch(
        /no.*duplicate candidate|not.*produce a duplicate/i
      );
    });

    it("degrades gracefully when lisa-persist-learning is absent", () => {
      expect(reference).toMatch(/unavailable|not installed|absent/i);
      expect(reference).toMatch(
        /no candidate produced and the item still implemented/i
      );
    });

    it("fallback candidate comment is visible prose, not a bare marker", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain(
          "Recorded a candidate learning from this rejection"
        );
        expect(doc).toMatch(/empty comment bubble|empty bubble/i);
      }
      for (const skill of BUILD_INTAKES) {
        const doc = read(root, `skills/${skill}/SKILL.md`);
        expect(doc).toContain(
          "Recorded a candidate learning from this rejection"
        );
      }
    });

    it("build-intake arms carry the reflection routing on rejection-reclaim", () => {
      for (const skill of BUILD_INTAKES) {
        const doc = read(root, `skills/${skill}/SKILL.md`);
        expect(doc).toContain("lisa-persist-learning");
        expect(doc).toContain("[lisa-rejection-candidate]");
        expect(doc).toMatch(/reflect before re-implementing/i);
      }
    });

    it("hands the rejection evidence into the implementation plan", () => {
      expect(reference).toMatch(/Evidence handoff into implementation/i);
      expect(reference).toMatch(/MUST NOT re-propose/i);
      expect(reference).toMatch(
        /lisa-implement never sees the claim|never sees the claim/i
      );
      for (const skill of BUILD_INTAKES) {
        const doc = read(root, `skills/${skill}/SKILL.md`);
        expect(doc).toMatch(/rejection evidence summary/i);
      }
    });

    it("lisa-implement consumes rejection evidence in its plan phase", () => {
      const impl = read(root, "skills/lisa-implement/SKILL.md");
      expect(impl).toContain("rejection-detection");
      expect(impl).toMatch(/rejection evidence summary/i);
      expect(impl).toMatch(/MUST NOT re-propose/i);
      expect(impl).toMatch(/never blocks/i);
    });

    describe("Proposal rejection memory (proposal-side, orthogonal to the reclaim path)", () => {
      it("names the section in both halves", () => {
        for (const doc of [eager, reference]) {
          expect(doc).toContain("Proposal rejection memory");
        }
      });

      it("keeps the claim-time rejection-reclaim path untouched (orthogonality)", () => {
        for (const doc of [eager, reference]) {
          expect(doc).toContain("rejection-reclaim");
          expect(doc).toMatch(/untouched|unchanged/i);
        }
      });

      it("treats closed-as-not-planned as a durable decline that suppresses", () => {
        for (const doc of [eager, reference]) {
          expect(doc).toMatch(/not[_ ]planned/i);
          expect(doc).toContain('stateReason == "not_planned"');
          expect(doc).toMatch(/suppress/i);
        }
      });

      it("warns the GitHub stateReason compare is case-insensitive (raw gh is UPPERCASE)", () => {
        for (const doc of [eager, reference]) {
          expect(doc).toMatch(/case-insensitive/i);
          expect(doc).toContain("NOT_PLANNED");
        }
      });

      it("resolves the JIRA/Linear not-planned equivalent from config, never hardcoded", () => {
        for (const doc of [eager, reference]) {
          expect(doc).toContain("config-resolution");
          expect(doc).toMatch(/never (a )?hardcode/i);
        }
      });

      it("searches open AND closed items with a body-enumeration fallback, matching on the marker", () => {
        for (const doc of [eager, reference]) {
          expect(doc).toContain("open AND closed");
          expect(doc).toMatch(/body-enumeration fallback/i);
          expect(doc).toMatch(/match on the marker, never the title/i);
        }
      });

      it("uses the gardener's deterministic shasum-256 key formula", () => {
        for (const doc of [eager, reference]) {
          expect(doc).toContain("shasum -a 256 | cut -c1-12");
        }
      });

      it("re-files only with evidence postdating the decline, citing decline+recurrence", () => {
        for (const doc of [eager, reference]) {
          expect(doc).toMatch(/postdat/i);
          expect(doc).toContain("declined");
          expect(doc).toContain("recurred");
        }
      });

      it("requires a human acknowledgment sentence on a re-file, alongside the machine token", () => {
        for (const doc of [eager, reference]) {
          expect(doc).toContain("You declined this on");
          expect(doc).toContain(
            "so we're raising it once more for your review"
          );
        }
      });

      it("mandates the operator close-reason footer on every filed proposal", () => {
        for (const doc of [eager, reference]) {
          expect(doc).toContain(
            "To stop this from being raised again, close it as **Not planned**"
          );
          expect(doc).toMatch(/Close it as \*\*Completed\*\* if it was fixed/);
        }
      });

      it("pins an operator-readable recovery-required exemplar for an unreadable check", () => {
        for (const doc of [eager, reference]) {
          expect(doc).toContain(
            "restore credentials; nothing was filed this run"
          );
        }
      });

      it("treats closed-as-completed as a regression, not a decline", () => {
        for (const doc of [eager, reference]) {
          expect(doc).toMatch(/is NOT a decline/i);
          expect(doc).toMatch(/regression/i);
        }
      });

      it("an all-suppressed cycle ends nothing-needed naming the suppression count", () => {
        for (const doc of [eager, reference]) {
          expect(doc).toContain("nothing-needed");
          expect(doc).toMatch(/suppression count/i);
        }
      });

      it("an unreadable memory check ends recovery-required, never a silent nothing-needed", () => {
        for (const doc of [eager, reference]) {
          expect(doc).toContain("recovery-required");
          expect(doc).toMatch(/silent .?nothing-needed/i);
        }
      });

      it("states convergence-not-mutual-exclusion concurrency honesty (no cross-run lock)", () => {
        for (const doc of [eager, reference]) {
          expect(doc).toMatch(/convergence, not mutual exclusion/i);
        }
      });

      it("names every proposing loop that consults the shared contract", () => {
        for (const doc of [eager, reference]) {
          for (const loop of [
            "lisa-exploratory-qa",
            "lisa-project-ideation",
            "lisa-monitor",
            "lisa-repair-intake",
          ]) {
            expect(doc).toContain(loop);
          }
          expect(doc).toContain("lisa-learnings-audit");
        }
      });
    });
  });
});
