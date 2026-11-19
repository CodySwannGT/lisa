/**
 * The commands Lisa has written into an agent's hook configuration.
 *
 * Lisa 6.2.0 wrote a command whose refusal for a missing carrier exited
 * without reading the event the agent hands it, which fails the agent's
 * write with EPIPE whenever it loses the race to the exit. The command now
 * reads the event first. A repository that holds the 6.2.0 command must have
 * it replaced, never a second hook added beside it, so the 6.2.0 text is
 * written here by hand rather than computed by the code under test.
 */
import { describe, expect, it } from "vitest";

import {
  agentHookCommand,
  agentHookCommandsWritten,
} from "../../../src/controls/carrier-agent-script.js";
import { mergeHookEntry } from "../../../src/controls/carrier-agent-settings.js";
import { AGENT_SURFACES } from "../../../src/controls/carrier-agent-surfaces.js";

/** What Lisa 6.2.0 wrote for each agent whose hooks share a settings file. */
const WRITTEN_BY_6_2_0 = {
  claude:
    'f="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.lisa/hooks/post-tool"; [ -f "$f" ] || { echo "Write refused: $f is missing, so the checks this repository declares for a file write cannot run. Run: lisa controls install-carriers --agents=claude" >&2; exit 2; }; exec sh "$f" claude',
  cursor:
    'f="${CURSOR_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.lisa/hooks/post-tool"; [ -f "$f" ] || { printf \'%s\\n\' \'{"additional_context":"Write refused: .lisa/hooks/post-tool is missing, so the checks this repository declares for a file write cannot run. Run: lisa controls install-carriers --agents=cursor"}\'; exit 0; }; exec sh "$f" cursor',
  devin:
    'f="${DEVIN_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.lisa/hooks/post-tool"; [ -f "$f" ] || { echo "Write refused: $f is missing, so the checks this repository declares for a file write cannot run. Run: lisa controls install-carriers --agents=devin" >&2; exit 2; }; exec sh "$f" devin',
} as const;

const AGENTS = Object.keys(WRITTEN_BY_6_2_0) as Array<
  keyof typeof WRITTEN_BY_6_2_0
>;

describe("the command an agent's hook runs", () => {
  it.each(AGENTS)(
    "reads %s's event before refusing for a missing carrier",
    agent => {
      const command = agentHookCommand(agent);
      const refusal = command.slice(command.indexOf("|| {"));

      expect(refusal.indexOf("cat >/dev/null")).toBeGreaterThan(-1);
      expect(refusal.indexOf("cat >/dev/null")).toBeLessThan(
        refusal.indexOf("exit ")
      );
    }
  );

  it.each(AGENTS)("counts what 6.2.0 wrote for %s as Lisa's", agent => {
    expect(agentHookCommandsWritten(agent)).toEqual([
      agentHookCommand(agent),
      WRITTEN_BY_6_2_0[agent],
    ]);
  });

  it.each(AGENTS)(
    "replaces what 6.2.0 wrote for %s instead of adding a second hook",
    agent => {
      const surface = AGENT_SURFACES[agent];
      if (!surface.refuses || surface.registration.kind !== "merged") {
        throw new Error(`${agent} is not merged into a settings file`);
      }
      const registration = surface.registration;
      const old = mergeHookEntry(null, registration, [WRITTEN_BY_6_2_0[agent]]);
      if (old.problem !== null) throw new Error(old.problem);

      const merged = mergeHookEntry(
        old.text,
        registration,
        agentHookCommandsWritten(agent)
      );
      if (merged.problem !== null) throw new Error(merged.problem);

      expect(merged.state).toBe("replaced");
      expect(merged.text).not.toContain(
        JSON.stringify(WRITTEN_BY_6_2_0[agent])
      );
      expect(
        merged.text.split(JSON.stringify(agentHookCommand(agent)))
      ).toHaveLength(2);
    }
  );
});
