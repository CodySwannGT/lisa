/**
 * Unit tests for plugins/src/base/scripts/cross-pollinate.mjs.
 *
 * Exercises the provenance core that makes any-to-any cross-pollination safe:
 * detection, deterministic emit, idempotency, loop prevention, garbage
 * collection, drift protection (never clobber a hand-edited target), and
 * human-authored collision detection.
 * @module tests/unit/scripts/cross-pollinate
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  apply,
  plan,
} from "../../../plugins/src/base/scripts/cross-pollinate.mjs";

// The engine is plain JS (JSDoc-typed); describe the shapes we assert against.
/**
 *
 */
interface Emit {
  readonly logicalId: string;
  readonly kind: string;
  readonly to: string;
  readonly reason?: string;
}
/**
 *
 */
interface Plan {
  readonly targetAgents: readonly string[];
  readonly sources: ReadonlyArray<{ readonly path: string }>;
  readonly emits: readonly Emit[];
  readonly pending: ReadonlyArray<{
    readonly kind: string;
    readonly to: string;
  }>;
  readonly conflicts: ReadonlyArray<{ readonly logicalId: string }>;
}
/**
 *
 */
interface ApplyResult {
  readonly written: readonly Emit[];
  readonly skippedDrift: readonly Emit[];
  readonly gc: readonly string[];
}
const planOf = (dir: string): Plan => plan(dir) as Plan;
const applyOf = (p: Plan, dryRun: boolean): ApplyResult =>
  apply(p, { dryRun }) as ApplyResult;

const MCP_JSON = ".mcp.json";
const CURSOR_MCP = ".cursor/mcp.json";
const LOCKFILE = ".lisa/cross-pollination.lock.json";
const SKILL_MD_PATH = ".claude/skills/my-skill/SKILL.md";
const URL = "https://e.x";
const CODEX = "codex";
const LISA_CONFIG = ".lisa.config.json";
const MCP_ID = "mcp:project";
const SKILL_MD = [
  "---",
  "name: my-skill",
  'description: "Do a thing. Detail."',
  "---",
  "# My Skill",
  "Body.",
].join("\n");
const mcp = (servers: Record<string, unknown>): string =>
  JSON.stringify({ mcpServers: servers });

let root: string;

// Write a file under the project root, creating parent dirs.
const put = (rel: string, contents: string): void => {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, contents);
};

// Read a file relative to the project root.
const read = (rel: string): string =>
  readFileSync(path.join(root, rel), "utf8");

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "xpollinate-"));
  put(LISA_CONFIG, JSON.stringify({ harness: "fleet" }));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("cross-pollinate detection + emit", () => {
  it("derives the Codex openai.yaml sidecar from a Claude skill", () => {
    put(SKILL_MD_PATH, SKILL_MD);

    const result = applyOf(planOf(root), false);

    expect(result.written.some(w => w.to === CODEX)).toBe(true);
    const yaml = read(".claude/skills/my-skill/agents/openai.yaml");
    expect(yaml).toContain('display_name: "My Skill"');
    expect(yaml).toContain("$my-skill");
  });

  it("translates a Claude rule into a Cursor .mdc with frontmatter", () => {
    put(
      ".claude/rules/style.md",
      "# Style Guide\n\nUse tabs. See [api](api.md)."
    );

    apply(plan(root), { dryRun: false });

    const mdc = read(".cursor/rules/style.mdc");
    expect(mdc).toContain('description: "Style Guide"');
    expect(mdc).toContain("alwaysApply: true");
    // Intra-rule link extension rewritten to the Cursor format.
    expect(mdc).toContain("(api.mdc)");
  });

  it("translates a Cursor .mdc rule into a plain Claude .md", () => {
    put(
      ".cursor/rules/x.mdc",
      '---\ndescription: "X"\nalwaysApply: true\n---\n\n# X\n\nBody [y](y.mdc).'
    );

    apply(plan(root), { dryRun: false });

    const md = read(".claude/rules/x.md");
    expect(md).not.toContain("alwaysApply"); // frontmatter stripped
    expect(md).toContain("# X");
    expect(md).toContain("(y.md)");
  });

  it("reshapes a Claude .mcp.json into the Cursor mcp.json location", () => {
    put(MCP_JSON, mcp({ x: { type: "http", url: URL } }));

    applyOf(planOf(root), false);

    const cursor = JSON.parse(read(CURSOR_MCP));
    expect(cursor.mcpServers.x.url).toBe(URL);
  });

  it("records every emit in the committed lockfile", () => {
    put(SKILL_MD_PATH, SKILL_MD);

    applyOf(planOf(root), false);

    const lock = JSON.parse(read(LOCKFILE));
    expect(lock.version).toBe(1);
    expect(lock.entries["skill:my-skill"].targets[0].agent).toBe("codex");
    expect(lock.entries["skill:my-skill"].targets[0].generatedHash).toMatch(
      /^[a-f0-9]{64}$/
    );
  });

  it("writes nothing in dry-run mode", () => {
    put(MCP_JSON, mcp({}));

    const result = applyOf(planOf(root), true);

    expect(result.written.length).toBeGreaterThan(0);
    expect(() => read(CURSOR_MCP)).toThrow();
    expect(() => read(LOCKFILE)).toThrow();
  });
});

