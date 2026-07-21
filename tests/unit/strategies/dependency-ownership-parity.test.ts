/**
 * Six-agent parity and operator-documentation contract for the
 * dependency-ownership layer (#1891 §4 and §5, closing PRD #1741).
 *
 * Two acceptance criteria are asserted here:
 *
 *   1. Every supported agent surface carries the same dependency-ownership
 *      rules, skills, and docs — and every representation difference is
 *      DOCUMENTED. Lisa's parity posture is that a written-down gap is not a
 *      violation; a silent one is.
 *   2. An operator opening the docs can find the decision records, the trust
 *      classes, the duplicate-pin policy, and the internalization confidence
 *      kit — and can decide whether a proposed change is acceptable.
 *
 * The journey assertions live in the sibling
 * `dependency-ownership-integration.test.ts`.
 *
 * @module tests/unit/strategies/dependency-ownership-parity
 */
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DUPLICATE_CHECK,
  FIELD_LABELS,
  KIT_CRITERIA,
  MANIFEST,
  OPERATOR_DOC,
  RECORD_PATH,
  RULES,
  RULE_TITLES,
  flat,
  read,
} from "./dependency-ownership-helpers";

/**
 * Agent surfaces carrying a full nested `rules/eager` + `rules/reference` tree.
 * `plugins/lisa` is the Claude reference mirror, which Claude Code, Codex, and
 * OpenCode all read through `inject-rules.sh`; `plugins/lisa-copilot` is
 * Copilot's generated mirror.
 */
const NESTED_RULE_ROOTS = ["plugins/lisa", "plugins/lisa-copilot"] as const;

/** Every agent surface that ships the planning skill the rules wire into. */
const SKILL_ROOTS = [
  "plugins/src/base",
  "plugins/lisa",
  "plugins/lisa/.codex-plugin",
  "plugins/lisa-cursor",
  "plugins/lisa-agy",
  "plugins/lisa-copilot",
] as const;

/** The decomposition steps DEP-2 and DEP-5 added, which must fan out intact. */
const PLANNING_STEPS = [
  "### 4.5. Classify Any New Material Dependency",
  "### 4.6. Inherit the Confidence-Rebuild Kit When Ownership Moves In-House",
] as const;

describe("six-agent parity for the dependency-ownership layer", () => {
  it.each(NESTED_RULE_ROOTS)(
    "mirrors all three rule pairs byte-faithfully into %s",
    root => {
      for (const rule of RULES) {
        for (const tier of ["eager", "reference"] as const) {
          const relative = `rules/${tier}/${rule}.md`;

          expect(read(path.join(root, relative))).toBe(
            read(path.join("plugins/src/base", relative))
          );
        }
      }
    }
  );

  it("flattens all three rule pairs into Cursor's native .mdc rules", () => {
    for (const rule of RULES) {
      const title = RULE_TITLES[rule];
      const eager = read(`plugins/lisa-cursor/rules/${rule}.mdc`);
      const reference = read(`plugins/lisa-cursor/rules/${rule}-reference.mdc`);

      // Flattening rewrites frontmatter and link targets, so the body — not the
      // bytes — is what has to survive. The rewritten breadcrumb is the
      // load-bearing part: an eager head that lost its pointer to the reference
      // body is a dead end for the agent reading it.
      expect(eager).toContain("alwaysApply: true");
      expect(eager).toContain(`# ${title} (load-bearing)`);
      expect(eager).toContain(`${rule}-reference.mdc`);
      expect(reference).toContain("alwaysApply: false");
      expect(reference).toContain(`# ${title}\n`);
      expect(reference).toContain("## Agent parity");
    }
  });

  it("documents Antigravity's absent rules tree as a representation gap, not a silent drop", () => {
    // Antigravity ships no `rules/` tree by design — see
    // scripts/generate-agy-plugin-artifacts.mjs, which filters `rules/` out of
    // the variant. It reaches the same content through the shared mirror, and it
    // carries the planning skill (asserted below) unchanged.
    expect(() =>
      read("plugins/lisa-agy/rules/eager/dependency-trust-classes.md")
    ).toThrow();
    expect(
      flat(
        read(
          "plugins/src/base/rules/reference/dependency-internalization-kit.md"
        )
      )
    ).toContain(
      "Antigravity has no separate rules tree of its own and inherits the same content through the shared mirror"
    );
    // The same gap has to be legible to a non-technical operator, not only to a
    // reader of the rule source.
    expect(flat(read(OPERATOR_DOC))).toContain(
      "Antigravity ships no separate rules directory of its own"
    );
  });

  it.each(SKILL_ROOTS)("ships the same planning wire to %s", root => {
    const skill = read(
      path.join(root, "skills/lisa-task-decomposition/SKILL.md")
    );

    for (const step of PLANNING_STEPS) {
      expect(skill).toContain(step);
    }
  });

  it("states the uniform enforcement gap on all three reference bodies", () => {
    // The gap is the same on every runtime: nothing blocks a build for a missing
    // record, a missing class, or a missing kit. Saying so on each rule is what
    // keeps "not enforced" from reading as "not required".
    for (const rule of RULES) {
      expect(read(`plugins/src/base/rules/reference/${rule}.md`)).toContain(
        "## Agent parity"
      );
    }
  });
});

