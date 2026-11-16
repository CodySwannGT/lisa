/**
 * Reachability contract for stack Validation Journey guidance (#4911).
 *
 * The Expo and Rails plugins ship Jira-only overlays (`jira-journey`,
 * `jira-evidence`, ...), but the vendor-neutral dispatchers route to the base
 * `lisa-{jira,github,linear}-*` skills, so a GitHub or Linear project on those
 * stacks never reached the stack guidance at all. The fix is a tracker-neutral
 * `journey-guidance` skill per stack that the dispatchers consult.
 *
 * Pinned here are the structural edges only — which skills exist and which
 * skills reference which — never the guidance wording (#4867):
 *
 * 1. Every stack that ships a Jira journey overlay also ships the
 *    tracker-neutral `journey-guidance` skill, in source and in every generated
 *    projection of that stack's plugin.
 * 2. Each vendor-neutral journey/evidence dispatcher names that skill, so the
 *    edge from dispatcher to stack guidance cannot be silently dropped.
 * 3. The vendor-neutral verification agents preload the vendor-neutral tracker
 *    skills rather than a Jira-specific one.
 * @module tests/unit/strategies/tracker-neutral-stack-journey
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.resolve("plugins/src");
const PLUGINS = path.resolve("plugins");
const GUIDANCE = "journey-guidance";

/**
 * Stacks under `plugins/src` whose skills include a Jira journey overlay.
 * @returns Stack directory names such as `expo` and `rails`.
 */
const stacksWithJiraOverlay = (): readonly string[] =>
  readdirSync(SRC, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== "base")
    .map(entry => entry.name)
    .filter(stack =>
      existsSync(path.join(SRC, stack, "skills", "jira-journey", "SKILL.md"))
    );

/**
 * Generated plugin directories for one stack that carry a `skills/` tree.
 * @param stack The stack directory name, for example `expo`.
 * @returns Absolute skill-root paths, one per generated projection.
 */
const generatedSkillRoots = (stack: string): readonly string[] =>
  readdirSync(PLUGINS, { withFileTypes: true })
    .filter(
      entry =>
        entry.isDirectory() &&
        (entry.name === `lisa-${stack}` ||
          entry.name.startsWith(`lisa-${stack}-`))
    )
    .map(entry => path.join(PLUGINS, entry.name, "skills"))
    .filter(existsSync);

const DISPATCHERS = [
  "lisa-tracker-journey",
  "lisa-tracker-add-journey",
  "lisa-tracker-create",
  "lisa-tracker-evidence",
] as const;

describe("stack journey guidance is reachable from every tracker", () => {
  const stacks = stacksWithJiraOverlay();

  it("finds the stacks that carry a Jira journey overlay", () => {
    expect(stacks.length).toBeGreaterThan(0);
  });

  describe.each(stacks)("%s", stack => {
    it("ships a tracker-neutral journey-guidance skill in source", () => {
      expect(
        existsSync(path.join(SRC, stack, "skills", GUIDANCE, "SKILL.md"))
      ).toBe(true);
    });

    it("projects journey-guidance into every generated plugin", () => {
      const roots = generatedSkillRoots(stack);

      expect(roots.length).toBeGreaterThan(0);
      for (const root of roots) {
        expect(existsSync(path.join(root, GUIDANCE, "SKILL.md")), root).toBe(
          true
        );
      }
    });
  });

  it.each(DISPATCHERS)("%s consults journey-guidance", dispatcher => {
    const text = readFileSync(
      path.join(SRC, "base", "skills", dispatcher, "SKILL.md"),
      "utf8"
    );

    expect(text).toContain(`\`${GUIDANCE}\``);
  });
});

describe("vendor-neutral verification agents preload tracker skills", () => {
  it.each([
    ["verification-specialist", "tracker-journey"],
    ["spec-conformance-specialist", "tracker-read"],
  ])("%s declares %s and no jira-* skill", (agent, expected) => {
    const text = readFileSync(
      path.join(SRC, "base", "agents", `${agent}.md`),
      "utf8"
    );
    const front = /^---([\s\S]*?)^---/mu.exec(text)?.[1] ?? "";
    const skills = [...front.matchAll(/^[ \t]*-[ \t]*(\S+)\s*$/gmu)].map(
      match => match[1]
    );

    expect(skills).toContain(expected);
    expect(skills.filter(name => name?.startsWith("jira-"))).toEqual([]);
  });
});
