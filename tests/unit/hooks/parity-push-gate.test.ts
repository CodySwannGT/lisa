/**
 * The parity push gate has to read what it claims to check (issue #2552).
 *
 * Two proven holes, both of which shipped:
 *
 *   1. `.husky/pre-push.local` ran only `plugin-parity-drift.mjs`, which reads
 *      skill FRONTMATTER. `parity/plugin-routing/*.json` — the other half of the
 *      same contract — was never read, so it sat invalid through three
 *      consecutive safety-net refreshes while every push reported green.
 *   2. PR #2548 pushed six generated parity `SKILL.md` files carrying literal
 *      `<<<<<<< HEAD` blocks. The pin VALUE was inside the conflict block, so
 *      the drift gate read it as current and passed.
 *
 * These tests run the real hook file end-to-end against a throwaway repository,
 * because a hook asserted only by grepping its text is the same class of
 * evidence that produced the defect: a claim nobody executed.
 *
 * @module tests/unit/hooks/parity-push-gate
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import { cleanGitEnv } from "../../helpers/test-utils";

const HOOK = path.resolve(".husky/pre-push.local");
const GIT = "/usr/bin/git";
const SH = "/bin/sh";
const SCRIPTS_DIR = "scripts";
const HOOK_RELATIVE = ".husky/pre-push.local";
const ROUTING_DIR = "parity/plugin-routing";
const ARTIFACT = "has-manifest@demo-marketplace.json";
const FIXTURE_ROUTING = path.resolve("parity/fixtures/routing/valid");
const SCRIPTS = [
  "check-conflict-markers.mjs",
  "plugin-parity-drift.mjs",
  "plugin-routing-validate.mjs",
] as const;

const SKILL_PATH =
  "plugins/src/base/skills/lisa-parity-safety-net-rules/SKILL.md";

/** Marker literals as quoted strings, so this file is not itself flagged. */
const START = "<<<<<<< HEAD";
const SEP = "=======";
const END = ">>>>>>> b4b3aff42 (chore(parity): refresh the pin)";

/** A clean parity skill, pinned exactly the way the real one is. */
const CLEAN_SKILL = [
  "---",
  "name: lisa-parity-safety-net-rules",
  "synced-from: safety-net@cc-marketplace@2.0.4",
  "---",
  "",
  "> **2.0.4 review.** No rule surface changed upstream.",
  "",
].join("\n");

/** The exact #2548 shape: both sides kept, pin value present inside the block. */
const CONFLICTED_SKILL = [
  "---",
  "name: lisa-parity-safety-net-rules",
  "synced-from: safety-net@cc-marketplace@2.0.4",
  "---",
  "",
  "> **2.0.4 review.**",
  START,
  "> hash the sorted (path, content) manifest of every rule-bearing directory.",
  SEP,
  "> Upstream 2.0.3-2.0.4 changed three things.",
  END,
  "",
].join("\n");

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/**
 * Build a throwaway repository carrying the real hook, the real gate scripts, a
 * valid routing artifact, and one parity skill.
 *
 * @param skill - the SKILL.md body to commit.
 * @returns The absolute repository root.
 */
function gateRepo(skill: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-2552-gate-"));
  const env = cleanGitEnv(process.env);
  const git = (...args: readonly string[]): void => {
    execFileSync(GIT, [...args], { cwd: root, env, stdio: "ignore" });
  };
  roots.push(root);
  for (const dir of [
    ".husky",
    SCRIPTS_DIR,
    ROUTING_DIR,
    ".claude/skills",
    path.dirname(SKILL_PATH),
  ]) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  copyFileSync(HOOK, path.join(root, HOOK_RELATIVE));
  for (const script of SCRIPTS) {
    copyFileSync(
      path.resolve(SCRIPTS_DIR, script),
      path.join(root, SCRIPTS_DIR, script)
    );
  }
  // A real, schema-valid routing artifact + its paired .md companion.
  for (const entry of [ARTIFACT, "has-manifest@demo-marketplace.md"]) {
    copyFileSync(
      path.join(FIXTURE_ROUTING, entry),
      path.join(root, ROUTING_DIR, entry)
    );
  }
  writeFileSync(path.join(root, ".claude/skills/.keep"), "", "utf8");
  writeFileSync(path.join(root, SKILL_PATH), skill, "utf8");
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return root;
}

/**
 * Run the copied hook with `sh` and capture its exit code and output.
 *
 * @param root - the throwaway repository root.
 * @returns The exit code and combined output.
 */
function runHook(root: string): { code: number; output: string } {
  try {
    const stdout = execFileSync(SH, [HOOK_RELATIVE], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...cleanGitEnv(process.env),
        // Pin the cache to somewhere that cannot exist so the run is
        // deterministic regardless of what the developer has installed.
        CLAUDE_PLUGIN_CACHE: path.join(root, "no-such-plugin-cache"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output: stdout };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.status === "number" ? e.status : -1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

describe("parity push gate", () => {
  it("passes a clean tree with no plugin cache on the machine", () => {
    const { code, output } = runHook(gateRepo(CLEAN_SKILL));
    expect(code).toBe(0);
    expect(output).toContain("No leftover conflict markers");
    expect(output).toContain("routing artifacts valid");
  });

  it("blocks the push on a conflict marker in a parity skill (#2548)", () => {
    const { code, output } = runHook(gateRepo(CONFLICTED_SKILL));
    expect(code).toBe(1);
    expect(output).toContain("leftover merge-conflict markers");
    expect(output).toContain(SKILL_PATH);
  });

  it("blocks the push when a routing artifact violates the contract", () => {
    const root = gateRepo(CLEAN_SKILL);
    const artifact = path.join(root, ROUTING_DIR, ARTIFACT);
    const parsed = JSON.parse(readFileSync(artifact, "utf8")) as {
      routing: Record<string, { outcome: string }>;
    };
    parsed.routing.codex.outcome = "not-a-real-outcome";
    writeFileSync(artifact, JSON.stringify(parsed, null, 2), "utf8");
    const { code, output } = runHook(root);
    expect(code).toBe(1);
    expect(output).toContain("routing artifacts failed validation");
    expect(output).toContain("outcome invalid");
  });

  it("blocks the push when the routing directory has gone missing", () => {
    const root = gateRepo(CLEAN_SKILL);
    rmSync(path.join(root, ROUTING_DIR), { force: true, recursive: true });
    // A gate that cannot run has not passed. Warning here is how a gate
    // becomes vacuous, which is the whole subject of #2552.
    expect(runHook(root).code).toBe(1);
  });
});

describe("parity push gate wiring", () => {
  const source = readFileSync(HOOK, "utf8");

  it.each(SCRIPTS)("invokes scripts/%s", script => {
    expect(source).toContain(`node ${SCRIPTS_DIR}/${script}`);
  });

  it("runs the conflict-marker gate in CI too, not only in the local hook", () => {
    // A cloud agent or a hookless clone never runs .husky/pre-push.local.
    const workflow = readFileSync(
      path.resolve(".github/workflows/plugins-sync.yml"),
      "utf8"
    );
    expect(workflow).toContain("bun run check:conflict-markers");
  });
});
