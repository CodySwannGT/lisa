/** Real hook continuation and isolated preparatory/hook journals. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { boundedSpawnSync } from "./io-latency-budget.js";
import type { TaskOperation } from "./task-readiness-tools.js";
const ACCESS = "skills/lisa-secrets-access/scripts";
const KEYS = ["claim", "branch", "code", "external"] as const;

/** Reset recorders and the preparatory journal before a real call.
 * @param root - Owned fixture root.
 * @param calls - Safe operation journal.
 * @param cwd - Requested native cwd.
 * @returns The actual working directory.
 */
function prepareInput(root: string, calls: string, cwd: string): string {
  recorders(root);
  writeFileSync(calls, "");
  return cwd;
}
/** End one journal phase before beginning the hook-owned phase.
 * @param file - Safe journal file.
 * @returns The complete prior phase.
 */
function takeJournal(file: string): TaskOperation[] {
  const rows = readCalls(file);
  writeFileSync(file, "");
  return rows;
}

/** Read the safe operation inventory.
 * @param file - Fixture log location.
 * @returns Ordered fixed operation names.
 */
function readCalls(file: string): TaskOperation[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

/** Increment real state only after an allowed native continuation.
 * @param root - Owned fixture root.
 */
function mutate(root: string): void {
  for (const key of KEYS) {
    const file = path.join(root, `${key}-mutation.json`);
    const prior = JSON.parse(readFileSync(file, "utf8")).calls;
    writeFileSync(file, JSON.stringify({ calls: prior + 1 }));
  }
}

/** Reset actual recorders before one observed action.
 * @param root - Owned fixture root.
 * @returns Root for the ensuing action.
 */
function recorders(root: string): string {
  KEYS.forEach(key =>
    writeFileSync(path.join(root, `${key}-mutation.json`), '{"calls":0}')
  );
  return root;
}

/** Drive the canonical hook, then observe actual continuation state.
 * @param root - Owned project root.
 * @param plugin - Installed fixture plugin.
 * @param env - Isolated child environment.
 * @param event - Native event name.
 * @param tool - Native tool name.
 * @param workingDirectory - Actual native cwd, including nested project folders.
 * @returns Hook result, source proof, ordered calls and measured state.
 */
export function driveTask(
  root: string,
  plugin: string,
  env: Record<string, string>,
  event = "PreToolUse",
  tool = "Write",
  workingDirectory = root
) {
  const calls = path.join(root, "calls.jsonl");
  const cwd = prepareInput(root, calls, workingDirectory);
  const resolution = boundedSpawnSync({
    label: "task API source proof",
    command: process.execPath,
    args: [
      path.join(plugin, ACCESS, "resolve-secret.mjs"),
      "get",
      "GITGUARDIAN_API_KEY",
    ],
    cwd,
    env,
  });
  const preparatoryJournal = takeJournal(calls);
  const result = boundedSpawnSync({
    label: "task readiness real continuation",
    command: "/bin/bash",
    args: [path.join(plugin, "hooks/secrets-preflight.sh")],
    cwd,
    env,
    input: JSON.stringify({
      hook_event_name: event,
      cwd,
      session_id: "synthetic-session",
      tool_name: tool,
      tool_input: {
        file_path: path.join(root, "product.txt"),
        content: "synthetic",
      },
    }),
  });
  const nativeHandoff = String(result.stderr).includes(
    "NATIVE_OWNER_REQUIRED:"
  );
  const continuation =
    result.status === 0 && event === "PreToolUse" ? mutate(root) : undefined;
  const counters = Object.fromEntries(
    KEYS.map(key => [
      key,
      JSON.parse(readFileSync(path.join(root, `${key}-mutation.json`), "utf8"))
        .calls,
    ])
  );
  const journal = readCalls(calls);
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    counters,
    continuation,
    ordered: journal.map(row => row.label),
    preparatoryOrdered: preparatoryJournal.map(row => row.label),
    journal,
    preparatoryJournal,
    nativeHandoff,
    taskUnproven: resolution.status !== 0,
    setupFailure: /ERR_MODULE_NOT_FOUND|Cannot find module/.test(
      String(result.stderr) + String(resolution.stderr)
    ),
  };
}
