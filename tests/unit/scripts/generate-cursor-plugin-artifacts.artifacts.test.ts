/**
 * Regression guards against the COMMITTED Cursor artifacts (issue #1055).
 *
 * The companion behavior suite proves the generator's logic; this suite proves
 * the shipped output on disk actually carries the Cursor-native shape.
 * `check:plugins` keeps these artifacts in sync with `plugins/src` in CI, so they
 * are a stable fixture. Final FLAT scheme: eager → `rules/<name>.mdc`
 * (alwaysApply:true), reference → `rules/<name>-reference.mdc`
 * (alwaysApply:false + description), 13 each / 26 total, no nested subdirs, no
 * plain `.md`. Hooks are asserted by SHAPE only — plugin-hook firing is not
 * verifiable through the cursor-agent CLI (only project `.cursor/hooks.json`
 * fires), proven during reproduction.
 * @module tests/unit/scripts/generate-cursor-plugin-artifacts.artifacts
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CLAUDE_PLUGIN_DIR,
  DOT_MCP_JSON,
  ENFORCE_TEAM_FIRST,
  HOOKS_JSON,
  INJECT_RULES,
  MCP_JSON,
  PLUGIN_JSON,
  readMdcFrontmatter,
} from "./cursor-artifact-helpers";

/** Repo root resolved from this test file (cwd-independent). */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);
const CURSOR_BASE = path.join(REPO_ROOT, "plugins", "lisa-cursor");
const CURSOR_EXPO = path.join(REPO_ROOT, "plugins", "lisa-expo-cursor");
const REFERENCE_SUFFIX = "-reference.mdc";

