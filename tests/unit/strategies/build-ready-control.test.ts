/**
 * Regression tests for the `build_ready` write-control input and the
 * exploratory-qa lifecycle-feeding behavior.
 *
 * Approach B (chosen over a contained per-skill hack): the three vendor write
 * skills (`jira-write-ticket`, `github-write-issue`, `linear-write-issue`) gain
 * an optional `build_ready` write-control input that decides whether a *leaf*
 * work unit is stamped with the build-ready role on create. It never overrides
 * `leaf-only-lifecycle` — a container is never build-ready regardless. "Not
 * build-ready" is not a new status; it is simply the natural default (no
 * `status:ready` label for GitHub/Linear; the project's default status for
 * JIRA), which a human can promote later.
 *
 * `exploratory-qa` (shipped in the expo / rails / harper-fabric stacks) stops
 * writing a report file and instead files every finding as a tracked work item
 * via `lisa:tracker-write`. It is a pure first-time-user experience pass: a
 * `ready` flag controls the build-ready state of bug and usability-suggestion
 * tickets (default: backlog/triage). Automated-coverage gaps are NOT its job —
 * they are delegated to the sibling `e2e-coverage-gaps` skill, which inventories
 * routes + the Playwright suite and files build-ready missing-test tickets.
 *
 * Both the source (`plugins/src/...`) and the generated artifact
 * (`plugins/lisa*`) are asserted, so an artifact-only edit or a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/build-ready-control
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Source + generated roots for the base-plugin write skills. */
const WRITE_ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

/** The vocabulary-control rule every build-ready path is subordinate to. */
const RULE_SLUG = "leaf-only-lifecycle";

/** Heading that anchors the build_ready write-control section in each write skill. */
const BUILD_READY_HEADING = "Build-ready control input";

/**
 * Read a skill's SKILL.md from a given root.
 * @param root plugin skills root directory
 * @param skill skill directory name
 * @returns the SKILL.md file contents
 */
const readSkill = (root: string, skill: string): string =>
  readFileSync(path.resolve(root, skill, "SKILL.md"), "utf8");

describe("build_ready write-control input", () => {
  const WRITE_SKILLS = [
    "github-write-issue",
    "linear-write-issue",
    "jira-write-ticket",
  ] as const;

  describe.each(WRITE_SKILLS)("%s", skill => {
    describe.each(WRITE_ROOTS)("%s", root => {
      const content = readSkill(root, skill);

      it("documents a Build-ready control input section", () => {
        expect(content).toContain(BUILD_READY_HEADING);
        expect(content).toContain("build_ready");
      });

      it("describes both the false (backlog) and true (auto-pickup) modes", () => {
        expect(content).toContain("build_ready: false");
        expect(content).toContain("build_ready: true");
      });

      it("keeps build_ready subordinate to leaf-only-lifecycle", () => {
        const idx = content.indexOf(BUILD_READY_HEADING);
        expect(idx).toBeGreaterThan(-1);
        const section = content.slice(idx);
        // A container is never build-ready regardless of build_ready.
        expect(section).toMatch(/container is never/i);
        expect(content).toContain(RULE_SLUG);
      });

      it("treats omitted as backward-compatible current behavior", () => {
        const idx = content.indexOf(BUILD_READY_HEADING);
        const section = content.slice(idx);
        expect(section).toMatch(/omitted/i);
        expect(section).toMatch(/current behavior/i);
      });
    });
  });

  // Label-based trackers omit the ready label for build_ready: false.
  describe.each(["github-write-issue", "linear-write-issue"] as const)(
    "%s omits the status:ready label for a build_ready:false leaf",
    skill => {
      describe.each(WRITE_ROOTS)("%s", root => {
        const content = readSkill(root, skill);
        it("describes creating the leaf without status:ready", () => {
          const idx = content.indexOf(BUILD_READY_HEADING);
          const section = content.slice(idx);
          expect(section).toMatch(/without.*status:ready/i);
        });
      });
    }
  );

  // JIRA is status-based: build_ready: true must transition to the ready status,
  // since jira-write-ticket leaves a fresh ticket in the project default.
  describe.each(WRITE_ROOTS)(
    "jira-write-ticket build_ready:true (%s)",
    root => {
      const content = readSkill(root, "jira-write-ticket");

      it("transitions a leaf to the configured ready status on build_ready:true", () => {
        expect(content).toMatch(
          /transition the \*\*leaf\*\* to the resolved `ready`/
        );
        expect(content).toContain(".jira.workflow.ready");
      });

      it("is best-effort: leaves the ticket in default status if unreachable", () => {
        expect(content).toMatch(
          /do not fail the write|leave the ticket in its default status/i
        );
      });
    }
  );
});

