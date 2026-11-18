/**
 * The audit's failure message must name the `lisa-security-audit-handling`
 * skill (#4521), so an agent that hits a failing audit is pointed at the
 * ladder that teaches the scoped exclusion shape. Checked in the distributed
 * script and the repository's own copy.
 *
 * The ladder's order is pinned too (CodySwannGT/lisa#5024). `LADDER` below is
 * the order, and every surface that teaches it — the audit's failure message,
 * the skill, and its rule pointer, in every shipped copy — must list the
 * lettered rungs in that order: the reachability exclusion before any code
 * change, and our own fork, patch or vendored copy last and only through a
 * declared human gate the classifier accepts. Reordering the ladder means
 * editing this list on purpose.
 * @module tests/unit/strategies/security-audit-handling-scope
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { classifyHumanGateReason } from "../../../plugins/src/base/scripts/human-gate-act.mjs";

/** The remediation ladder, in the order an agent works it. */
const LADDER = [
  { rung: "a", id: "upgrade" },
  { rung: "b", id: "exclude-unreachable" },
  { rung: "c", id: "replace-or-remove" },
  { rung: "d", id: "fix-upstream" },
  { rung: "e", id: "own-copy" },
] as const;

/** The last rung: our own copy, behind the human gate. */
const OWN_COPY = { rung: "e", id: "own-copy" } as const;

const SCRIPTS = [
  "all/copy-overwrite/scripts/lisa-audit.mjs",
  "scripts/lisa-audit.mjs",
];

/** Every shipped copy of the skill, source first. */
const SKILLS = [
  "plugins/src/base/skills/lisa-security-audit-handling/SKILL.md",
  "plugins/lisa/skills/lisa-security-audit-handling/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-security-audit-handling/SKILL.md",
  "plugins/lisa-agy/skills/lisa-security-audit-handling/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-security-audit-handling/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-security-audit-handling/SKILL.md",
  "plugins/lisa-devin/skills/lisa-security-audit-handling/SKILL.md",
];

/** Every shipped copy of the always-reachable rule pointer, source first. */
const RULES = [
  "plugins/src/base/rules/reference/security-audit-handling.md",
  "plugins/lisa/rules/reference/security-audit-handling.md",
  "plugins/lisa-copilot/rules/reference/security-audit-handling.md",
  "plugins/lisa-cursor/rules/security-audit-handling-reference.mdc",
  "plugins/lisa-devin/rules/reference/security-audit-handling.md",
];

/** Every shipped copy of the internalization kit, source first. */
const KITS = [
  "plugins/src/base/rules/reference/dependency-internalization-kit.md",
  "plugins/lisa/rules/reference/dependency-internalization-kit.md",
  "plugins/lisa-copilot/rules/reference/dependency-internalization-kit.md",
  "plugins/lisa-cursor/rules/dependency-internalization-kit-reference.mdc",
  "plugins/lisa-devin/rules/reference/dependency-internalization-kit.md",
];

/**
 * Assert each label appears, and in ladder order.
 * @param text - The surface under test
 * @param label - How the surface writes one rung
 */
function expectInOrder(
  text: string,
  label: (step: (typeof LADDER)[number]) => string
): void {
  const found = LADDER.map(step => ({
    id: step.id,
    offset: text.indexOf(label(step)),
  }));
  const offsets = found.map(step => step.offset);
  expect(
    found.filter(step => step.offset < 0).map(step => step.id),
    "rungs missing"
  ).toEqual([]);
  expect(
    [...offsets].sort((a, b) => a - b),
    "rungs out of order"
  ).toEqual(offsets);
}

/**
 * The audit's printed next step, read from the script source.
 * @param script - Repository-relative script path
 * @returns The `Next step:` line
 */
function nextStep(script: string): string {
  const text = readFileSync(script, "utf8");
  const start = text.indexOf("Next step:");
  return start < 0 ? "" : text.slice(start, text.indexOf("\n", start));
}

describe("security-audit-handling is named by the audit", () => {
  it.each(SCRIPTS)("%s names the skill in its next step", script => {
    expect(nextStep(script)).toContain("lisa-security-audit-handling");
  });
});

describe("the remediation ladder order (CodySwannGT/lisa#5024)", () => {
  it("ends at the gated own-copy rung", () => {
    expect(LADDER.at(-1)).toEqual(OWN_COPY);
  });

  it.each(SCRIPTS)("%s prints every rung in ladder order", script => {
    expectInOrder(nextStep(script), ({ rung }) => `(${rung}) `);
  });

  it.each([...SKILLS, ...RULES])(
    "%s lists every rung in ladder order",
    file => {
      expectInOrder(
        readFileSync(file, "utf8"),
        ({ rung, id }) => `(${rung}) \`${id}\``
      );
    }
  );

  it.each(SKILLS)(
    "%s gates the own-copy rung on a filable human gate",
    file => {
      const text = readFileSync(file, "utf8");
      const rung = text.slice(
        text.indexOf(`(${OWN_COPY.rung}) \`${OWN_COPY.id}\``)
      );
      const reason = rung.split('human_gate: "')[1]?.split('"')[0];
      expect(reason, "own-copy rung declares a human_gate reason").toContain(
        "<pkg>"
      );
      const verdict = classifyHumanGateReason(
        reason?.replaceAll("<pkg>", "picomatch")
      );
      expect(verdict.valid).toBe(true);
      expect(verdict.act).toBe("own-dependency-copy");
    }
  );

  it.each(KITS)(
    "%s routes a fork or vendored copy through the one ladder",
    file => {
      const text = readFileSync(file, "utf8");
      expect(text).toContain(`\`${OWN_COPY.id}\``);
      expect(text).toContain("lisa-security-audit-handling");
    }
  );
});