describe("cross-pollinate invariants", () => {
  it("is idempotent — a second run writes nothing", () => {
    put(SKILL_MD_PATH, SKILL_MD);
    put(MCP_JSON, mcp({ x: { url: URL } }));

    applyOf(planOf(root), false);
    const replan = planOf(root);
    const second = applyOf(replan, false);

    expect(second.written.length).toBe(0);
    // The plan itself must converge — no emit left in a non-up-to-date state.
    // (A natively-consuming agent like OpenCode must not perpetually re-flag.)
    expect(replan.emits.every(e => e.reason === "up-to-date")).toBe(true);
  });

  it("prevents loops — a generated target is never treated as a source", () => {
    put(MCP_JSON, mcp({ x: { url: URL } }));
    applyOf(planOf(root), false);

    // The generated .cursor/mcp.json must not appear as a fresh source.
    const replan = planOf(root);
    expect(replan.sources.find(s => s.path === CURSOR_MCP)).toBeUndefined();
  });

  it("garbage-collects targets when the source is removed", () => {
    put(MCP_JSON, mcp({ x: { url: URL } }));
    applyOf(planOf(root), false);
    expect(read(CURSOR_MCP)).toContain(URL);

    rmSync(path.join(root, MCP_JSON));
    const result = applyOf(planOf(root), false);

    expect(result.gc).toContain(CURSOR_MCP);
    expect(() => read(CURSOR_MCP)).toThrow();
    const lock = JSON.parse(read(LOCKFILE));
    expect(lock.entries[MCP_ID]).toBeUndefined();
  });

  it("never clobbers a hand-edited (drifted) target", () => {
    put(MCP_JSON, mcp({ x: { url: URL } }));
    applyOf(planOf(root), false);

    // Human edits the generated Cursor file, and the source also changes.
    put(CURSOR_MCP, mcp({ x: { url: "https://EDITED" } }));
    put(MCP_JSON, mcp({ x: { url: URL, note: "changed" } }));

    const result = applyOf(planOf(root), false);

    expect(result.skippedDrift.some(s => s.to === "cursor")).toBe(true);
    expect(read(CURSOR_MCP)).toContain("EDITED");
  });

  it("reports a human-authored collision instead of translating over it", () => {
    // Same logicalId authored independently in two agents (neither generated).
    put(MCP_JSON, mcp({ a: {} }));
    put(CURSOR_MCP, mcp({ b: {} }));

    const p = planOf(root);

    expect(p.conflicts.some(c => c.logicalId === MCP_ID)).toBe(true);
    expect(p.emits.some(e => e.logicalId === MCP_ID)).toBe(false);
  });
});

describe("cross-pollinate harness scoping", () => {
  it("only targets agents the harness includes", () => {
    rmSync(path.join(root, LISA_CONFIG));
    put(LISA_CONFIG, JSON.stringify({ harness: "both" }));
    put(SKILL_MD_PATH, SKILL_MD);

    const p = planOf(root);

    expect(p.targetAgents).toEqual(["claude", "codex"]);
    expect(p.pending.every(x => ["claude", "codex"].includes(x.to))).toBe(true);
  });
});
