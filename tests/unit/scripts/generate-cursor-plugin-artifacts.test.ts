/**
 * Behavior tests for scripts/generate-cursor-plugin-artifacts.mjs (issue #1055).
 *
 * The Cursor variant generator must emit Cursor's native plugin shape. These
 * tests scaffold a built-Claude-plugin fixture in a tmpdir, run the exported
 * generator, and assert on the emitted tree — proving generator BEHAVIOR. The
 * companion `*.artifacts.test.ts` suite guards the committed output on disk.
 *
 * The four mismatches under test (all originally failing — see git history /
 * evidence/cursor-rule-probe-1055.md for the empirical reproduction):
 *   1. RULES: Cursor reads `.mdc` files under `rules/` (scanned recursively) with
 *      YAML frontmatter (`alwaysApply`); the old generator passed through nested
 *      `rules/eager|reference/*.md` as plain `.md` with no frontmatter.
 *   2. HOOKS: Cursor reads `hooks/hooks.json` (flattened schema, camelCase events,
 *      relative commands); the old generator left hooks inline in the manifest.
 *   3. MCP: Cursor reads `mcp.json` (no dot); the old generator shipped `.mcp.json`.
 *   4. RULES-ONCE: rules reach Cursor exactly once via native `.mdc`;
 *      `inject-rules.sh` stays stripped (no double-inject, not zero).
 *
 * Rule assertions are layout-agnostic (recursive `.mdc` discovery + count +
 * frontmatter distribution) so they hold whether rules are flattened or kept in
 * subdirs, and catch a same-path collision (the fixture's eager/reference tiers
 * share basenames with different bodies).
 * @module tests/unit/scripts/generate-cursor-plugin-artifacts
 */
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateCursorVariant } from "../../../scripts/generate-cursor-plugin-artifacts.mjs";
import {
  BASE_HOOK_BLOCK,
  CLAUDE_PLUGIN_DIR,
  DOT_MCP_JSON,
  EAGER_RULES,
  ENFORCE_TEAM_FIRST,
  HOOKS_JSON,
  INJECT_RULES,
  MCP_JSON,
  PLUGIN_JSON,
  readMdcFrontmatter,
  REFERENCE_RULES,
  scaffoldSource,
  walkFiles,
} from "./cursor-artifact-helpers";

