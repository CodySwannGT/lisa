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
/** Events a session opens with. Both must fire, or subagents go untold. */
const SESSION_EVENTS = ["SessionStart", "SubagentStart"] as const;

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
  it.each([
    ["claude", true],
    ["codex", true],
    ["cursor", true],
    ["copilot", true],
    // agy has no session-start event at all, so it cannot receive this. The
    // compensating rung is shared rather than agent-layer: the Bash enforcement
    // dispatcher names the producing copy and its vintage in every refusal, and
    // `lisa doctor` reports the same resolution on every agent.
    ["agy", false],
  ])("ships to %s: %s", (agent, expected) => {
    expect(shouldShipScript(SCRIPT, agent as string)).toBe(expected);
  });

  it.each(["lisa", "lisa-cursor", "lisa-copilot"])(
    "materializes both files into the %s payload",
    plugin => {
      expect(existsSync(path.join("plugins", plugin, "hooks", SCRIPT))).toBe(
        true
      );
      // The wrapper alone is inert: it exits 0 when the renderer is absent, so
      // a payload carrying only the script would be silent rather than broken.
      expect(existsSync(path.join("plugins", plugin, "hooks", RENDERER))).toBe(
        true
      );
    }
  );

  it("stays out of the agy payload, matching its ship rule", () => {
    expect(existsSync(path.join("plugins", "lisa-agy", "hooks", SCRIPT))).toBe(
      false
    );
  });
});
