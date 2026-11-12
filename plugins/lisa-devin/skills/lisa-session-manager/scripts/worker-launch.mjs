/**
 * Running `claude --bg` for `spawn` and `resume`, with the one failure that
 * is an operator setup step rather than a worker failure called out.
 *
 * Claude Code asks once per directory whether to trust the workspace. Until
 * someone has accepted that prompt in the repo dir, `claude --bg` there exits
 * 1 with (2.1.296) "Workspace not trusted. Run `claude` in <dir> once and
 * accept the trust prompt, then retry." A background session cannot show the
 * prompt, so retrying never helps: that refusal becomes exit 2 (setup) with
 * the exact step, and the manager skill escalates it instead of counting a
 * failed attempt. Every other failure keeps the exit-1 message `mustRun`
 * gives.
 *
 * A spawn that `claude --bg` accepted can still die on its first prompt: the
 * command is unknown in that repo, or a `UserPromptSubmit` hook refuses it
 * (lisa#4503). `confirmFirstPrompt` watches the new session's transcript for
 * a bounded window; a first-prompt failure stops the worker and becomes the
 * same exit 2, so the manager returns the item to Ready without counting an
 * attempt. A transcript that does not resolve in time is not a failure: the
 * spawn proceeds exactly as before and `classify` keeps watching.
 * @module session-manager/worker-launch
 */
import { CliError, EXIT, run } from "./cli-runtime.mjs";
import {
  FIRST_PROMPT_INTERVAL_MS,
  FIRST_PROMPT_WINDOW_MS,
  awaitFirstPrompt,
  claudeConfigDir,
} from "./first-prompt.mjs";

/** How claude words the refusal; matched loosely across versions. */
const UNTRUSTED_WORKSPACE = /workspace (?:is )?not trusted/i;

/**
 * Whether a failed `claude --bg` run was refused for workspace trust.
 * @param {{ stdout: string, stderr: string }} result - Run outcome
 * @returns {boolean} True for the trust refusal
 */
export function isUntrustedWorkspace(result) {
  return UNTRUSTED_WORKSPACE.test(`${result.stderr}\n${result.stdout}`);
}

/**
 * Run a worker spawn or resume spec and return its stdout.
 *
 * Runs the command exactly once: a failure is reported, never retried, so a
 * flaky refusal can never start a second worker.
 * @param {{ command: string, args: string[], cwd: string,
 *   env: Record<string, string | undefined> }} spec - From
 *   `buildWorkerSpawn` or `buildWorkerResume`
 * @returns {string} stdout
 */
export function runWorkerSession(spec) {
  const result = run(spec.command, spec.args, spec);
  if (result.missing) {
    throw new CliError(`${spec.command} is not on PATH.`, EXIT.FAILURE);
  }
  if (result.status === 0) return result.stdout;
  if (isUntrustedWorkspace(result)) {
    throw new CliError(
      `Claude Code's workspace trust has not been accepted in ${spec.cwd}, ` +
        `so claude --bg refused to start a worker there. This is a one-time ` +
        `step per repo: run \`claude\` once in ${spec.cwd}, accept the trust ` +
        `prompt, exit, then retry.`,
      EXIT.SETUP
    );
  }
  const detail = result.stderr.trim() || `exit ${result.status}`;
  throw new CliError(
    `${spec.command} ${spec.args[0] ?? ""} failed: ${detail}`,
    EXIT.FAILURE
  );
}

/** A full session UUID; the only id `--resume` continues in place. */
const FULL_SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The full session id for a ledger item, for `claude --bg --resume`.
 *
 * `claude --bg` prints an 8-character short id, and that is what the ledger
 * records. Given a short id, `--resume` (2.1.296) does not wake the session:
 * it starts a copy of the conversation under a new id and names it after the
 * message, which the manager cannot see. So a short id is mapped to the full
 * `sessionId` of the matching `claude agents --json --all` row, by worker
 * name or by short id.
 * @param {Array<{name: string|null, id: string|null, sessionId: string|null}>}
 *   agents - Normalized rows from `listAgents(ctx, { all: true })`
 * @param {{ worker?: string|null, sessionId?: string|null }} item - Ledger item
 * @returns {string | null} Full lowercase session id, or null when no row
 *   carries one
 */
