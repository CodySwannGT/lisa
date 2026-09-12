/**
 * Wiring for the operational-hazard ledger (CodySwannGT/lisa#3681).
 *
 * The whole point of the surface is that nobody has to go looking for it —
 * that is the defect it exists against. So these assert the readers: delivery
 * on both start events, which is the half a fan-out structurally cannot serve;
 * the PostToolUse re-check, which is the only thing that reaches a session
 * already running; the gate that stops the ledger rotting; the union merge that
 * stops a concurrent branch dropping a hazard; and the eager rule that carries
 * the manual read for surfaces with no hook runtime.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const HOOK_MJS = "plugins/src/base/hooks/operational-hazards.mjs";
const MANIFEST = "plugins/src/base/.claude-plugin/plugin.json";
const HOOK_SH = "operational-hazards.sh";
const HOOK_ARG = `${HOOK_SH} --hook`;
const START_ARG = `${HOOK_SH} --session-start`;
const GATE = "x-operational-hazards";
const SCRIPT = "check:operational-hazards";
const EAGER = "plugins/src/base/rules/eager/operational-hazards.md";
const LEDGER = ".lisa/HAZARDS.jsonl";

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

describe("operational-hazards — how it gets read", () => {
  it.each(["SessionStart", "SubagentStart"])(
    "delivers applying hazards to a %s that began after they were declared",
    event => {
      // SubagentStart is the one a fan-out never reaches at all, so it is not
      // a bonus surface here — it is half the reason the mechanism beats a
      // broadcast rather than merely matching one.
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
    expect(pkg.scripts[SCRIPT]).toContain(HOOK_MJS);
    const config = readJson(".lisa.config.json") as {
      gates: Record<string, { push?: { level?: string; run?: string } }>;
    };
    expect(config.gates[GATE]?.push?.run).toBe(SCRIPT);
    expect(config.gates[GATE]?.push?.level).toBe("required");
  });

  it("carries both commands in the eager rule, for surfaces with no hook runtime", () => {
    const eager = read(EAGER);
    expect(eager).toContain("--declare");
    expect(eager).toContain("--lift");
    expect(eager).toContain("--list");
    // The expiry is the whole mechanism; a rule that mentions the surface
    // without it invites the permanent-scripture failure back.
    expect(eager).toContain("--until");
    expect(
      read("plugins/src/base/rules/reference/operational-hazards.md")
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
    // A hazard lost to a default line merge is a session not told about the
    // collision it is about to cause — the one failure this ledger exists to
    // make impossible.
    for (const file of [".gitattributes", "all/copy-contents/.gitattributes"]) {
      expect(read(file), file).toContain(`${LEDGER} merge=union`);
    }
  });

  it("ships beside its own companion in every payload that carries base PostToolUse hooks", () => {
    // Keyed on failure-signature-index.sh — another base PostToolUse hook —
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
      for (const file of [HOOK_SH, "operational-hazards.mjs"]) {
        expect(
          fs.existsSync(path.join(REPO_ROOT, "plugins", name, "hooks", file)),
          `${name}/hooks/${file}`
        ).toBe(true);
      }
    }
  });

  it("is never a managed path, so an apply can neither overwrite nor delete it", () => {
    // The ticket names this risk directly: postinstall reconciliation deletes
    // host-authored files at DECLARED paths without consulting content, so a
    // project-owned surface a later apply removed would be worse than none —
    // projects would trust it. The proof is absence from both halves: nothing
    // is delivered to the path, and no deletion manifest declares it.
    const stacks = fs
      .readdirSync(REPO_ROOT, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
      .map(entry => entry.name);
    for (const stack of stacks) {
      const manifest = path.join(REPO_ROOT, stack, "deletions.json");
      if (fs.existsSync(manifest)) {
        expect(fs.readFileSync(manifest, "utf-8"), manifest).not.toContain(
          LEDGER
        );
      }
      for (const strategy of [
        "copy-contents",
        "copy-overwrite",
        "merge",
        "create-only",
      ]) {
        expect(
          fs.existsSync(path.join(REPO_ROOT, stack, strategy, LEDGER)),
          `${stack}/${strategy}/${LEDGER}`
        ).toBe(false);
      }
    }
  });

  it("keeps this repository's own ledger free of an entry that can never expire", () => {
    // The executable half of the precedent CodySwannGT/lisa#3856 set: a stale
    // or unevaluable entry fails a test rather than waiting to be noticed.
    // Absent is the normal state — the ledger drains itself.
    const ledger = path.join(REPO_ROOT, LEDGER);
    if (!fs.existsSync(ledger)) return;
    const lines = fs
      .readFileSync(ledger, "utf-8")
      .split("\n")
      .filter(line => line.trim() !== "");
    for (const line of lines) {
      const record = JSON.parse(line) as { lift?: boolean; until?: string };
      if (record.lift === true) continue;
      expect(record.until, line).toBeTypeOf("string");
    }
  });
});
