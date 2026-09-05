/**
 * Cross-agent parity proof for the canonical host-rules directory
 * (`.agents/rules/`), work unit A of
 * `wiki/decisions/2026-08-12-agent-neutral-host-rules-path.md`.
 *
 * Two separate claims are proven here, and they are deliberately NOT the same
 * claim:
 *
 *  1. **Host rules reach every agent identically.** `.agents/rules/` is not a
 *     native auto-load tree for any runtime, so all six agents reach it through
 *     exactly one surface — the Lisa-managed pointer block in `AGENTS.md`
 *     (Claude via the `@AGENTS.md` import in `CLAUDE.md`). One surface means no
 *     agent double-loads host rules.
 *  2. **Lisa's own eager rules do NOT reach every agent.** Claude/Codex/OpenCode
 *     and Copilot get them through `inject-rules.sh`; Cursor gets them as native
 *     `alwaysApply` `.mdc` rules; **agy gets neither**, because agy plugin hooks
 *     do not fire in `-p` headless mode (see
 *     `wiki/decisions/2026-05-28-pattern-b-per-agent-plugin-variants.md`). That
 *     gap is asserted, not papered over: for agy the `AGENTS.md` pointer is the
 *     only rules surface there is.
 * @module tests/unit/core/host-rules-parity
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HARNESS_VALUES } from "../../../src/core/config.js";
import {
  LISA_HOST_RULES_END_MARKER,
  LISA_HOST_RULES_START_MARKER,
  migrateInstructionFiles,
} from "../../../src/core/instruction-files-migration.js";
import { HOST_RULES_DIR } from "../../../src/core/project-config.js";
import { SYNC_REGISTRY } from "../../../src/sync/registry.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const REPO_ROOT = process.cwd();

/** The six agents Lisa keeps in parity, in the order AGENTS.md names them. */
const AGENTS = [
  "claude",
  "codex",
  "cursor",
  "opencode",
  "copilot",
  "agy",
] as const;

/** One of the six real coding agents Lisa keeps in parity. */
type Agent = (typeof AGENTS)[number];

/** Repo-relative path to the shared Claude/Codex/OpenCode plugin's rule hook. */
const BASE_INJECT_RULES = "plugins/lisa/hooks/inject-rules.sh";
/** Repo-relative path to the shared plugin's eager-rule tree. */
const BASE_EAGER_RULES = "plugins/lisa/rules/eager";
/** Repo-relative path to the host project's `.lisa.config.json`. */
const CONFIG_FILENAME = ".lisa.config.json";
/** Basename of the canonical cross-agent instruction file. */
const AGENTS_MD = "AGENTS.md";

/**
 * Per-agent eager-rule delivery surface for **Lisa's own** rules, relative to
 * the repo root. `undefined` records a documented gap: the agent has no eager
 * surface at all.
 */
const EAGER_RULE_SURFACES: Readonly<
  Record<Agent, readonly string[] | undefined>
> = {
  // The `lisa` plugin serves Claude, Codex, and OpenCode.
  claude: [BASE_INJECT_RULES, BASE_EAGER_RULES],
  codex: [BASE_INJECT_RULES, BASE_EAGER_RULES],
  opencode: [BASE_INJECT_RULES, BASE_EAGER_RULES],
  copilot: [
    "plugins/lisa-copilot/hooks/inject-rules.sh",
    "plugins/lisa-copilot/rules/eager",
  ],
  // Cursor has no SessionStart hook; it reads native alwaysApply .mdc rules.
  cursor: ["plugins/lisa-cursor/rules"],
  // DOCUMENTED GAP — agy plugin hooks do not fire in `-p` headless mode.
  agy: undefined,
};

