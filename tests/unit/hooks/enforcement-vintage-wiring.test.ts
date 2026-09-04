/**
 * Wiring suite for the session-vintage hook (CodySwannGT/lisa#3714).
 *
 * The behaviour suite proves the mechanism reports a stale copy. This one
 * proves it is REACHED — registered on the events that start a session, and
 * present in every shipped plugin payload whose harness has such an event. The
 * two are separate failures with the same green: a correct renderer that no
 * event fires is exactly the shape of a guard that reports success while inert,
 * and this repository produced eight of those in one day.
 * @module tests/unit/hooks/enforcement-vintage-wiring.test
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { shouldShipScript } from "../../../scripts/lib/per-agent-hook-filter.mjs";

/** The shipped wrapper's basename, as every manifest spells it. */
const SCRIPT = "enforcement-vintage.sh";
/** The renderer that ships beside it. */
const RENDERER = "enforcement-vintage.mjs";
/** Directory holding the generated per-agent plugin payloads. */
const PLUGINS = "plugins";
/** Directory each payload keeps its hook scripts in. */
const HOOKS = "hooks";
/** The Copilot variant's manifest, read for its event coverage. */
const COPILOT_MANIFEST = "plugins/lisa-copilot/.claude-plugin/plugin.json";
/** Events a session opens with. Both must fire, or subagents go untold. */
const SESSION_EVENTS = ["SessionStart", "SubagentStart"] as const;
/** The agent slugs the ship-list is keyed by. */
type Agent = "claude" | "codex" | "cursor" | "agy" | "copilot";
/** Which agents receive this hook, and which are a documented gap. */
const FAN_OUT: readonly (readonly [Agent, boolean])[] = [
  ["claude", true],
  ["codex", true],
  ["cursor", true],
  ["copilot", true],
  // agy has no session-start event at all, so it cannot receive this. The
  // compensating rung is shared rather than agent-layer: the Bash enforcement
  // dispatcher names the producing copy and its vintage in every refusal, and
  // `lisa doctor` reports the same resolution on every agent.
  ["agy", false],
];

/** A single registered hook command, as the plugin manifests carry it. */
type HookEntry = { type?: string; command?: string };
/** One matcher block, holding the commands it fires. */
type HookMatcher = { matcher?: string; hooks?: HookEntry[] };
/** Event name to its matcher blocks. */
type HookMap = Record<string, HookMatcher[] | undefined>;

/**
 * Every hook command a manifest registers for one event.
 * @param file - Manifest path
 * @param event - Hook event name
 * @param key - Property holding the hook map ("hooks" for both shapes)
 * @returns The registered commands
 */
function commandsFor(file: string, event: string, key = "hooks"): string[] {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<
    string,
    unknown
  >;
  const hooks = (parsed[key] ?? {}) as HookMap;
  return (hooks[event] ?? []).flatMap(matcher =>
    (matcher.hooks ?? []).map(hook => hook.command ?? "")
  );
}

describe("enforcement-vintage: registration", () => {
  it.each(SESSION_EVENTS)("is registered on %s in the plugin source", event => {
    const commands = commandsFor(
      "plugins/src/base/.claude-plugin/plugin.json",
      event
    );

    expect(commands).toContain(`\${CLAUDE_PLUGIN_ROOT}/hooks/${SCRIPT}`);
  });

  it.each(SESSION_EVENTS)(
    "survives the build into the Claude plugin on %s",
    event => {
      const commands = commandsFor(
        "plugins/lisa/.claude-plugin/plugin.json",
        event
      );

      expect(commands).toContain(`\${CLAUDE_PLUGIN_ROOT}/hooks/${SCRIPT}`);
    }
  );

  it.each(SESSION_EVENTS)("reaches the Codex payload on %s", event => {
    const commands = commandsFor(
      "plugins/lisa/.codex-plugin/hooks.json",
      event
    );

    expect(commands).toContain(`\${PLUGIN_ROOT}/hooks/${SCRIPT}`);
  });
});

describe("enforcement-vintage: agent fan-out", () => {
  it.each(FAN_OUT)("ships to %s: %s", (agent, expected) => {
    expect(shouldShipScript(SCRIPT, agent)).toBe(expected);
  });

  it.each(["lisa", "lisa-cursor", "lisa-copilot"])(
    "materializes both files into the %s payload",
    plugin => {
      expect(existsSync(path.join(PLUGINS, plugin, HOOKS, SCRIPT))).toBe(true);
      // The wrapper alone is inert: it exits 0 when the renderer is absent, so
      // a payload carrying only the script would be silent rather than broken.
      expect(existsSync(path.join(PLUGINS, plugin, HOOKS, RENDERER))).toBe(
        true
      );
    }
  );

  it("reaches the Cursor payload on BOTH session events", () => {
    // Cursor's schema is flat per-event arrays under camelCase names, so the
    // Claude-shaped reader above cannot see it. Read as measured, not assumed:
    // the ship rule says "cursor: true" and says nothing about which events
    // survive the generator.
    const hooks = JSON.parse(
      readFileSync(
        path.join(PLUGINS, "lisa-cursor", HOOKS, "hooks.json"),
        "utf8"
      )
    ) as { hooks?: Record<string, { command?: string }[] | undefined> };
    const commandsOn = (event: string): string[] =>
      (hooks.hooks?.[event] ?? []).map(entry => entry.command ?? "");

    expect(commandsOn("sessionStart")).toContain(
      `\${CURSOR_PLUGIN_ROOT}/hooks/${SCRIPT}`
    );
    expect(commandsOn("subagentStart")).toContain(
      `\${CURSOR_PLUGIN_ROOT}/hooks/${SCRIPT}`
    );
  });

  it("reaches a Copilot SESSION but not a Copilot SUB-AGENT", () => {
    // Copilot has no SubagentStart event, so its sub-agents are never told
    // their vintage. That is a documented gap, and pinning it here is what
    // keeps the wiki row honest — the ship rule is a flat per-agent boolean and
    // cannot express it, which is exactly how the row came to overstate the
    // coverage in the first place.
    const hooks = JSON.parse(readFileSync(COPILOT_MANIFEST, "utf8")) as {
      hooks?: Record<string, unknown>;
    };
    const sessionCommands = commandsFor(COPILOT_MANIFEST, "sessionStart");

    expect(sessionCommands).toContain(`\${CLAUDE_PLUGIN_ROOT}/hooks/${SCRIPT}`);
    expect(Object.keys(hooks.hooks ?? {})).not.toContain("subagentStart");
  });

  it("stays out of the agy payload, matching its ship rule", () => {
    expect(existsSync(path.join(PLUGINS, "lisa-agy", HOOKS, SCRIPT))).toBe(
      false
    );
  });
});
