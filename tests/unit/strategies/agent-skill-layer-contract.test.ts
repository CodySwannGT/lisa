/**
 * Contract coverage for the four-layer split: command -> skill -> routing rule
 * -> agent -> skill.
 *
 * The architecture is sound and, until now, entirely unenforced — which is how
 * seven agents drifted to between 73% and 92% verbatim duplication of the very
 * skills they declare, with up to nineteen byte-identical rule bullets each
 * (#2093, #2096). Nothing detected it because nothing looked. A layer boundary
 * that only prose defends is followed almost always, and almost always means
 * broken constantly once enough people edit.
 *
 * So this suite pins the three invariants that make the layers real:
 *
 * 1. An agent does not restate the skills it declares. The skill owns the
 *    procedure, the output format and the rules; the agent owns identity,
 *    judgement and handoff. Both load into one context when the agent declares
 *    the skill in frontmatter, so a duplicated contract is read twice and the
 *    two copies drift silently.
 * 2. Every agent the routing rule composes actually exists. `intent-routing`
 *    is the single place flow composition lives, it is prose, and a mistyped
 *    agent name there fails at runtime rather than at build.
 * 3. Every skill a skill invokes actually exists. Skill-to-skill edges are
 *    undeclared — there is no frontmatter equivalent of an agent's `skills:` —
 *    so a renamed or deleted skill leaves a dangling invocation.
 *
 * Plus one honesty check: `tools:` is enforced only on Claude, and the doctrine
 * has to keep saying so, because a field that looks like a sandbox and is not
 * one is worse than no field at all.
 *
 * There is no exemption list, because no agent needs one. The single
 * intentional duplication in the tree — the `Security (proven)` /
 * `Security (unproven)` bucket headings that `security-specialist` and
 * `lisa-security-review` must both render so they cannot drift — is pinned by
 * `security-two-bucket-contract.test.ts` and never reaches this check, since
 * headings are excluded below. Should a future contract genuinely require a
 * shared sentence, add the allowlist together with the test that pins it, so the
 * exemption and its justification cannot be separated.
 *
 * Scoped to `plugins/src`, which is the source of truth. The generated per-agent
 * copies are verified against it by `bun run check:plugins`, so asserting them
 * here would duplicate that gate rather than add coverage.
 * @module tests/unit/strategies/agent-skill-layer-contract
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.resolve("plugins/src");
const ROUTING = path.join(SRC, "base/rules/reference/intent-routing.md");

/**
 * Template placeholders that look like skill references but name nothing.
 * `lisa-my-skill` is the worked example inside the skill-creator guidance.
 */
const PLACEHOLDER_SKILLS = new Set(["lisa-my-skill"]);

/**
 * Every stack directory under `plugins/src` that can carry agents or skills.
 * @returns Directory names such as `base`, `expo`, `phaser`.
 */
const stacks = (): readonly string[] =>
  readdirSync(SRC, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

/**
 * Absolute paths of every agent definition in the source tree.
 * @returns One path per `plugins/src/<stack>/agents/*.md`.
 */
const agentFiles = (): readonly string[] =>
  stacks().flatMap(stack => {
    const dir = path.join(SRC, stack, "agents");
    return existsSync(dir)
      ? readdirSync(dir)
          .filter(f => f.endsWith(".md"))
          .map(f => path.join(dir, f))
      : [];
  });

/**
 * Every skill directory name in the source tree, prefixed or not.
 * @returns Directory names such as `lisa-reproduce-bug` and `ops-run-local`.
 */
const skillNames = (): ReadonlySet<string> => {
  const found = new Set<string>();
  for (const stack of stacks()) {
    const dir = path.join(SRC, stack, "skills");
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (existsSync(path.join(dir, entry, "SKILL.md"))) found.add(entry);
    }
  }
  return found;
};

/**
 * Absolute paths of every `SKILL.md` in the source tree.
 * @returns One path per skill directory that actually carries a `SKILL.md`.
 */