describe("committed Cursor artifacts (regression — issue #1055)", () => {
  describe("base lisa-cursor — rules", () => {
    const rulesDir = path.join(CURSOR_BASE, "rules");
    const mdcFiles = (): readonly string[] =>
      fs.readdirSync(rulesDir).filter(f => f.endsWith(".mdc"));

    it("ships 30 flat .mdc (15 eager + 15 reference), no nested dirs, no plain .md", () => {
      expect(fs.existsSync(rulesDir)).toBe(true);
      expect(fs.existsSync(path.join(rulesDir, "eager"))).toBe(false);
      expect(fs.existsSync(path.join(rulesDir, "reference"))).toBe(false);
      for (const e of fs.readdirSync(rulesDir, { withFileTypes: true })) {
        expect(e.isFile()).toBe(true);
        expect(e.name.endsWith(".mdc")).toBe(true);
      }
      const mdc = mdcFiles();
      expect(mdc.length).toBe(30);
      expect(mdc.filter(f => f.endsWith(REFERENCE_SUFFIX)).length).toBe(15);
      expect(mdc.filter(f => !f.endsWith(REFERENCE_SUFFIX)).length).toBe(15);
    });

    it("eager rules carry alwaysApply:true; reference rules alwaysApply:false + description", () => {
      for (const f of mdcFiles()) {
        const fm = readMdcFrontmatter(path.join(rulesDir, f));
        expect(fm.hasFrontmatter).toBe(true);
        if (f.endsWith(REFERENCE_SUFFIX)) {
          expect(fm.alwaysApply).toBe(false);
          expect(fm.hasDescription).toBe(true);
        } else {
          expect(fm.alwaysApply).toBe(true);
        }
      }
    });

    it("rewrites eager-body cross-link URLs to the flat <name>-reference.mdc twin (no nested/.md rule-link targets)", () => {
      const body = fs.readFileSync(
        path.join(rulesDir, "base-rules.mdc"),
        "utf8"
      );
      // URL rewritten to the twin (precise on the URL position) …
      expect(body).toContain("](base-rules-reference.mdc)");
      // … while the readable link TEXT is preserved verbatim (fix D).
      expect(body).toContain("[reference/base-rules.md]");
      // Guard is non-vacuous: the 14 eager rules each carry a cross-link URL.
      const filesWithLinks = mdcFiles().filter(f =>
        /\]\([^)]+\)/.test(fs.readFileSync(path.join(rulesDir, f), "utf8"))
      );
      expect(filesWithLinks.length).toBeGreaterThanOrEqual(13);
      for (const f of mdcFiles()) {
        const text = fs.readFileSync(path.join(rulesDir, f), "utf8");
        // Only Markdown link TARGETS are checked. The rewrite preserves
        // human-readable link TEXT (e.g. "[reference/base-rules.md](...)"), so a
        // label may still read "reference/..."; what must not survive is a link
        // URL into the removed nested tree OR a still-unconverted `.md` target.
        const linkUrls = [...text.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]);
        for (const url of linkUrls) {
          expect(url).not.toMatch(/(?:^|\/)(?:eager|reference)\//);
          // Intra-repo rule links must be .mdc now; external links (with a URL
          // scheme) are exempt — they legitimately keep their own extension.
          if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
            expect(url).not.toMatch(/\.md(#[^)]*)?$/);
          }
        }
      }
    });
  });

  describe("base lisa-cursor — hooks (shape only; firing not CLI-verifiable)", () => {
    it("emits hooks/hooks.json (wrapped, camelCase, relative commands), no inline manifest hooks", () => {
      const cfg = fs.readJsonSync(path.join(CURSOR_BASE, "hooks", HOOKS_JSON));
      expect(cfg.version).toBe(1);
      expect(Object.keys(cfg.hooks)).toContain("preToolUse");
      expect(Object.keys(cfg.hooks)).toContain("sessionStart");
      expect(Object.keys(cfg.hooks)).not.toContain("PreToolUse");
      for (const entries of Object.values(cfg.hooks) as Array<
        Array<Record<string, unknown>>
      >) {
        for (const entry of entries) {
          expect(typeof entry.command).toBe("string");
          expect("type" in entry).toBe(false);
          expect("hooks" in entry).toBe(false);
          // Plugin hooks run with the project root as cwd, so commands use the
          // ${CURSOR_PLUGIN_ROOT} token (not a bare ./, which would not resolve
          // and could be shadowed by a repo-local ./hooks/*).
          expect(
            String(entry.command).startsWith("${CURSOR_PLUGIN_ROOT}/hooks/")
          ).toBe(true);
          expect(String(entry.command)).not.toContain("CLAUDE_PLUGIN_ROOT");
        }
      }
      const manifest = fs.readJsonSync(
        path.join(CURSOR_BASE, CLAUDE_PLUGIN_DIR, PLUGIN_JSON)
      );
      expect("hooks" in manifest).toBe(false);
    });

    it("delivers rules exactly once: inject-rules.sh stripped, native .mdc present", () => {
      expect(fs.existsSync(path.join(CURSOR_BASE, "hooks", INJECT_RULES))).toBe(
        false
      );
      const serialized = JSON.stringify(
        fs.readJsonSync(path.join(CURSOR_BASE, "hooks", HOOKS_JSON))
      );
      expect(serialized).not.toContain(INJECT_RULES);
      expect(serialized).not.toContain("entire hooks claude-code");
      expect(serialized).not.toContain(ENFORCE_TEAM_FIRST);
      expect(
        fs
          .readdirSync(path.join(CURSOR_BASE, "rules"))
          .some(f => f.endsWith(".mdc"))
      ).toBe(true);
    });
  });

  describe("MCP rename across variants", () => {
    it("stack variant WITH MCP (expo) ships mcp.json, not .mcp.json", () => {
      expect(fs.existsSync(path.join(CURSOR_EXPO, MCP_JSON))).toBe(true);
      expect(fs.existsSync(path.join(CURSOR_EXPO, DOT_MCP_JSON))).toBe(false);
      const mcp = fs.readJsonSync(path.join(CURSOR_EXPO, MCP_JSON));
      expect(typeof mcp.mcpServers).toBe("object");
    });

    it("base variant WITH MCP (sentry, universal) ships mcp.json, not .mcp.json", () => {
      // Base carries the universal sentry MCP server (plugins/src/base/.mcp.json),
      // so the Cursor base variant ships the renamed mcp.json (auto-discovered) and
      // never the dotted Claude name.
      expect(fs.existsSync(path.join(CURSOR_BASE, MCP_JSON))).toBe(true);
      expect(fs.existsSync(path.join(CURSOR_BASE, DOT_MCP_JSON))).toBe(false);
      const mcp = fs.readJsonSync(path.join(CURSOR_BASE, MCP_JSON));
      expect(typeof mcp.mcpServers).toBe("object");
      expect(typeof mcp.mcpServers.sentry).toBe("object");
    });
  });

  // Some stacks (rails, harper-fabric) use a legacy FLAT source layout — a single
  // top-level `rules/<name>.md` with no eager/reference subdirs. The generator
  // converts these to `<name>.mdc` alwaysApply:true (issue #1055 bonus fix). Guard
  // at least one so the flat-stack path stays converted.
  describe("flat-layout stack rules (rails)", () => {
    const railsRules = path.join(
      REPO_ROOT,
      "plugins",
      "lisa-rails-cursor",
      "rules"
    );

    it("converts rails-conventions.md → rails-conventions.mdc (alwaysApply:true + description), no .md left", () => {
      const conv = path.join(railsRules, "rails-conventions.mdc");
      expect(fs.existsSync(conv)).toBe(true);
      const fm = readMdcFrontmatter(conv);
      expect(fm.alwaysApply).toBe(true);
      expect(fm.hasDescription).toBe(true);
      // Whole tree is flat .mdc — no nested dirs, no plain .md survivors.
      for (const e of fs.readdirSync(railsRules, { withFileTypes: true })) {
        expect(e.isFile()).toBe(true);
        expect(e.name.endsWith(".mdc")).toBe(true);
      }
    });
  });
});
