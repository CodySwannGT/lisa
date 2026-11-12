/**
 * Did a worker's first prompt run? Read from the session's transcript.
 *
 * A worker is started with one prompt, `/lisa:implement <REF> managedBy=…`.
 * Two machine setup gaps stop that prompt from ever running, and both leave
 * the session idle with zero assistant turns while `claude agents --json`
 * shows nothing wrong (lisa#4503):
 *
 * - **unknown-command**: Claude Code in that repo does not know the command
 *   (Lisa's plugin is not visible there, e.g. a fresh clone whose
 *   dependencies were never installed). Claude Code 2.1.319 writes a `system`
 *   entry `Unknown command: /lisa:implement`.
 * - **prompt-blocked**: a `UserPromptSubmit` hook refused the prompt. The
 *   `system` entry reads `UserPromptSubmit operation blocked by hook: …` and
 *   carries `promptSubmitEnding.ending.kind: "blocked_by_hook"` with the
 *   hook's reason.
 *
 * Retrying the item can never fix either one, so the manager must see them as
 * setup gaps, not as a worker that is still working. The transcript lives at
 * `<config dir>/projects/<cwd, every non-alphanumeric character as "-">/
 * <full session id>.jsonl`; Claude Code files a symlinked cwd under its real
 * path. Only `system` entries count as the failure, so text a user or the
 * model typed can never trip it, and any assistant turn proves the worker is
 * alive. A missing transcript gives no verdict — never a failure.
 * @module session-manager/first-prompt
 */
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

/** `Unknown command: /<name>` as Claude Code words it. */
const UNKNOWN_COMMAND = /^Unknown command: (\/\S+)/;

/** The hook refusal's message text, for a transcript without the ending. */
const PROMPT_BLOCKED =
  /^UserPromptSubmit operation blocked by hook:\s*\n?([^\n]*)/;

/** Default wait for the first prompt to resolve after `claude --bg`. */
export const FIRST_PROMPT_WINDOW_MS = 30_000;

/** How often the transcript is re-read while waiting. */
export const FIRST_PROMPT_INTERVAL_MS = 1_000;

/**
 * Parse transcript JSONL, skipping blank lines and a half-written last line.
 * @param {string} text - File contents
 * @returns {object[]} Entries
 */
export function parseTranscript(text) {
  return String(text)
    .split("\n")
    .filter(line => line.trim() !== "")
    .flatMap(line => {
      try {
        const entry = JSON.parse(line);
        return entry !== null && typeof entry === "object" ? [entry] : [];
      } catch {
        return [];
      }
    });
}

/**
 * The first-prompt failure one `system` entry records, if any.
 * @param {object} entry - Transcript entry
 * @returns {{kind: "unknown-command"|"prompt-blocked", detail: string} | null}
 *   Failure
 */
function entryFailure(entry) {
  if (entry.type !== "system") return null;
  const content = typeof entry.content === "string" ? entry.content : "";
  const unknown = UNKNOWN_COMMAND.exec(content);
  if (unknown) return { kind: "unknown-command", detail: unknown[1] };
  const ending = entry.promptSubmitEnding?.ending;
  if (ending?.kind === "blocked_by_hook") {
    return { kind: "prompt-blocked", detail: String(ending.reason ?? "") };
  }
  const blocked = PROMPT_BLOCKED.exec(content);
  return blocked ? { kind: "prompt-blocked", detail: blocked[1].trim() } : null;
}

/**
 * Judge a transcript: alive once any assistant turn exists; failed when,
 * with no assistant turn, a `system` entry records a first-prompt failure;
 * neither while the first prompt has not resolved yet.
 * @param {object[]} entries - Parsed transcript
 * @returns {{alive: boolean, failure: {kind: string, detail: string} | null}}
 *   Verdict
 */
export function firstPromptVerdict(entries) {
  // One pass that stops at the first assistant turn: a long, healthy
  // transcript is read only up to the worker's first reply.
  let failure = null;
  for (const entry of entries) {
    if (entry.type === "assistant") return { alive: true, failure: null };
    failure ??= entryFailure(entry);
  }
  return { alive: false, failure };
}

