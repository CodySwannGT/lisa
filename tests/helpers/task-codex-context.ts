/** Exact Codex whole Add File data request, never a general patch executor. */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { taskFixture } from "./task-readiness-fixture.js";
import { boundedSpawnSync } from "./io-latency-budget.js";
/** Encode the documented Add File newline semantics.
 * @param target - Exact destination.
 * @param content - Complete file ending in LF.
 * @returns One complete patch string.
 */
export function contextPatch(target: string, content: string) {
  if (!content.endsWith("\n")) throw Error("Add File requires final LF");
  return `*** Begin Patch\n*** Add File: ${target}\n${content
    .slice(0, -1)
    .split("\n")
    .map(l => `+${l}`)
    .join("\n")}\n*** End Patch`;
}
/** Drive the actual portable guard and let only its before verdict govern raw effects.
 * @param f - Isolated owner fixture.
 * @param command - Actual patch data.
 * @returns Actual decision and raw-effect count.
 */
export function codexContext(
  f: ReturnType<typeof taskFixture>,
  command: string
) {
  const request = {
    cwd: f.root,
    session_id: "codex-context",
    tool_use_id: "patch-call",
    tool_name: "apply_patch",
    tool_input: { command },
  };
  const result = boundedSpawnSync({
    label: "documented Codex before command envelope",
    command: process.execPath,
    args: [path.join(f.plugin, "hooks/task-readiness-guard.mjs")],
    cwd: f.root,
    env: f.env,
    input: JSON.stringify(request),
  });
  if (result.status === 0)
    writeFileSync(path.join(f.root, "raw-patch-effect"), "1");
  return { request, result, rawPatchEffects: result.status === 0 ? 1 : 0 };
}