describe("the operator walkthrough reaches all five surfaces", () => {
  const doc = read(OPERATOR_DOC);

  it("is a wiki playbook, indexed and logged", () => {
    expect(doc).toContain("# Dependency Ownership — Operator Guide");
    expect(read("wiki/index.md")).toContain(
      "playbooks/dependency-ownership-operator-guide.md"
    );
    expect(read("wiki/log.md")).toContain(
      "dependency-ownership-operator-guide.md"
    );
  });

  it.each([
    ["DEP-1 the decision records", RECORD_PATH],
    ["DEP-2 the trust classes", "dependency-trust-classes"],
    ["DEP-3 the duplicate-pin policy", DUPLICATE_CHECK],
    ["DEP-4 Lisa's own seeded records and their gap ticket", "#1918"],
    ["DEP-5 the confidence-rebuild kit", "dependency-internalization-kit"],
  ])("points the operator at %s", (_label, marker) => {
    expect(doc).toContain(marker);
  });

  it("answers the question the operator actually has at the gate", () => {
    expect(doc).toContain(
      "## Deciding whether a dependency change is acceptable"
    );
    expect(doc).toContain("### It is a dependency ADDITION");
    expect(doc).toContain("### It is a dependency INTERNALIZATION");
    expect(doc).toContain("### It is an ordinary version bump");
    // Every branch must say what REJECTION looks like, or the guide only teaches
    // an operator to say yes.
    expect(doc.split("Send it back when").length - 1).toBe(3);
  });

  it("says the duplicate-version check is advisory today, not a blocking gate", () => {
    // Promoting it to blocking needs the threshold ratchet. An operator told it
    // blocks would misread a green build as proof that no pin was duplicated.
    expect(doc).toContain("advisory");
    expect(flat(doc)).toContain(
      "a clean run is not proof that no pin was duplicated"
    );
  });

  it("names the same duplicate-version invocation the project actually ships", () => {
    expect(doc).toContain("bun run check:duplicate-versions");
    expect(read(MANIFEST)).toContain('"check:duplicate-versions"');
  });

  it("re-states the shared vocabulary rather than inventing its own", () => {
    for (const criterion of KIT_CRITERIA) {
      expect(doc).toContain(criterion);
    }
    for (const label of FIELD_LABELS) {
      expect(doc).toContain(label.replaceAll("*", "").replace(":", ""));
    }
  });

  it("names both worked journeys so an operator can see a real example", () => {
    expect(doc).toContain("tests/fixtures/dependency-ownership/addition");
    expect(doc).toContain(
      "tests/fixtures/dependency-ownership/internalization"
    );
  });
});
