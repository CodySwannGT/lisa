/**
 * Contract coverage for setup-automations' repository-readiness advisory
 * (RRR-7, #1859).
 *
 * The setup skill consumes the persisted RRR-3 report; it never reimplements
 * readiness or turns the warn-only claim gate into a setup precondition. The
 * skill and wiki prose describing that advisory is not pinned (#4867). What
 * stays is six-agent delivery parity: the rubric rules ship identical in every
 * root that has a rules tree, stay reachable from each eager index, and every
 * runtime's delivery path is exercised or guarded as source.
 * @module tests/unit/strategies/setup-automations-readiness-warning
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import {
  installHooks,
  installHookCompatibility,
} from "../../../src/codex/hooks-installer.js";
import { retireProjectHooks } from "../../../src/codex/project-hooks-cleanup.js";
import { installCodexEnforcementFallback } from "../../../src/codex/enforcement-fallback-installer.js";
import { parseHooksFile } from "../../../src/codex/hooks-merger.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

/**
 * RRR-7's second obligation: the readiness rubric RRR-1..RRR-6 built must reach
 * every coding agent identically, not just Claude. RRR-4 (the agent-ready skill)
 * and RRR-3 (the doctor readiness surface) already carry their own six-root
 * parity pins; the rubric rule pairs the vocabulary distinguishes were the one
 * fanned surface with no cross-root backstop. This block is that backstop,
 * reusing the BCE-7 parity-pin pattern: every rule ships body-identical in the
 * roots that can represent a rules tree, and the roots that structurally cannot
 * are asserted as documented gaps, never silent drops.
 */
const SRC = "plugins/src/base";
const CLAUDE_ROOT = "plugins/lisa";
const CURSOR_ROOT = "plugins/lisa-cursor";
const AGY_ROOT = "plugins/lisa-agy";
const COPILOT_ROOT = "plugins/lisa-copilot";

const read = (rel: string): string => readFileSync(path.resolve(rel), "utf8");

/**
 * Strip a leading YAML frontmatter block so per-agent frontmatter transforms do
 * not read as body drift.
 * @param text - Raw file contents
 * @returns Body with any frontmatter removed
 */
const body = (text: string): string => {
  if (!text.startsWith("---\n")) return text.trim();
  const end = text.indexOf("\n---", 3);
  return end === -1 ? text.trim() : text.slice(end + 4).trim();
};

/**
 * Empty every markdown link target so Cursor's flattened `.mdc` link rewrites do
 * not read as prose drift — the words must still match.
 * @param text - Raw file contents
 * @returns Body with every markdown link target emptied
 */
const proseOnly = (text: string): string =>
  body(text).replace(/\]\([^)]*\)/g, "]()");

/** The rule pairs the readiness vocabulary distinguishes, both fanned surfaces. */
const RRR_RULE_SLUGS = ["readiness-rubric", "convergent-review"] as const;
// #3992 demoted both of these rules, folding each head into its body, so the
// parity backstop sweeps the one tier that carries them. The index that
// replaced their heads is asserted separately below.
const RULE_TIERS = ["reference"] as const;

describe("RRR rubric six-agent parity backstop (#1859)", () => {
  describe.each(RRR_RULE_SLUGS)("rule pair %s", slug => {
    describe.each(RULE_TIERS)("%s tier", tier => {
      const rel = `rules/${tier}/${slug}.md`;
      const source = read(`${SRC}/${rel}`);

      it("ships byte-identical in the Claude and Copilot roots", () => {
        expect(existsSync(path.resolve(CLAUDE_ROOT, rel))).toBe(true);
        expect(read(`${CLAUDE_ROOT}/${rel}`)).toBe(source);
        expect(read(`${COPILOT_ROOT}/${rel}`)).toBe(source);
      });

      it("ships in the Cursor root as an .mdc rule with the same body", () => {
        const cursorName =
          tier === "reference" ? `${slug}-reference.mdc` : `${slug}.mdc`;
        const cursor = read(`${CURSOR_ROOT}/rules/${cursorName}`);
        expect(proseOnly(cursor)).toBe(proseOnly(source));
      });
    });

    it("stays reachable from the eager index on every agent root", () => {
      // Without this, the tier sweep above would pass on a body that nothing
      // points at — the exact failure the pairing gate exists to prevent.
      const indexRel = "rules/eager/00-rule-index.md";
      for (const root of [SRC, CLAUDE_ROOT, COPILOT_ROOT]) {
        expect(read(`${root}/${indexRel}`)).toContain(`reference/${slug}.md`);
      }
      expect(read(`${CURSOR_ROOT}/rules/00-rule-index.mdc`)).toContain(
        `${slug}-reference.mdc`
      );
      // Nothing recreates the retired always-on head.
      expect(
        existsSync(path.resolve(CLAUDE_ROOT, `rules/eager/${slug}.md`))
      ).toBe(false);
    });
  });

  describe("runtime delivery is positive and representation gaps are explicit", () => {
    it("agy carries no rules tree, so the rubric cannot be a silent drop", () => {
      expect(existsSync(path.resolve(AGY_ROOT, "rules"))).toBe(false);
      const generator = read("scripts/generate-agy-plugin-artifacts.mjs");
      expect(generator).toMatch(/no full rules tree in agy artifacts/i);
    });

    it("Codex keeps loaded eager injection functional while fresh hooks use the fallback", async () => {
      const host = await createTempDir();
      try {
        const installed = await installHooks(process.cwd(), host, []);
        const previous = parseHooksFile(
          readFileSync(path.join(host, ".codex/hooks.json"), "utf8")
        );
        expect(
          previous.hooks?.SessionStart?.flatMap(group => group.hooks).some(
            hook => hook._lisaId === "inject-rules"
          )
        ).toBe(true);
        await installHookCompatibility(
          process.cwd(),
          host,
          [],
          installed.managedFiles
        );
        await retireProjectHooks(host, installed.managedFiles);
        await installCodexEnforcementFallback(host);
        const current = parseHooksFile(
          readFileSync(path.join(host, ".codex/hooks.json"), "utf8")
        );
        expect(Object.keys(current.hooks ?? {})).toEqual(["PreToolUse"]);
        expect(
          current.hooks?.PreToolUse?.flatMap(group => group.hooks).map(
            hook => hook._lisaId
          )
        ).toEqual(["enforcement-fallback"]);
        const injected = boundedSpawnSync({
          command: "/bin/bash",
          args: [path.join(host, ".codex/hooks/lisa/inject-rules.sh")],
          cwd: host,
          input: "{}",
          label: "Codex readiness eager rules injection",
        });
        expect(injected.status).toBe(0);
        const context: string = JSON.parse(injected.stdout).hookSpecificOutput
          .additionalContext;
        expect(context).toContain(
          read("plugins/lisa/rules/eager/00-rule-index.md").trim()
        );
      } finally {
        await cleanupTempDir(host);
      }
    });

    it("OpenCode mirrors the shared rules and loads the eager tier natively", () => {
      const installer = read("src/opencode/hooks-installer.ts");
      expect(installer).toContain("mirrorLisaRules");
      expect(installer).toContain("OPENCODE_LISA_RULES_SUBDIR");
      expect(installer).toContain("OPENCODE_EAGER_RULES_INSTRUCTION");
    });

    it("the shared mirror preserves eager and reference rule tiers", () => {
      const mirror = read("src/core/lisa-rules-mirror.ts");
      expect(mirror).toContain(
        'const RULE_SUBDIRS = ["eager", "reference"] as const'
      );
    });
  });
});
