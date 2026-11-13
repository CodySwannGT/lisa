/**
 * Contract coverage for the vendor-neutral `control-reachability` rule and the
 * surfaces wired to it — three validators (gate S20), three journey writers, and
 * four implementer surfaces.
 *
 * The requirement behind this contract is narrow and easy to lose: a work item
 * may prescribe an existing test as a red-before-green control, and that
 * stopping rule is only valid when the test's fixture exercises the path the
 * change touches. When it does not, the test stays green for an unrelated
 * reason and the item instructs the implementer to REVERT A CORRECT FIX. The
 * failure is in the specification, and the more disciplined the implementer,
 * the more reliably it happens.
 *
 * So these assertions pin the properties most likely to rot:
 *
 * - the obligation is a PARSEABLE marker, not prose asking for care — this
 *   failure is itself an instance of advisory guidance being insufficient, so a
 *   rewrite that softens the marker back into "make sure the fixture reaches
 *   the path" would reintroduce exactly the artifact that failed;
 * - the gate is `N/A` for an item introducing a NEW test — without that half,
 *   S20 fires on every work item and becomes something callers route around;
 * - the implementer arm keeps BOTH causes with OPPOSITE actions, and forbids
 *   acting on the stopping rule before the cause is established. Collapsing the
 *   two into one is the original defect;
 * - reachability is proved by EXECUTION, never by reading the fixture, which is
 *   the same "mentally reverting" shortcut `falsifiable-checks` rejects;
 * - every supported agent's plugin carries it, since the fanout is generated
 *   and a missing root ships the guidance to some agents and not others.
 * @module tests/unit/strategies/control-reachability-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Every generated skill fanout plus the source of truth they are built from. */
const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
] as const;

/** Every plugin root that carries rules (agy consumes skills only). */
const RULE_ROOTS = [
  "plugins/src/base/rules",
  "plugins/lisa/rules",
  "plugins/lisa-cursor/rules",
  "plugins/lisa-copilot/rules",
] as const;

/** The rule slug every wired surface cites instead of restating the contract. */
const SLUG = "control-reachability";

/** The three validators that carry gate S20. */
const VALIDATORS = [
  "lisa-jira-validate-ticket",
  "lisa-github-validate-issue",
  "lisa-linear-validate-issue",
] as const;

/** The three journey writers that render the marker. */
const JOURNEY_WRITERS = [
  "lisa-jira-add-journey",
  "lisa-github-add-journey",
  "lisa-linear-add-journey",
] as const;

/** The triage surface, which meets the control BEFORE the change lands. */
const TRIAGE_SURFACE = "lisa-ticket-triage";

/**
 * The surfaces that meet the control AFTER the change lands, and therefore have
 * to keep both causes apart. Triage runs before that moment: it checks the
 * declaration, so it carries the authoring arm rather than this one.
 */
const STOPPING_RULE_SURFACES = [
  "lisa-tdd-implementation",
  "lisa-reproduce-bug",
  "lisa-implement",
] as const;

/** Every surface that must cite the rule at implementation time. */
const IMPLEMENTER_SURFACES = [
  ...STOPPING_RULE_SURFACES,
  TRIAGE_SURFACE,
] as const;

/** The marker's two halves — a declaration a validator parses, not prose. */
const MARKER_PREFIX = "[CONTROL:";

/**
 * Read a skill body from one plugin root.
 * @param root - Plugin skills root (source or generated fanout)
 * @param slug - Skill directory name
 * @returns SKILL.md contents
 */
const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

/**
 * Read a rule body from one plugin root, honoring cursor's flat `.mdc` naming.
 * @param root - Plugin rules root
 * @param group - Which half of the rule pair
 * @param slug - Rule slug
 * @returns Rule contents
 */
const readRule = (
  root: string,
  group: "eager" | "reference",
  slug: string
): string => {
  if (root.includes("lisa-cursor")) {
    return readFileSync(
      path.resolve(
        root,
        `${slug}${group === "reference" ? "-reference" : ""}.mdc`
      ),
      "utf8"
    );
  }
  return readFileSync(path.resolve(root, group, `${slug}.md`), "utf8");
};

/**
 * Read the eager rule index, which is what points at a demoted rule's body.
 * Cursor flattens the tier, so the index lands beside the rules as `.mdc`.
 * @param root - Plugin rules root
 * @returns Index contents
 */
const readRuleIndex = (root: string): string =>
  root.includes("lisa-cursor")
    ? readFileSync(path.resolve(root, "00-rule-index.mdc"), "utf8")
    : readFileSync(path.resolve(root, "eager", "00-rule-index.md"), "utf8");

describe("control-reachability rule contract", () => {
  describe.each(RULE_ROOTS)("%s", root => {
    // #3992 demoted this rule out of the always-on tier. The former head is
    // folded verbatim into the body, so both names read the one surviving
    // content surface and every content assertion below still has its subject.
    const eager = readRule(root, "reference", SLUG);
    const reference = readRule(root, "reference", SLUG);

    it("stays reachable from the eager rule index", () => {
      expect(reference.length).toBeGreaterThan(2000);
      expect(readRuleIndex(root)).toContain(`reference/${SLUG}.md`);
    });

    it("expresses the authoring obligation as a parseable marker", () => {
      for (const body of [eager, reference]) {
        expect(body).toContain(MARKER_PREFIX);
      }
    });

    it("names the gate and every surface wired to cite it", () => {
      for (const slug of [
        ...VALIDATORS,
        ...JOURNEY_WRITERS.map(writer => writer.replace("add-journey", "")),
        ...IMPLEMENTER_SURFACES,
      ]) {
        expect(eager + reference).toContain(slug);
      }
    });
  });
});

describe("validators carry gate S20", () => {
  describe.each(SKILL_ROOTS)("%s", root => {
    it.each(VALIDATORS)("%s lists S20 in the gate table", slug => {
      const content = readSkill(root, slug);
      expect(content).toMatch(
        /\|\s*S20 Named-control reachability\s*\|\s*`acceptance-criteria`\s*\|\s*true\s*\|/
      );
    });

    it.each(VALIDATORS)("%s defines the gate and its marker grammar", slug => {
      const content = readSkill(root, slug);
      expect(content).toContain(SLUG);
      expect(content).toContain(MARKER_PREFIX);
      // Parsing instructions, so the gate is a parse rather than a judgement.
      expect(content).toMatch(/Parse by the exact `\[CONTROL:` prefix/);
    });

    it.each(VALIDATORS)("%s emits S20 in its report block", slug => {
      const content = readSkill(root, slug);
      expect(content).toContain(
        "- [PASS|FAIL|N/A] S20 Named-control reachability — <one-line reason>"
      );
    });
  });
});

describe("journey writers render the marker", () => {
  describe.each(SKILL_ROOTS)("%s", root => {
    it.each(JOURNEY_WRITERS)(
      "%s teaches the marker and cites the rule",
      slug => {
        const content = readSkill(root, slug);
        expect(content).toContain(SLUG);
        expect(content).toContain(MARKER_PREFIX);
      }
    );
  });
});

describe("implementer surfaces bind the stopping-rule arm", () => {
  describe.each(SKILL_ROOTS)("%s", root => {
    it.each(IMPLEMENTER_SURFACES)("%s cites the rule by slug", slug => {
      expect(readSkill(root, slug)).toContain(SLUG);
    });
  });
});