export function resolveFullSessionId(agents, item) {
  const recorded = String(item?.sessionId ?? "").toLowerCase();
  if (FULL_SESSION_ID.test(recorded)) return recorded;
  const row = agents.find(
    agent =>
      FULL_SESSION_ID.test(agent.sessionId ?? "") &&
      ((item?.worker && agent.name === item.worker) ||
        (recorded !== "" &&
          (agent.id === recorded ||
            agent.sessionId.toLowerCase().startsWith(`${recorded}-`))))
  );
  return row ? row.sessionId.toLowerCase() : null;
}

/** Overrides the first-prompt wait, in milliseconds (0 reads once). */
const FIRST_PROMPT_ENV = "LISA_SESSION_MANAGER_FIRST_PROMPT_MS";

/**
 * The first-prompt wait: the env override when it is a whole number, else
 * the default.
 * @param {Record<string, string | undefined>} env - Environment
 * @returns {number} Milliseconds
 */
function firstPromptWindow(env) {
  const raw = env[FIRST_PROMPT_ENV];
  return raw !== undefined && /^\d+$/.test(raw)
    ? Number(raw)
    : FIRST_PROMPT_WINDOW_MS;
}

/**
 * The operator-readable reason a worker's first prompt never ran.
 * @param {{kind: string, detail: string}} failure - From the transcript
 * @param {string} repoDir - Where the worker started
 * @returns {string} Message
 */
export function firstPromptGapMessage(failure, repoDir) {
  const tail =
    "The worker was stopped; nothing was recorded and no attempt was " +
    "counted. Retrying cannot fix this until the repo is set up.";
  if (failure.kind === "unknown-command") {
    return (
      `The worker could not run ${failure.detail} in ${repoDir}: Claude Code ` +
      `there does not know that command, so Lisa's plugin is not visible in ` +
      `that repo (for example a fresh clone whose dependencies were never ` +
      `installed). Make Lisa available in ${repoDir}, then dispatch again. ${tail}`
    );
  }
  return (
    `A UserPromptSubmit hook in ${repoDir} rejected the worker's first ` +
    `prompt, so the worker never started. The hook said: ` +
    `"${failure.detail}". Fix or sign in to whatever that hook needs, then ` +
    `dispatch again. ${tail}`
  );
}

/**
 * Wait briefly for a new worker's first prompt to resolve. A failure stops
 * the worker (best effort) and throws exit 2; otherwise it reports whether
 * the worker was seen alive.
 * @param {{env: Record<string, string | undefined>, homedir: string}} ctx -
 *   CLI context
 * @param {{name: string, sessionId: string | null, repoDir: string,
 *   sleep?: (ms: number) => Promise<void>}} worker - The spawned worker
 * @returns {Promise<"alive" | "unconfirmed">} What the transcript showed
 */
export async function confirmFirstPrompt(
  ctx,
  { name, sessionId, repoDir, sleep }
) {
  const verdict = await awaitFirstPrompt({
    configDir: claudeConfigDir(ctx.env, ctx.homedir),
    cwd: repoDir,
    sessionId,
    windowMs: firstPromptWindow(ctx.env),
    intervalMs: FIRST_PROMPT_INTERVAL_MS,
    sleep: sleep ?? (ms => new Promise(done => setTimeout(done, ms))),
  });
  if (verdict?.failure) {
    // probe-direction: fail-open — a stop that fails leaves an idle session
    // holding nothing: no ledger row and no attempt, and exit 2 still lands.
    run("claude", ["stop", name], { env: ctx.env });
    throw new CliError(
      firstPromptGapMessage(verdict.failure, repoDir),
      EXIT.SETUP,
      { name, sessionId, repoDir, setupGap: verdict.failure }
    );
  }
  return verdict?.alive ? "alive" : "unconfirmed";
}