const skillFiles = (): readonly string[] =>
  stacks().flatMap(stack => {
    const dir = path.join(SRC, stack, "skills");
    return existsSync(dir)
      ? readdirSync(dir)
          .map(entry => path.join(dir, entry, "SKILL.md"))
          .filter(existsSync)
      : [];
  });

/**
 * Strips YAML frontmatter so only the rendered body is compared.
 * @param text The full file contents.
 * @returns The body with any leading frontmatter block removed.
 */
const body = (text: string): string => text.replace(/^---[\s\S]*?^---/mu, "");

/**
 * The lines a duplication check should judge: substantive prose and rule
 * bullets, normalized for whitespace.
 *
 * Markdown headings are excluded. A shared `### 1. Confirm Quality Gates` is a
 * structural coincidence between an agent and its skill, not a restated rule,
 * and counting it would force an exemption that teaches nothing.
 * @param text The full file contents.
 * @returns Normalized prose and bullet lines of at least 25 characters.
 */
const substantiveLines = (text: string): readonly string[] =>
  body(text)
    .split("\n")
    .map(line => line.replace(/\s+/gu, " ").trim())
    .filter(line => line.length >= 25 && !line.startsWith("#"));

/**
 * The skills an agent declares in its frontmatter, unprefixed.
 * @param text The full agent file contents.
 * @returns Declared skill names, empty when the agent declares none.
 */
const declaredSkills = (text: string): readonly string[] => {
  const front = /^---([\s\S]*?)^---/mu.exec(text);
  if (front === null) return [];
  const block = /^skills:\s*\n((?:[ \t]*-[ \t]*\S.*\n)+)/mu.exec(
    front[1] ?? ""
  );
  if (block === null) return [];
  return (block[1] ?? "")
    .trim()
    .split("\n")
    .map(line => line.replace(/^[ \t]*-[ \t]*/u, "").trim())
    .filter(name => name.length > 0);
};

/**
 * Resolves a declared skill name to its `SKILL.md`, or null when absent.
 *
 * Two naming conventions coexist and both are legitimate: base skills carry the
 * `lisa-` prefix (`reproduce-bug` -> `lisa-reproduce-bug`) while stack skills
 * frequently do not (`ops-run-local`, `phaser-i18n`). A resolver that knew only
 * the prefixed form silently resolved nothing for every stack agent, which is
 * how the sweep that found #2096 reported zero overlap for expo, rails and all
 * of phaser: it compared each against an empty pool. Try both forms, and let
 * the "declares only skills that exist" assertion catch a genuinely absent one.
 * @param name The unprefixed skill name from an agent's frontmatter.
 * @returns Absolute path to the resolved `SKILL.md`, or null when absent.
 */
