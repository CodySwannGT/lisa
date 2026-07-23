/**
 * Host opt-out for the project-learnings union merge driver.
 *
 * `lisa apply` registers the driver automatically, and the TypeScript stack
 * wires `lisa apply` into `postinstall` — so an ordinary `npm install` writes
 * `merge.lisa-learnings.driver` into `.git/config` with no separate human step.
 * That is not an escalation over `npm install` itself, which already runs
 * arbitrary code, but it does persist an executable hook that fires on ordinary
 * git operations for as long as the clone exists, outside npm's lifecycle. A
 * host that would rather not carry that hook needs a way to say so.
 *
 * This reads `.lisa.config.json` directly rather than extending the validated
 * `ProjectConfig` schema: `project-config.ts` sits exactly at its 300-line lint
 * cap, and forcing an extraction of its cross-cutting learnings validators to
 * make room would be a far larger change than this flag warrants. Keeping the
 * flag beside the feature it governs also means the driver's opt-out is
 * readable in one place.
 *
 * Opt-out only, and strictly `=== false`: absent, malformed, or non-boolean
 * values all leave the driver enabled, matching the zero-configuration default
 * every other Lisa guardrail uses. A malformed config must not silently disable
 * a data-integrity guard.
 * @module core/learnings-merge-driver-config
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";

const CONFIG_FILE = ".lisa.config.json";

/**
 * Read one inert own property without invoking an accessor.
 * @param candidate - Value to inspect
 * @param key - Property name to read
 * @returns The own data value, when present
 */
function readOwn(candidate: unknown, key: string): unknown {
  if (candidate === null || typeof candidate !== "object") {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
}

/**
 * Whether this project accepts the merge-driver registration.
 * @param projectRoot - Host project directory
 * @returns False only when `learnings.mergeDriver` is explicitly `false`
 */
export async function isLearningsMergeDriverEnabled(
  projectRoot: string
): Promise<boolean> {
  try {
    const raw = await readFile(path.join(projectRoot, CONFIG_FILE), "utf8");
    const learnings = readOwn(JSON.parse(raw) as unknown, "learnings");
    return readOwn(learnings, "mergeDriver") !== false;
  } catch {
    return true;
  }
}