/**
 * The first-prompt failure a transcript records, or null (including for any
 * transcript with an assistant turn).
 * @param {object[]} entries - Parsed transcript
 * @returns {{kind: "unknown-command"|"prompt-blocked", detail: string} | null}
 *   Failure
 */
export function detectFirstPromptFailure(entries) {
  return firstPromptVerdict(entries).failure;
}

/**
 * Claude Code's config dir: `CLAUDE_CONFIG_DIR`, else `<home>/.claude`.
 * @param {Record<string, string | undefined>} env - Environment
 * @param {string} homedir - Home directory
 * @returns {string} Absolute path
 */
export function claudeConfigDir(env, homedir) {
  return env.CLAUDE_CONFIG_DIR || path.join(homedir, ".claude");
}

/**
 * The `projects/` subdirectory name Claude Code uses for a cwd.
 * @param {string} cwd - Session cwd
 * @returns {string} Encoded name
 */
export function encodeProjectDir(cwd) {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

/**
 * The cwd and, when different, its real path.
 * @param {string} cwd - Session cwd
 * @returns {string[]} Candidates
 */
function cwdCandidates(cwd) {
  try {
    const real = realpathSync(cwd);
    return real === cwd ? [cwd] : [cwd, real];
  } catch {
    return [cwd];
  }
}

/**
 * Transcript files in one project dir whose name matches the session id.
 * @param {string} dir - Project dir
 * @param {string} id - Full or short (8-hex) session id, lowercase
 * @returns {string[]} Matching paths
 */
function matchesIn(dir, id) {
  try {
    return readdirSync(dir)
      .filter(
        name =>
          name === `${id}.jsonl` ||
          (name.startsWith(`${id}-`) && name.endsWith(".jsonl"))
      )
      .map(name => path.join(dir, name));
  } catch {
    return [];
  }
}

/**
 * Locate a session's transcript by full id, or by the short id
 * `claude --bg` prints (a full id starts with it).
 * @param {{configDir: string, cwd: string, sessionId: string | null | undefined}} input
 *   - Where to look
 * @returns {string | null} The one matching file, or null when there is none
 *   or more than one
 */
export function findTranscript({ configDir, cwd, sessionId }) {
  const id = String(sessionId ?? "").toLowerCase();
  if (!/^[0-9a-f]{8}(?:-[0-9a-f-]{27})?$/.test(id)) return null;
  const found = cwdCandidates(cwd).flatMap(candidate =>
    matchesIn(path.join(configDir, "projects", encodeProjectDir(candidate)), id)
  );
  const unique = [...new Set(found)];
  return unique.length === 1 ? unique[0] : null;
}

/**
 * Read a session's first-prompt verdict, or null when there is no transcript
 * to read.
 * @param {{configDir: string, cwd: string, sessionId: string | null | undefined}} input
 *   - Where to look
 * @returns {ReturnType<typeof firstPromptVerdict> | null} Verdict
 */
export function readFirstPrompt(input) {
  const file = findTranscript(input);
  if (file === null) return null;
  try {
    return firstPromptVerdict(parseTranscript(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/**
 * Re-read the transcript until the first prompt resolves (alive or failed)
 * or `windowMs` runs out. A zero window reads once.
 * @param {{configDir: string, cwd: string, sessionId: string | null | undefined,
 *   windowMs: number, intervalMs: number, sleep: (ms: number) => Promise<void>}} input
 *   - Where to look, how long to wait, and the sleep seam
 * @returns {Promise<ReturnType<typeof firstPromptVerdict> | null>} The
 *   resolved verdict, or null when it never resolved
 */
export async function awaitFirstPrompt({
  windowMs,
  intervalMs,
  sleep,
  ...where
}) {
  const rounds = Math.max(0, Math.ceil(windowMs / Math.max(1, intervalMs)));
  for (let round = 0; ; round += 1) {
    const verdict = readFirstPrompt(where);
    if (verdict?.alive || verdict?.failure) return verdict;
    if (round >= rounds) return null;
    await sleep(Math.min(intervalMs, windowMs));
  }
}
