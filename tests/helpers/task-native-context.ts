/** One actual Write envelope: the fixed metadata owner acts, raw Write never does. */
import path from "node:path";
import { writeFileSync } from "node:fs";
import { taskFixture } from "./task-readiness-fixture.js";
import { boundedSpawnSync } from "./io-latency-budget.js";
/** Drive exact native data and observe denial plus any owner-side context change.
 * @param f - Owned installed fixture.
 * @param content - Full canonical requirements header and private body.
 * @param file - Native target path.
 * @returns Actual guard, unchanged request and raw-writer counter.
 */
export function nativeWrite(
  f: ReturnType<typeof taskFixture>,
  content: string,
  file = path.join(f.root, ".lisa/work-item-context.md")
) {
  const request = {
    hook_event_name: "PreToolUse",
    cwd: f.root,
    session_id: "fresh-intake",
    tool_use_id: "metadata-call",
    tool_name: "Write",
    tool_input: { file_path: file, content },
  };
  const guard = boundedSpawnSync({
    label: "one native Write metadata request",
    command: "/bin/bash",
    args: [path.join(f.plugin, "hooks/secrets-preflight.sh"), "--task-hook"],
    cwd: f.root,
    env: f.env,
    input: JSON.stringify(request),
  });
  if (guard.status === 0) {
    writeFileSync(file, content);
  }
  return { request, guard, rawWrites: guard.status === 0 ? 1 : 0 };
}