describe("generate-cursor-plugin-artifacts (Cursor-native shape — issue #1055)", () => {
  let tempDir: string;
  let srcDir: string;
  let outDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-gen-test-"));
    srcDir = path.join(tempDir, "src");
    outDir = path.join(tempDir, "lisa-cursor");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { force: true, recursive: true });
  });

  describe("base variant (hooks + rules, no MCP)", () => {
    beforeEach(async () => {
      await scaffoldSource(srcDir, { hooks: BASE_HOOK_BLOCK, withMcp: false });
      generateCursorVariant(srcDir, outDir, "1.2.3");
    });

    describe("mismatch #1 — rules as .mdc with frontmatter", () => {
      it("converts every rule from .md to .mdc (no plain .md rule files remain)", () => {
        const rulesDir = path.join(outDir, "rules");
        expect(fs.existsSync(rulesDir)).toBe(true);
        const files = walkFiles(rulesDir);
        expect(files.length).toBeGreaterThan(0);
        for (const f of files) {
          expect(f.endsWith(".mdc")).toBe(true);
          expect(f.endsWith(".md")).toBe(false);
        }
      });

      it("preserves every eager AND reference rule (no same-path collision / drop)", () => {
        const mdc = walkFiles(path.join(outDir, "rules")).filter(f =>
          f.endsWith(".mdc")
        );
        // base-rules / coding-philosophy appear in BOTH tiers with DIFFERENT
        // content, so both copies must survive. 3 eager + 2 reference = 5.
        expect(mdc.length).toBe(EAGER_RULES.length + REFERENCE_RULES.length);
      });

      it("sets alwaysApply:true for eager and alwaysApply:false (+description) for reference", () => {
        const rulesDir = path.join(outDir, "rules");
        const mdc = walkFiles(rulesDir).filter(f => f.endsWith(".mdc"));
        const frontmatters = mdc.map(f =>
          readMdcFrontmatter(path.join(rulesDir, f))
        );
        for (const fm of frontmatters) {
          expect(fm.hasFrontmatter).toBe(true);
          expect(typeof fm.alwaysApply).toBe("boolean");
        }
        const eager = frontmatters.filter(fm => fm.alwaysApply === true);
        const reference = frontmatters.filter(fm => fm.alwaysApply === false);
        expect(eager.length).toBe(EAGER_RULES.length);
        expect(reference.length).toBe(REFERENCE_RULES.length);
        // Reference (on-demand) rules need a description for matching; eager
        // (always-on) rules may omit it (Cursor ignores it when alwaysApply:true).
        for (const fm of reference) {
          expect(fm.hasDescription).toBe(true);
        }
      });
    });

    describe("mismatch #2 — hooks in hooks/hooks.json (Cursor schema)", () => {
      it("emits hooks/hooks.json and removes the inline manifest hooks block", () => {
        expect(fs.existsSync(path.join(outDir, "hooks", HOOKS_JSON))).toBe(
          true
        );
        const manifest = fs.readJsonSync(
          path.join(outDir, CLAUDE_PLUGIN_DIR, PLUGIN_JSON)
        );
        expect("hooks" in manifest).toBe(false);
      });

      it("uses Cursor's flattened schema: {version,hooks} camelCase events + {command,matcher} entries", () => {
        const cfg = fs.readJsonSync(path.join(outDir, "hooks", HOOKS_JSON));
        expect(cfg.version).toBe(1);
        expect(typeof cfg.hooks).toBe("object");
        const eventKeys = Object.keys(cfg.hooks);
        expect(eventKeys).toContain("preToolUse");
        expect(eventKeys).toContain("sessionStart");
        expect(eventKeys).not.toContain("PreToolUse");
        expect(eventKeys).not.toContain("SessionStart");
        for (const entries of Object.values(cfg.hooks) as Array<
          Array<Record<string, unknown>>
        >) {
          expect(Array.isArray(entries)).toBe(true);
          for (const entry of entries) {
            expect(typeof entry.command).toBe("string");
            expect("type" in entry).toBe(false);
            expect("hooks" in entry).toBe(false);
            expect(String(entry.command)).not.toContain("CLAUDE_PLUGIN_ROOT");
          }
        }
      });

      it("strips Claude-only entries (entire calls, enforce-team-first)", () => {
        const serialized = JSON.stringify(
          fs.readJsonSync(path.join(outDir, "hooks", HOOKS_JSON))
        );
        expect(serialized).not.toContain("entire hooks claude-code");
        expect(serialized).not.toContain(ENFORCE_TEAM_FIRST);
      });
    });

    describe("mismatch #4 — rules delivered exactly once", () => {
      it("strips inject-rules.sh entirely (native .mdc is the single delivery path)", () => {
        expect(fs.existsSync(path.join(outDir, "hooks", INJECT_RULES))).toBe(
          false
        );
        const serialized = JSON.stringify(
          fs.readJsonSync(path.join(outDir, "hooks", HOOKS_JSON))
        );
        expect(serialized).not.toContain(INJECT_RULES);
        const mdc = walkFiles(path.join(outDir, "rules")).filter(f =>
          f.endsWith(".mdc")
        );
        expect(mdc.length).toBeGreaterThan(0);
      });
    });

    describe("manifest reshape (D2 — keep .claude-plugin/, CLI scope)", () => {
      it("keeps .claude-plugin/plugin.json and stamps the version", () => {
        const manifestPath = path.join(outDir, CLAUDE_PLUGIN_DIR, PLUGIN_JSON);
        expect(fs.existsSync(manifestPath)).toBe(true);
        expect(fs.readJsonSync(manifestPath).version).toBe("1.2.3");
        expect(fs.existsSync(path.join(outDir, ".cursor-plugin"))).toBe(false);
      });
    });
  });

  describe("stack variant WITH MCP (expo-like)", () => {
    beforeEach(async () => {
      await scaffoldSource(srcDir, { hooks: {}, withMcp: true });
      generateCursorVariant(srcDir, outDir, "1.2.3");
    });

    it("mismatch #3 — renames .mcp.json → mcp.json (no leading dot)", () => {
      expect(fs.existsSync(path.join(outDir, MCP_JSON))).toBe(true);
      expect(fs.existsSync(path.join(outDir, DOT_MCP_JSON))).toBe(false);
      const mcp = fs.readJsonSync(path.join(outDir, MCP_JSON));
      expect(mcp.mcpServers.expo.url).toBe("https://mcp.expo.dev/mcp");
    });

    it("emits no hooks.json when the manifest carries no hooks", () => {
      expect(fs.existsSync(path.join(outDir, "hooks", HOOKS_JSON))).toBe(false);
    });
  });

  describe("stack variant WITHOUT MCP", () => {
    beforeEach(async () => {
      await scaffoldSource(srcDir, { hooks: {}, withMcp: false });
      generateCursorVariant(srcDir, outDir, "1.2.3");
    });

    it("ships neither mcp.json nor .mcp.json", () => {
      expect(fs.existsSync(path.join(outDir, MCP_JSON))).toBe(false);
      expect(fs.existsSync(path.join(outDir, DOT_MCP_JSON))).toBe(false);
    });
  });

  // Cross-link rewrite (rewriteRuleLinks) — review gap B / fixes D + E. The
  // standard fixtures have no cross-links, so this scaffolds an eager rule whose
  // body carries every link shape and asserts the transformed `.mdc`.
  describe("rule cross-link rewrite (fixes D + E)", () => {
    let body: string;

    beforeEach(async () => {
      await fs.ensureDir(path.join(srcDir, CLAUDE_PLUGIN_DIR));
      await fs.writeJson(path.join(srcDir, CLAUDE_PLUGIN_DIR, PLUGIN_JSON), {
        name: "lisa-test",
        version: "0.0.0",
        hooks: {},
      });
      await fs.ensureDir(path.join(srcDir, "rules", "eager"));
      await fs.ensureDir(path.join(srcDir, "rules", "reference"));
      await fs.writeFile(
        path.join(srcDir, "rules", "reference", "details.md"),
        "# details\n",
        "utf8"
      );
      await fs.writeFile(
        path.join(srcDir, "rules", "eager", "other.md"),
        "# other\n",
        "utf8"
      );
      // Eager body with: tier-prefixed link, fragment link, bare same-dir link
      // (fix E), and an external .md URL (must be left alone).
      await fs.writeFile(
        path.join(srcDir, "rules", "eager", "intro.md"),
        [
          "# intro",
          "",
          "Full detail in [reference/details.md](../reference/details.md).",
          "Jump to [a section](../reference/details.md#usage).",
          "See the sibling [other rule](other.md).",
          "External [docs](https://example.com/guide.md).",
          "",
        ].join("\n"),
        "utf8"
      );
      generateCursorVariant(srcDir, outDir, "1.2.3");
      body = fs.readFileSync(path.join(outDir, "rules", "intro.mdc"), "utf8");
    });

    it("rewrites the link URL to the -reference.mdc twin but leaves the link TEXT untouched (fix D)", () => {
      expect(body).toContain("[reference/details.md](details-reference.mdc)");
      // The old nested URL must be gone …
      expect(body).not.toContain("](../reference/details.md)");
      // … but the readable label that happens to read "reference/..." stays.
      expect(body).toContain("[reference/details.md]");
    });

    it("preserves #fragment suffixes on rewritten URLs", () => {
      expect(body).toContain("[a section](details-reference.mdc#usage)");
    });

    it("rewrites a bare same-dir .md link to .mdc (fix E)", () => {
      expect(body).toContain("[other rule](other.mdc)");
    });

    it("leaves external/non-rule .md URLs untouched", () => {
      expect(body).toContain("[docs](https://example.com/guide.md)");
    });
  });
});