const resolveSkill = (name: string): string | null => {
  for (const stack of stacks()) {
    for (const dir of [`lisa-${name}`, name]) {
      const candidate = path.join(SRC, stack, "skills", dir, "SKILL.md");
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
};

/**
 * Skill names a skill's prose actually invokes, as opposed to merely mentions.
 *
 * The looser shape — any `/lisa-*` token — matches paths, config keys and script
 * names (`.lisa-config`, `lisa-github-repo-setup.sh`), so it reported fourteen
 * phantom references on its first run. Requiring the word "skill" adjacent to
 * the name keeps only genuine invocations.
 * @param text The full `SKILL.md` contents.
 * @returns Invoked skill names, excluding documented template placeholders.
 */
const invokedSkills = (text: string): readonly string[] => {
  const patterns = [
    /(?:invoke|use|call|run|via|through)\s+(?:the\s+)?`?\/?(lisa-[a-z0-9-]+)`?\s+skill/giu,
    /`?\/(lisa-[a-z0-9-]+)`?\s+skill\b/giu,
  ];
  return patterns
    .flatMap(pattern =>
      [...text.matchAll(pattern)].map(match => match[1] ?? "")
    )
    .filter(name => name.length > 0 && !PLACEHOLDER_SKILLS.has(name));
};

describe("agent/skill layer contract", () => {
  describe("an agent does not restate the skills it declares", () => {
    const agents = agentFiles().filter(
      file => declaredSkills(readFileSync(file, "utf8")).length > 0
    );

    it("finds agents that declare skills, so the check is not vacuous", () => {
      expect(agents.length).toBeGreaterThan(10);
    });

    it.each(agents.map(file => [path.basename(file), file] as const))(
      "%s shares no substantive line with its declared skills",
      (_name, file) => {
        const text = readFileSync(file, "utf8");
        const pool = new Set(
          declaredSkills(text).flatMap(skill => {
            const resolved = resolveSkill(skill);
            return resolved === null
              ? []
              : [...substantiveLines(readFileSync(resolved, "utf8"))];
          })
        );
        const shared = substantiveLines(text).filter(line => pool.has(line));
        expect(shared).toEqual([]);
      }
    );

    it.each(agents.map(file => [path.basename(file), file] as const))(
      "%s declares only skills that exist",
      (_name, file) => {
        const declared = declaredSkills(readFileSync(file, "utf8"));
        const unresolved = declared.filter(
          skill => resolveSkill(skill) === null
        );
        expect(unresolved).toEqual([]);
      }
    );
  });

  describe("the routing rule composes agents that exist", () => {
    const known = new Set(agentFiles().map(file => path.basename(file, ".md")));
    const referenced = [
      ...new Set(
        [
          ...readFileSync(ROUTING, "utf8").matchAll(
            /`([a-z][a-z0-9-]*(?:-specialist|-agent|-fixer|-analyzer|-judge|-synthesizer|-evaluator|builder|learner))`/gu
          ),
        ].map(match => match[1] ?? "")
      ),
    ].filter(name => name.length > 0);

    it("names agents in the routing rule, so the check is not vacuous", () => {
      expect(referenced.length).toBeGreaterThan(10);
    });

    it("resolves every agent the routing rule names", () => {
      expect(referenced.filter(name => !known.has(name))).toEqual([]);
    });
  });

  describe("a skill only invokes skills that exist", () => {
    const known = skillNames();
    const found = new Map(
      skillFiles().flatMap(file =>
        invokedSkills(readFileSync(file, "utf8")).map(
          name => [name, path.basename(path.dirname(file))] as const
        )
      )
    );

    it("finds skill-to-skill invocations, so the check is not vacuous", () => {
      expect(found.size).toBeGreaterThan(5);
    });

    it("resolves every skill a skill invokes", () => {
      const dangling = [...found.entries()]
        .filter(([name]) => !known.has(name))
        .map(([name, from]) => `${name} (from ${from})`);
      expect(dangling).toEqual([]);
    });
  });

  describe("`tools:` is documented as advisory rather than enforced", () => {
    const doctrine = readFileSync(
      path.join(SRC, "base/skills/lisa-agent-design-best-practices/SKILL.md"),
      "utf8"
    );

    it("says only Claude enforces the field", () => {
      expect(doctrine).toMatch(/only claude enforces `tools:`/iu);
    });

    it("forbids treating it as a containment control", () => {
      expect(doctrine).toMatch(/not a security boundary/iu);
      expect(doctrine).toMatch(/compromised or prompt-injected/iu);
    });

    it("names where the real controls live", () => {
      for (const control of [/sandbox/iu, /egress/iu, /credential scope/iu]) {
        expect(doctrine).toMatch(control);
      }
    });

    it("keeps the Codex transformer emitting the compatibility note", () => {
      const transformer = readFileSync(
        path.resolve("src/codex/agent-transformer.ts"),
        "utf8"
      );
      expect(transformer).toContain("Claude allowed tools:");
      expect(transformer).toContain("Claude Agent Compatibility");
    });
  });
});