describe("exploratory-qa feeds the lifecycle (no report file)", () => {
  /** Source + generated root pairs for each stack that ships exploratory-qa. */
  const QA_ROOTS = [
    "plugins/src/expo/skills",
    "plugins/src/rails/skills",
    "plugins/src/harper-fabric/skills",
    "plugins/lisa-expo/skills",
    "plugins/lisa-rails/skills",
    "plugins/lisa-harper-fabric/skills",
  ] as const;

  describe.each(QA_ROOTS)("%s/exploratory-qa", root => {
    const content = readSkill(root, "exploratory-qa");

    it("files findings via the vendor-neutral lisa:tracker-write", () => {
      expect(content).toContain("lisa:tracker-write");
    });

    it("does not write a report file", () => {
      expect(content).toMatch(
        /does \*\*not\*\* write a report file|No report file/
      );
      // The old report-file deliverables must be gone.
      expect(content).not.toContain("EXPLORATORY_QA_REPORT");
      expect(content).not.toContain("PLAYWRIGHT_GAPS");
    });

    it("exposes a ready flag defaulting to backlog/triage", () => {
      expect(content).toContain("ready=true|false");
      expect(content).toMatch(/default/i);
      expect(content).toMatch(/triage|backlog/i);
    });

    it("maps the ready flag to build_ready for bugs and suggestions", () => {
      expect(content).toContain("build_ready");
      expect(content).toMatch(/Bug/);
      expect(content).toMatch(/Improvement/);
    });

    it("delegates automated-coverage gaps to the e2e-coverage-gaps skill", () => {
      // The Playwright-coverage concern moved out of exploratory-qa.
      expect(content).toContain("e2e-coverage-gaps");
      // The old report-file deliverable for gaps must be gone.
      expect(content).not.toMatch(/Missing Playwright test/);
    });

    it("is idempotent via a stable lisa-exploratory-qa marker", () => {
      expect(content).toContain("[lisa-exploratory-qa]");
      expect(content).toMatch(/never by title|match by the marker/i);
    });
  });
});

describe("e2e-coverage-gaps files missing-test gaps as build-ready work", () => {
  /** Source + generated root pairs for each stack that ships e2e-coverage-gaps. */
  const GAP_ROOTS = [
    "plugins/src/expo/skills",
    "plugins/src/rails/skills",
    "plugins/src/harper-fabric/skills",
    "plugins/lisa-expo/skills",
    "plugins/lisa-rails/skills",
    "plugins/lisa-harper-fabric/skills",
  ] as const;

  describe.each(GAP_ROOTS)("%s/e2e-coverage-gaps", root => {
    const content = readSkill(root, "e2e-coverage-gaps");

    it("files findings via the vendor-neutral lisa:tracker-write", () => {
      expect(content).toContain("lisa:tracker-write");
    });

    it("files missing-test tickets build-ready by default", () => {
      expect(content).toContain("build_ready");
      expect(content).toMatch(/missing-test/i);
      expect(content).toMatch(/build-ready/i);
      // ready flag defaults to true (coverage is safe to queue).
      expect(content).toContain("ready=true|false");
      expect(content).toMatch(/default.*`true`/i);
    });

    it("delegates human usability findings back to exploratory-qa", () => {
      expect(content).toContain("exploratory-qa");
    });

    it("is idempotent via a stable lisa-e2e-coverage-gaps marker", () => {
      expect(content).toContain("[lisa-e2e-coverage-gaps]");
      expect(content).toMatch(/never by title|match by the marker/i);
    });
  });
});
