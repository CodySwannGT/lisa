/**
 * Wiring for the withdrawn-rulings ledger (CodySwannGT/lisa#3752).
 *
 * The ledger is worth nothing if the only way to reach it is to go looking for
 * it — that is the defect it exists against. So these assert the readers: the
 * session stamp on both start events, the PostToolUse re-check that reaches a
 * running session, the gate that stops the ledger rotting, and the eager rule
 * that carries the manual `--list` for surfaces with no hook runtime.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const HOOK_MJS = "plugins/src/base/hooks/withdrawn-rulings.mjs";
const MANIFEST = "plugins/src/base/.claude-plugin/plugin.json";
const HOOK_SH = "withdrawn-rulings.sh";
const HOOK_ARG = `${HOOK_SH} --hook`;
const START_ARG = `${HOOK_SH} --session-start`;

/**
 * Read a repo-relative text file.
 * @param relativePath - Repo-relative path
 * @returns File contents
 */
function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");
}

/**
 * Parse a repo-relative JSON file.
 * @param relativePath - Repo-relative path
 * @returns Parsed contents
 */
function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(read(relativePath)) as Record<string, unknown>;
}

/**
 * Every hook command registered for one event in the base plugin manifest.
 * @param event - The hook event name
 * @returns Registered command strings
 */
function commandsFor(event: string): string[] {
  const manifest = readJson(MANIFEST) as {
    hooks: Record<string, { matcher: string; hooks: { command: string }[] }[]>;
  };
  return (manifest.hooks[event] ?? []).flatMap(block =>
    block.hooks.map(hook => hook.command)
  );
}

describe("withdrawn-rulings — how it gets read", () => {
  it.each(["SessionStart", "SubagentStart"])(
    "stamps what a %s session is born knowing",
    event => {
      expect(
        commandsFor(event).some(command => command.includes(START_ARG))
      ).toBe(true);
    }
  );

  it("re-checks after tool use, which is the only thing that reaches a running session", () => {
    expect(
      commandsFor("PostToolUse").some(command => command.includes(HOOK_ARG))
    ).toBe(true);
  });

  it("declares the check as a push gate and a package script", () => {
    const pkg = readJson("package.json") as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["check:withdrawn-rulings"]).toContain(HOOK_MJS);
    const config = readJson(".lisa.config.json") as {
      gates: Record<string, { push?: { level?: string; run?: string } }>;
    };
    expect(config.gates["x-withdrawn-rulings"]?.push?.run).toBe(
      "check:withdrawn-rulings"
    );
    expect(config.gates["x-withdrawn-rulings"]?.push?.level).toBe("required");
  });

  it("carries the manual read in the eager rule, for surfaces with no hook runtime", () => {
    const eager = read("plugins/src/base/rules/eager/withdrawn-rulings.md");
    expect(eager).toContain("--withdraw");
    expect(eager).toContain("--list");
    expect(eager).toContain("verbatim");
    expect(
      read("plugins/src/base/rules/reference/withdrawn-rulings.md")
    ).toContain("Surface parity");
  });

  it("never registers the re-check on a surface that cannot stamp a session", () => {
    // A stamp-less session is silent by construction, so a payload wiring
    // --hook without --session-start would ship a hook that can never speak:
    // green, installed, and inert. Read out of the generated payloads rather
    // than asserted per surface, so a payload added later is audited too.
    const manifests = [
      "plugins/lisa/.claude-plugin/plugin.json",
      "plugins/lisa/.codex-plugin/hooks.json",
      "plugins/lisa-cursor/hooks/hooks.json",
      "plugins/lisa-copilot/.claude-plugin/plugin.json",
    ];
    for (const file of manifests) {
      const text = read(file);
      if (!text.includes(HOOK_ARG)) continue;
      expect(text, file).toContain(START_ARG);
    }
    expect(manifests.filter(file => read(file).includes(HOOK_ARG)).length).toBe(
      manifests.length
    );
  });

  it("binds the ledger to git's union driver in the repo and in what hosts receive", () => {
    // Independent of the renderer's own byte-equality test, which cannot catch
    // the mapping being dropped: it compares the file to the function that
    // produced it. A retraction lost to a default line merge is the one
    // failure this ledger exists to make impossible.
    for (const file of [".gitattributes", "all/copy-contents/.gitattributes"]) {
      expect(read(file), file).toContain(".lisa/WITHDRAWN.jsonl merge=union");
    }
  });

  it("ships beside its own companion in every payload that carries base PostToolUse hooks", () => {
    // Keyed on failure-signature-index.sh — the other base PostToolUse hook —
    // rather than on a hardcoded roster, so a payload added later is audited
    // without anyone remembering to add it here. Stack plugins carry their own
    // hooks/ and are correctly excluded.
    const payloads = fs
      .readdirSync(path.join(REPO_ROOT, "plugins"))
      .filter(name =>
        fs.existsSync(
          path.join(
            REPO_ROOT,
            "plugins",
            name,
            "hooks",
            "failure-signature-index.sh"
          )
        )
      );
    expect(payloads.length).toBeGreaterThan(0);
    for (const name of payloads) {
      for (const file of ["withdrawn-rulings.sh", "withdrawn-rulings.mjs"]) {
        expect(
          fs.existsSync(path.join(REPO_ROOT, "plugins", name, "hooks", file)),
          `${name}/hooks/${file}`
        ).toBe(true);
      }
    }
  });
});
