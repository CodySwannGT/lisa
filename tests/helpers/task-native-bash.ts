/** Native Bash has command, not a separate stdin field. */
import path from "node:path";
import { boundedSpawnSync } from "./io-latency-budget.js";
import { taskFixture } from "./task-readiness-fixture.js";
/** Drive the actual guard and only execute the exact same allowed command.
 * @param f - Isolated installed owner.
 * @param command - Native command string, including literal stdin transport.
 * @returns Guard and optional actual tool outcome.
 */
export function nativeBash(f: ReturnType<typeof taskFixture>, command: string) {
  const request = {
    hook_event_name: "PreToolUse",
    cwd: f.root,
    session_id: "fresh-intake",
    tool_use_id: "intake-call",
    tool_name: "Bash",
    tool_input: { command },
  };
  const guard = boundedSpawnSync({
    label: "native Bash before",
    command: "/bin/bash",
    args: [path.join(f.plugin, "hooks/secrets-preflight.sh"), "--task-hook"],
    cwd: f.root,
    env: f.env,
    input: JSON.stringify(request),
  });
  const tool =
    guard.status === 0
      ? boundedSpawnSync({
          label: "same native Bash tool request",
          command: "/bin/bash",
          args: ["-c", command],
          cwd: f.root,
          env: f.env,
        })
      : null;
  return { guard, tool, request };
}
