/**
 * The two confined project reads every deterministic probe is built on.
 *
 * Both preserve a distinction the checks above them depend on and cannot
 * recover once lost: a settings file that is MISSING is a different finding
 * from one that is present and unreadable, and a JSON file that will not parse
 * is a different finding from one that is not there. Collapsing either into
 * "absent" is how a health run reports a clean project that it simply could
 * not read.
 * @module health/deterministic-inputs
 */
import type { SyncReadDependencies } from "../sync/config-sync.js";
import type { HealthConfigState } from "./project-probes.js";
import type { RulesetReader } from "./ruleset-inspection.js";
import {
  projectPathKind,
  readProjectJsonObject,
  readProjectText,
} from "./read-only-fs.js";

/**
 * Read config while preserving missing vs malformed state.
 * @param projectRoot - Canonical host project root
 * @returns Whether the settings file is present, readable, and its contents
 */
export async function loadConfigState(
  projectRoot: string
): Promise<HealthConfigState> {
  const kind = await projectPathKind(projectRoot, ".lisa.config.json");
  if (kind === "missing") {
    return { config: {}, present: false, readable: false };
  }
  if (kind !== "file") {
    return { config: {}, present: true, readable: false };
  }
  try {
    const config = await readProjectJsonObject(
      projectRoot,
      ".lisa.config.json"
    );
    return { config: config ?? {}, present: true, readable: true };
  } catch {
    return { config: {}, present: true, readable: false };
  }
}

/**
 * Confined JSON/path readers for the shared sync planner.
 * @param projectRoot - Canonical host project root
 * @returns Readers that never escape the project root
 */
export function safeSyncReads(projectRoot: string): SyncReadDependencies {
  return {
    readJson: async (relativePath: string) => {
      const text = await readProjectText(projectRoot, relativePath);
      if (text === undefined) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch (error) {
        if (error instanceof SyntaxError) return null;
        throw error;
      }
    },
    pathExists: async (relativePath: string) =>
      (await projectPathKind(projectRoot, relativePath)) !== "missing",
  };
}

/**
 * Share one ruleset read between the probes that both need it.
 *
 * Two checks now compare against the same live rulesets — one against Lisa's
 * template, one against the project's declarations — and reading them twice
 * would double a bounded N+1 of GitHub calls inside one shared deadline for an
 * answer that cannot differ between them. A rejection is shared too, on
 * purpose: both probes should report the same source as unread rather than
 * disagree about whether it could be reached.
 * @param reader - The underlying reader
 * @returns A reader that calls through at most once per repository
 */
export function shareRulesetReader(reader: RulesetReader): RulesetReader {
  const inFlight = new Map<string, ReturnType<RulesetReader>>();
  return (owner, repo, projectRoot, timeoutMs, signal) => {
    const key = `${owner}/${repo}`;
    const existing = inFlight.get(key);
    if (existing !== undefined) return existing;
    const started = reader(owner, repo, projectRoot, timeoutMs, signal);
    // eslint-disable-next-line functional/immutable-data -- the cache is the point
    inFlight.set(key, started);
    return started;
  };
}
