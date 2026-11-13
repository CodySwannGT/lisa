/**
 * Prose contract for the Verify sequence, which is written down in THREE
 * places and had silently diverged in all three.
 *
 * `intent-routing`'s Verify section is canonical ("change it there, propagate
 * everywhere"), and both `lisa-verify` and `lisa-implement` say the rule owns
 * the sequence — then each restates it in its own words. Antigravity ships no
 * `rules/` tree (see `project-learnings`'s agy note), so the skills genuinely
 * MUST carry an executable sequence: collapsing them into pointers would strand
 * agy with no steps at all. Duplication is therefore load-bearing, which makes
 * an executable agreement check the only thing that can keep the copies honest.
 *
 * The four divergences this pins, each of which had already happened:
 *   1. `lisa-implement` never posted ticket evidence — the rule and
 *      `lisa-verify` both end with `lisa-tracker-evidence`, implement had no
 *      such step while its terminal step ASSUMED evidence "is recorded".
 *   2. The post-deploy check ran unnamed in implement, so the `--report-only`
 *      contract (monitor must not file tickets inside a Verify run) applied on
 *      one path and not the other.
 *   3. Three descriptions of one PR loop: implement delegated to
 *      `drive-pr-to-merge` (canonical, and the only one that checks the
 *      auto-merge race), `lisa-verify` called `pull-request-review` directly,
 *      and the rule hand-rolled the loop inline.
 *   4. The credential-exhaustion rule (block + `needs-human` rather than
 *      completing on artifact-only evidence) existed only in `lisa-verify`.
 *
 * Assertions cover the canonical source AND every checked-in runtime
 * projection from `bun run build:plugins`. Per-agent parity matches
 * debrief-reroute-contract: skills fan to all five runtimes plus the Codex
 * overlay; the reference rule ships to Claude/Codex-base, Cursor (flattened
 * `.mdc`), and Copilot — agy ships no `rules/` tree and the Codex overlay is
 * skills-only.
 * @module tests/unit/strategies/verify-flow-surface-parity
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const VERIFY_SKILL_PATHS = [
  "plugins/src/base/skills/lisa-verify/SKILL.md",
  "plugins/lisa/skills/lisa-verify/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-verify/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-verify/SKILL.md",
  "plugins/lisa-agy/skills/lisa-verify/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-verify/SKILL.md",
] as const;

const IMPLEMENT_SKILL_PATHS = [
  "plugins/src/base/skills/lisa-implement/SKILL.md",
  "plugins/lisa/skills/lisa-implement/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-implement/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-implement/SKILL.md",
  "plugins/lisa-agy/skills/lisa-implement/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-implement/SKILL.md",
] as const;

const INTENT_ROUTING_PATHS = [
  "plugins/src/base/rules/reference/intent-routing.md",
  "plugins/lisa/rules/reference/intent-routing.md",
  "plugins/lisa-cursor/rules/intent-routing-reference.mdc",
  "plugins/lisa-copilot/rules/reference/intent-routing.md",
] as const;

/** Every surface that carries an executable Verify sequence. */
const ALL_SEQUENCE_PATHS = [
  ...VERIFY_SKILL_PATHS,
  ...IMPLEMENT_SKILL_PATHS,
  ...INTENT_ROUTING_PATHS,
] as const;

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

/**
 * Slice the Verify sequence out of `intent-routing`, which documents every
 * flow in one file. Scoping matters: `drive-pr-to-merge` and `tracker-evidence`
 * are legitimately named by other flows, so a whole-file search would pass even
 * with the Verify sequence empty.
 * @param rule The full intent-routing Markdown text.
 * @returns The Verify section, from its heading to the next flow heading.
 */
const verifySection = (rule: string): string => {
  const start = rule.indexOf("### Verify");
  if (start < 0) throw new Error("Verify section not found");
  const rest = rule.slice(start + 1);
  const end = rest.indexOf("\n### ");
  return end < 0 ? rest : rest.slice(0, end);
};

/** Marks the multi-flow rule file, whose Verify steps must be scoped out. */
const RULE_FILE_MARKER = "intent-routing";

/**
 * Read a surface and narrow it to the text that must carry the Verify
 * sequence: the whole file for a skill, the Verify section alone for the rule.
 * @param surfacePath Repo-relative path to a canonical source or projection.
 * @returns The text the Verify-sequence assertions apply to.
 */
const sequenceText = (surfacePath: string): string => {
  const text = read(surfacePath);
  return surfacePath.includes(RULE_FILE_MARKER) ? verifySection(text) : text;
};

describe.each(ALL_SEQUENCE_PATHS)(
  "every Verify surface muzzles monitor post-deploy (%s)",
  surfacePath => {
    const scoped = sequenceText(surfacePath);

    it("runs the post-deploy health check through lisa-monitor", () => {
      expect(scoped).toMatch(/lisa-monitor/);
    });

    it("requires --report-only so monitor never files inside a Verify run", () => {
      expect(scoped).toMatch(/--report-only/);
    });
  }
);

describe.each([...VERIFY_SKILL_PATHS, ...IMPLEMENT_SKILL_PATHS])(
  "every shipping surface posts ticket evidence (%s)",
  skillPath => {
    const skill = read(skillPath);

    it("posts evidence through the vendor-neutral tracker surface", () => {
      expect(skill).toMatch(/lisa-tracker-evidence/);
    });

    it("carries the UI Evidence Checklist obligation for UI-visible work", () => {
      expect(skill).toMatch(/evidence\/comment\.md/);
    });
  }
);
