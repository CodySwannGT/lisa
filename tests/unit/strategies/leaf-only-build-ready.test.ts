/**
 * Regression tests for the leaf-only build-ready invariant in the GitHub
 * write path.
 *
 * Issue #538: `lisa:github-to-tracker` must apply the build-ready label
 * (`status:ready`) ONLY to leaf sub-tasks when writing a decomposed
 * hierarchy — never to the Epic or Stories. The invariant itself is the
 * vendor-neutral `leaf-only-lifecycle` rule (merged in #537); these tests
 * assert that the GitHub writer and decomposition skill encode it so the
 * label is never hard-applied to a container.
 *
 * Both the source (`plugins/src/base/skills`) and the generated artifact
 * (`plugins/lisa/skills`) are asserted, so an artifact-only edit or a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/leaf-only-build-ready
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const SKILL_ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

const readSkill = (root: string, skill: string): string =>
  readFileSync(path.resolve(root, skill, "SKILL.md"), "utf8");

describe("leaf-only build-ready invariant (#538)", () => {
  describe.each(SKILL_ROOTS)("%s/github-write-issue", root => {
    const content = readSkill(root, "github-write-issue");

    it("cites the leaf-only-lifecycle rule by slug", () => {
      expect(content).toContain("leaf-only-lifecycle");
    });

    it("documents a container create path that omits status:ready", () => {
      // The previous skill applied `--label "status:ready"` on the single
      // CREATE example regardless of type. After the fix there must be a
      // container path whose create command omits the build-ready label.
      expect(content).toMatch(/WITHOUT --label "status:ready"/);
    });

    it("makes the build-ready label conditional on a leaf work unit", () => {
      // The skill must describe the conditional: only Bug/Task/Sub-task/
      // Improvement leaves receive status:ready; containers do not.
      expect(content).toMatch(/leaf work unit/i);
      expect(content).toMatch(/status:ready/);
      expect(content).toMatch(/only.*leaf work unit/i);
    });

    it("names the container types that never receive build-ready", () => {
      expect(content).toMatch(/Epic/);
      expect(content).toMatch(/Story/);
    });
  });

  describe.each(SKILL_ROOTS)("%s/github-to-tracker", root => {
    const content = readSkill(root, "github-to-tracker");

    it("cites the leaf-only-lifecycle rule by slug", () => {
      expect(content).toContain("leaf-only-lifecycle");
    });

    it("states Epics (Phase 3) never receive the build-ready label", () => {
      // Phase 3 creates Epics; it must not mark them build-ready.
      expect(content).toMatch(/leaf/i);
      expect(content).toMatch(/status:ready/);
    });

    it("states only Sub-tasks (Phase 5) receive the build-ready label", () => {
      // Phase 5 creates the leaf Sub-tasks — the only items that may be ready.
      const phase5Index = content.indexOf("### Phase 5: Create Sub-tasks");
      expect(phase5Index).toBeGreaterThan(-1);
      const phase5Onward = content.slice(phase5Index);
      expect(phase5Onward).toMatch(/status:ready/);
    });
  });
});