describe("core/host-rules parity across supported agents", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(dir);
  });

  it("covers every real agent Lisa supports (fleet is the meta-harness)", () => {
    const byName = (a: string, b: string): number => a.localeCompare(b);
    expect([...AGENTS].sort(byName)).toEqual(
      [...HARNESS_VALUES].filter(value => value !== "fleet").sort(byName)
    );
  });

  describe("host-rules delivery is identical on all six agents", () => {
    it.each(AGENTS)(
      "%s receives the same AGENTS.md pointer block",
      async harness => {
        await fs.writeJson(path.join(dir, CONFIG_FILENAME), { harness });

        await migrateInstructionFiles(dir);

        const body = await fs.readFile(path.join(dir, AGENTS_MD), "utf8");
        expect(body).toContain(LISA_HOST_RULES_START_MARKER);
        expect(body).toContain(HOST_RULES_DIR);
      }
    );

    it.each(AGENTS)(
      "%s receives an instruction it can act on, not just a path",
      async harness => {
        await fs.writeJson(path.join(dir, CONFIG_FILENAME), { harness });

        await migrateInstructionFiles(dir);

        const block = extractPointerBlock(
          await fs.readFile(path.join(dir, AGENTS_MD), "utf8")
        );
        // Plain prose is the only form all six agents act on. `@path` is Claude
        // Code syntax; the other five do not parse it, and it resolves files
        // rather than directories even on Claude, so an `@.agents/rules/` line
        // loads nothing anywhere. A block naming the directory without telling
        // anyone to read it delivers the path and no instruction.
        expect(block).toMatch(/read every file under/iu);
        expect(
          block.split("\n").some(line => line.trimStart().startsWith("@"))
        ).toBe(false);
      }
    );

    it("emits byte-identical pointer blocks for every agent", async () => {
      const blocks = await Promise.all(
        AGENTS.map(async harness => {
          const agentDir = await createTempDir();
          try {
            await fs.writeJson(path.join(agentDir, CONFIG_FILENAME), {
              harness,
            });
            await migrateInstructionFiles(agentDir);
            const body = await fs.readFile(
              path.join(agentDir, AGENTS_MD),
              "utf8"
            );
            return extractPointerBlock(body);
          } finally {
            await cleanupTempDir(agentDir);
          }
        })
      );

      expect(new Set(blocks).size).toBe(1);
    });

    it("reaches Claude through the CLAUDE.md -> AGENTS.md import", async () => {
      await fs.writeJson(path.join(dir, CONFIG_FILENAME), {
        harness: "claude",
      });

      await migrateInstructionFiles(dir);

      expect(await fs.readFile(path.join(dir, "CLAUDE.md"), "utf8")).toContain(
        "@AGENTS.md"
      );
    });

    it("keeps .agents/rules out of every runtime's native auto-load tree", () => {
      // `.agents/rules/` is reserved in AUTO_LOADED_RULES_DIR_PREFIXES, which is
      // what makes a learnings-ledger override inside it a hard rejection. The
      // reservation is the guarantee that nothing else claims the directory.
      const nativeTrees = [
        ".claude/rules",
        ".cursor/rules",
        ".github/instructions",
      ];
      expect(nativeTrees).not.toContain(HOST_RULES_DIR);
    });
  });

  describe("Lisa's own eager-rule delivery — including agy's gap", () => {
    it.each(
      AGENTS.filter(harness => EAGER_RULE_SURFACES[harness] !== undefined)
    )("%s has a documented eager-rule surface", harness => {
      const surfaces = EAGER_RULE_SURFACES[harness] ?? [];
      expect(surfaces.length).toBeGreaterThan(0);
      for (const surface of surfaces) {
        expect(fs.existsSync(path.join(REPO_ROOT, surface))).toBe(true);
      }
    });

    it("asserts the agy gap: no eager-rule surface exists in the agy plugin", () => {
      expect(EAGER_RULE_SURFACES.agy).toBeUndefined();
      expect(
        fs.existsSync(
          path.join(REPO_ROOT, "plugins/lisa-agy/hooks/inject-rules.sh")
        )
      ).toBe(false);
      expect(
        fs.existsSync(path.join(REPO_ROOT, "plugins/lisa-agy/rules"))
      ).toBe(false);
    });

    it("gives agy the pointer anyway, so host rules stay reachable", async () => {
      await fs.writeJson(path.join(dir, CONFIG_FILENAME), {
        harness: "agy",
      });

      await migrateInstructionFiles(dir);

      const body = await fs.readFile(path.join(dir, AGENTS_MD), "utf8");
      expect(body).toContain(HOST_RULES_DIR);
      // agy reads AGENTS.md natively, so the pointer — unlike an injected rule —
      // does arrive. The pointer names a directory; it never bakes rule bodies.
      expect(body).not.toContain("<!-- LISA_RULES_START -->");
    });
  });

  describe("the retired single-file model", () => {
    it("no longer ships a PROJECT_RULES.md create-only template", () => {
      expect(
        fs.existsSync(
          path.join(REPO_ROOT, "all/create-only/.claude/rules/PROJECT_RULES.md")
        )
      ).toBe(false);
    });

    it("seeds the canonical host-rules directory instead", () => {
      expect(
        fs.existsSync(
          path.join(REPO_ROOT, "all/create-only", HOST_RULES_DIR, "README.md")
        )
      ).toBe(true);
    });

    it("drops projectRulesFile from the sync registry", () => {
      expect(
        SYNC_REGISTRY.some(setting => setting.key === "projectRulesFile")
      ).toBe(false);
    });

    it("documents the directory in the config-resolution reference", async () => {
      const reference = await fs.readFile(
        path.join(
          REPO_ROOT,
          "plugins/src/base/rules/reference/config-resolution.md"
        ),
        "utf8"
      );

      expect(reference).toContain(HOST_RULES_DIR);
      expect(reference).not.toContain('"projectRulesFile"');
    });
  });
});

/**
 * Extract the Lisa-managed pointer block from an AGENTS.md body.
 * @param body - Full AGENTS.md contents.
 * @returns The managed block, markers included.
 */
function extractPointerBlock(body: string): string {
  const start = body.indexOf(LISA_HOST_RULES_START_MARKER);
  const end = body.indexOf(LISA_HOST_RULES_END_MARKER);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return body.slice(start, end + LISA_HOST_RULES_END_MARKER.length);
}
