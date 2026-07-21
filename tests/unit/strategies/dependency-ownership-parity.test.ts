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
  HOST_DETECTOR_INVOCATION,
  HOST_RULES_DIR,
  KIT_CRITERIA,
  MANIFEST,
  OPERATOR_DOC,
  POINTER_HEADING,
  RECORD_PATH,
  RULES,
  RULE_TITLES,
  SCAFFOLD,
  TRUST_CLASSES,
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

  it("does not send a host operator after a command only Lisa has", () => {
    // `bun run check:duplicate-versions` exists in Lisa's own package.json and
    // nowhere else. Telling a host operator to run it would be an instruction
    // that fails on first use, so the guide has to say whose command it is and
    // give the host the invocation that actually works.
    expect(doc).toContain("bun run check:duplicate-versions");
    expect(read(MANIFEST)).toContain('"check:duplicate-versions"');
    expect(doc).toContain(
      "**That command exists only in Lisa's own project.**"
    );
    expect(doc).toContain(HOST_DETECTOR_INVOCATION);
  });

  it("tells the operator which surfaces reach a host project and which do not", () => {
    expect(doc).toContain("### What actually reaches a host project");
    expect(doc).toContain("`wiki/` is not published");
  });

  it("re-states the shared vocabulary rather than inventing its own", () => {
    for (const criterion of KIT_CRITERIA) {
      expect(doc).toContain(criterion);
    }
    for (const label of FIELD_LABELS) {
      expect(doc).toContain(label.replaceAll("*", "").replace(":", ""));
    }
  });

  it("shows each worked example inline rather than only citing a fixture path", () => {
    // A non-technical operator will not go read a test fixture. Each decision
    // branch has to carry enough of the example to be judged on the page.
    expect(doc.split("What a good one looks like").length - 1).toBe(3);
    expect(doc).toContain("> **Trust class:** runtime-critical service client");
    expect(doc).toContain(
      "> ### slugify (retired — capability moved in-house 2026-07-21)"
    );
    expect(doc).toContain("> **Move:** none. Version bump only.");
  });

  it("glosses the jargon an outcomes-focused reader would not know", () => {
    expect(flat(doc)).toContain(
      "the standing rule that quality gates may only ever get stricter"
    );
    expect(doc).toContain(
      "the generated\n  file recording exact installed versions"
    );
    expect(flat(doc)).toContain(
      "a **fork** (we copied their code and now maintain our own version of it)"
    );
  });

  it("says where a rejection is written and who signs off", () => {
    // "Send it back" with no addressee is not an instruction.
    expect(doc).toContain("**How to reject.**");
    expect(flat(doc)).toContain(
      "Write the rejection as a comment on the work item itself"
    );
    expect(flat(doc)).toContain(
      "the person who signs off is the named accountable owner in the record's *owner / review cadence* field"
    );
  });
});

describe("the shipped host scaffold reaches all five surfaces on its own", () => {
  // AC scenario 2 names "a host project using Lisa's updated templates". A host
  // operator never sees wiki/, plugins/src/, or tests/fixtures/ — the only file
  // they are guaranteed to open is the create-only record scaffold. So the
  // scaffold, not the wiki guide, has to be the self-contained entry point.
  const scaffold = read(SCAFFOLD);

  it("carries a pointer section, placed before the appendable Records section", () => {
    const headings: readonly string[] = scaffold.match(/^## .+$/gmu) ?? [];

    expect(headings).toContain(POINTER_HEADING);
    expect(headings[headings.length - 1]).toBe("## Records");
    expect(scaffold.indexOf(POINTER_HEADING)).toBeLessThan(
      scaffold.indexOf("\n## Records")
    );
  });

  it("names all six trust classes without making the operator leave the file", () => {
    const lowered = flat(scaffold).toLowerCase();

    for (const trustClass of TRUST_CLASSES) {
      expect(lowered).toContain(trustClass);
    }
    expect(scaffold).toContain(`${HOST_RULES_DIR}/dependency-trust-classes.md`);
  });

  it("names all seven confidence-rebuild criteria and where the full rule lives", () => {
    const lowered = flat(scaffold).toLowerCase();

    for (const criterion of KIT_CRITERIA) {
      expect(lowered).toContain(criterion.toLowerCase());
    }
    expect(scaffold).toContain(
      `${HOST_RULES_DIR}/dependency-internalization-kit.md`
    );
  });

  it("gives the host-runnable duplicate-pin invocation and is honest that it is not a gate", () => {
    expect(scaffold).toContain(HOST_DETECTOR_INVOCATION);
    expect(flat(scaffold)).toContain(
      "It is not wired into this project's `package.json` scripts and it does not fail a build"
    );
    expect(flat(scaffold)).toContain(
      "a clean run is not proof that no pin was duplicated"
    );
  });

  it("points at Lisa's own worked example and at the full operator guide", () => {
    // Deliberately no Lisa issue number here: a ticket in someone else's tracker
    // is not actionable for a host operator, so the scaffold points at the
    // artifact and the guide carries the gap ticket.
    expect(scaffold).toContain(OPERATOR_DOC);
    // Both are Lisa-side, so the scaffold must say so rather than implying the
    // operator can open them from their own checkout.
    expect(flat(scaffold)).toContain("it lives in the Lisa project at");
  });

  it("repeats the honest non-enforcement statement the guide makes", () => {
    expect(flat(scaffold)).toContain(
      "Nothing above is enforced by a build gate."
    );
  });
});
