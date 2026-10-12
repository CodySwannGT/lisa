#!/usr/bin/env node
/**
 * Send one unit of work to a remote execution surface, then get out of the way.
 *
 * `executionEnv` is **routing and nothing else**. The remote runs the identical
 * skill from the identical repository; only the machine differs. Keeping that
 * line bright is what stops the parameter from growing into a second
 * implementation that has to be kept in sync with the first.
 *
 * Dispatch is fire-and-record. `codex cloud exec` submits a task and returns —
 * measured at three and four seconds in two production runs whose tasks opened
 * pull requests roughly six minutes later, long after the dispatcher had exited.
 * So this records durable identifiers and stops. It does not poll, and it holds
 * nothing open: the operator's machine is a launcher, not the substrate, and
 * closing the lid must be harmless.
 *
 * Usage:
 *   dispatch.mjs 'executionEnv=codex-cloud SE-45434' --skill lisa-implement
 * @module dispatch
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { boundedChildOutput } from "../../lisa-setup-workstation/scripts/bounded-child.mjs";

/** Surfaces this dispatcher knows how to reach. `local` means "do not dispatch". */
export const EXECUTION_ENVS = new Set(["local", "codex-cloud", "claude-web"]);

/**
 * What each surface must have recorded before anything may dispatch to it.
 *
 * Not uniform, because the two surfaces do not bind the same way. A Codex Cloud
 * environment is bound to one repository, so naming both is what proves the
 * environment is the right one. A Claude cloud environment binds no repository
 * at all — it is account-scoped configuration and the repository arrives per
 * session — so its durable handle is the routine that dispatch fires.
 */
const SURFACE_PRECONDITIONS = {
  "codex-cloud": ["environmentId", "repository"],
  "claude-web": ["routineId", "fireUrl"],
};

/**
 * The beta this endpoint ships under.
 *
 * Dated and rotating: the two most recent previous versions keep working, so a
 * bump here is a migration with a window rather than a break. Stated once so
 * there is a single place to move it.
 */
const ROUTINE_BETA = "experimental-cc-routine-2026-04-01";

/**
 * How long to wait for the routine to accept the dispatch.
 *
 * `fetch` has no timeout of its own, so a routine endpoint that accepts the
 * connection and then says nothing leaves dispatch waiting forever — the one
 * failure mode that never reaches the error path below and never reaches the
 * operator either. Generous, because the endpoint only has to *accept* the
 * dispatch: the session's own work happens long after this call returns, so
 * this bounds a handshake rather than a run.
 */
const FIRE_TIMEOUT_MS = 30_000;

/** Where dispatched work is recorded so a later session can find it. */
const LEDGER = join(".lisa", "remote-dispatch.json");

/** This file's directory, for locating the sibling secrets skill. */
const HERE = dirname(fileURLToPath(import.meta.url));

/** Every parameter this program reads. Anything else is a typo. */
const KNOWN_PARAMS = new Set(["executionEnv"]);

/**
 * Split `key=value` parameters from the rest of an invocation.
 *
 * The remainder is passed through untouched. It is the caller's payload — a
 * ticket key, a description — and this program has no business interpreting it.
 *
 * A leading `--` is accepted and stripped. The bare form is the documented one,
 * but `--executionEnv=claude-web` is what anyone who has used a CLI this decade
 * types, and it previously fell through to the payload and left the surface at
 * its default. That is precisely the outcome this skill says it exists to
 * prevent: work runs locally while the operator believes it went remote, and
 * nothing downstream contradicts them.
 *
 * An unrecognised parameter is rejected for the same reason. A misspelled
 * `executionEnvv=claude-web` is indistinguishable from not asking at all, and
 * silence is the one response that cannot be acted on.
 * @param {string} input Raw argument string.
 * @returns {{params: Record<string, string>, rest: string}} Parsed invocation.
 */
export function parseInvocation(input) {
  const params = {};
  const rest = [];
  for (const token of String(input ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)) {
    const match = /^(--)?([A-Za-z][A-Za-z0-9_]*)=(.*)$/.exec(token);
    // Only a dashed token is required to be a known parameter. A bare `x=y` may
    // legitimately be part of a payload — a description, a query — and this
    // program has no business rejecting the caller's prose.
    if (match && (match[1] || KNOWN_PARAMS.has(match[2]))) {
      if (!KNOWN_PARAMS.has(match[2])) {
        throw new Error(
          `unknown parameter "${match[2]}".\n` +
            `Supported: ${[...KNOWN_PARAMS].join(", ")}.`
        );
      }
      params[match[2]] = match[3];
    } else rest.push(token);
  }
  return { params, rest: rest.join(" ") };
}

/**
 * Resolve the requested execution surface, rejecting anything unknown.
 *
 * Rejecting explicitly matters more than it looks. A silently ignored
 * `executionEnv` would run the work locally while the operator believes it went
 * remote, and nothing downstream would contradict that belief.
 * @param {Record<string, string>} params Parsed parameters.
 * @returns {string} A member of {@link EXECUTION_ENVS}.
 */
export function resolveExecutionEnv(params) {
  const requested = params.executionEnv ?? "local";
  if (!EXECUTION_ENVS.has(requested)) {
    throw new Error(
      `unknown executionEnv "${requested}".\n` +
        `Supported: ${[...EXECUTION_ENVS].join(", ")}.`
    );
  }
  return requested;
}

/**
 * Read the surface binding for a remote environment.
 * @param {string} surface Execution surface.
 * @param {string} [cwd] Directory to look in.
 * @returns {object} The surface's configuration block.
 */
export function readSurfaceConfig(surface, cwd = process.cwd()) {
  const path = join(cwd, ".lisa.config.json");
  if (!existsSync(path)) throw new Error(".lisa.config.json is missing");
  const cfg = JSON.parse(readFileSync(path, "utf8"));
  const block = cfg.remoteEnv?.surfaces?.[surface];
  if (!block) {
    throw new Error(
      `no remoteEnv.surfaces["${surface}"] in .lisa.config.json.\n` +
        `Run /lisa:setup:remote-env ${surface} before dispatching to it.`
    );
  }
  return block;
}

/**
 * Refuse to dispatch into an environment that is not demonstrably ready.
 *
 * Every check here has a message naming the setup step that fixes it. The
 * alternative is a Cloud task that dies confusingly ten minutes later, in a log
 * the operator has to go looking for.
 * @param {object} block Surface configuration.
 * @param {string} surface Execution surface.
 */
export function assertPreconditions(block, surface) {
  const required = SURFACE_PRECONDITIONS[surface] ?? [
    "environmentId",
    "repository",
  ];
  const missing = required.filter(field => !block[field]);
  if (missing.length) {
    throw new Error(
      `remoteEnv.surfaces["${surface}"] is missing: ${missing.join(", ")}.\n` +
        `Run /lisa:setup:remote-env ${surface} to provision and record it.`
    );
  }
}

/**
 * Find the task identifier in whatever the CLI printed.
 *
 * The identifier is the only durable handle on work that outlives this process,
 * so failing to capture it is treated as a failed dispatch even when the command
 * itself succeeded. An untracked remote task is worse than none: nothing can
 * reconcile it, and a retry would duplicate it.
 * @param {string|undefined} output Combined CLI output.
 * @returns {string|null} The task identifier, or null when absent.
 */
export function extractTaskId(output) {
  const match = /\btask_[A-Za-z0-9]+_[0-9a-f]{8,}\b/.exec(String(output ?? ""));
  return match ? match[0] : null;
}

/**
 * Build the argument vector for a Codex Cloud dispatch.
 *
 * `--branch` is always explicit. It defaults to the *current* branch, and a
 * dispatcher's incidental checkout state must never decide where work runs.
 *
 * Model is passed through `-c` because the subcommand has no `--model` flag.
 * `attempts` is best-of-N and multiplies remote consumption, so it is stated
 * rather than left to an implicit default.
 * @param {object} block Surface configuration.
 * @param {string} prompt The thin skill invocation.
 * @returns {string[]} Arguments for `codex`.
 */
export function buildCodexArgs(block, prompt) {
  const args = ["cloud", "exec", "--env", block.environmentId];
  args.push("--branch", block.branch ?? "main");
  if (block.model) args.push("-c", `model=${JSON.stringify(block.model)}`);
  if (block.attempts) args.push("--attempts", String(block.attempts));
  args.push(prompt);
  return args;
}

/**
 * Append one dispatch to the durable ledger.
 *
 * Written before anything is reported to the operator. If this process dies
 * immediately afterwards, the record is what makes the remote task findable.
 * @param {object} entry Ledger entry.
 * @param {string} [cwd] Repository root.
 */
function record(entry, cwd = process.cwd()) {
  const path = join(cwd, LEDGER);
  mkdirSync(join(cwd, ".lisa"), { recursive: true });
  const existing = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : { version: 1, dispatches: [] };
  existing.dispatches.push(entry);
  writeFileSync(path, `${JSON.stringify(existing, null, 2)}\n`);
}

/**
 * Dispatch to Codex Cloud and record the result.
 * @param {object} block Surface configuration.
 * @param {string} prompt Thin skill invocation.
 * @param {string} payload The caller's original payload, for the record.
 * @returns {string} The task identifier.
 */
function dispatchCodexCloud(block, prompt, payload) {
  const args = buildCodexArgs(block, prompt);
  let output;
  try {
    output = boundedChildOutput("codex", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    throw new Error(
      `codex cloud exec failed: ${String(err.stderr ?? err.message).trim()}`
    );
  }

  const taskId = extractTaskId(output);
  if (!taskId) {
    throw new Error(
      `dispatch returned no task identifier.\n${output}\n` +
        `Refusing to report success: without the identifier nothing can ` +
        `reconcile this task, and a retry would duplicate it.`
    );
  }

  record({
    taskId,
    surface: "codex-cloud",
    environmentId: block.environmentId,
    repository: block.repository,
    branch: block.branch ?? "main",
    prompt,
    payload,
    dispatchedAt: new Date().toISOString(),
  });
  return taskId;
}

/**
 * Split `--skill NAME` out of the argument vector.
 *
 * Kept separate and tested because the obvious index-filter version is wrong in
 * the default case: with no `--skill` present, `indexOf` returns -1 and a filter
 * on `skillIndex + 1` silently drops argv[0] — which is the entire payload. The
 * failure is invisible, because a swallowed payload parses as no parameters,
 * which resolves to `local`, which looks like a perfectly ordinary local run.
 * @param {string[]} argv Arguments after the script name.
 * @returns {{skill: string, raw: string}} The target skill and remaining input.
 */
export function splitSkillFlag(argv) {
  const index = argv.indexOf("--skill");
  if (index === -1) return { skill: "lisa-implement", raw: argv.join(" ") };
  const skill = argv[index + 1];
  if (!skill) throw new Error("--skill requires a skill name");
  const rest = [...argv.slice(0, index), ...argv.slice(index + 2)];
  return { skill, raw: rest.join(" ") };
}

/**
 * Read the response a routine returns when it accepts a dispatch.
 *
 * Kept separate from the request so the shape can be exercised against a
 * recorded body. The identifier is a field here rather than something scraped
 * out of console output, which is the one respect in which this surface is
 * easier to reconcile than the other.
 * @param {string} body Raw response body.
 * @returns {{sessionId: string, url: string}} The accepted session.
 */
export function readFireResponse(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(
      `routine returned a body that is not JSON:\n${String(body).slice(0, 400)}`
    );
  }
  const sessionId = parsed.claude_code_session_id;
  const url = parsed.claude_code_session_url;
  if (!sessionId) {
    throw new Error(
      `routine accepted the request but returned no session identifier.\n` +
        `${JSON.stringify(parsed).slice(0, 400)}\n` +
        `Refusing to report success: without the identifier nothing can ` +
        `reconcile this run, and a retry would duplicate it.`
    );
  }
  return { sessionId, url: url ?? "" };
}

/**
 * Fire a routine and record the session it created.
 *
 * The payload is deliberately the work item and nothing else. It arrives on the
 * far side wrapped in a block the platform marks as untrusted data, and a
 * routine acts on it only because its saved prompt says to — which is the
 * boundary this plan wanted anyway, enforced by the platform rather than by
 * convention. Nothing here can widen the remote run's authority.
 *
 * The bearer token is resolved through the secrets chokepoint at the moment of
 * use and never stored in configuration.
 * Its three side effects — resolving a credential, making a request, writing the
 * ledger — are all injectable, so the accept and refuse paths can be exercised
 * without a token, a network, or a write into the working repository.
 * @param {object} block Surface configuration.
 * @param {string} prompt The thin skill invocation.
 * @param {string} payload The caller's original payload, for the record.
 * @param {{post?: Function, getToken?: Function, cwd?: string}} [options] Seams for tests.
 * @returns {Promise<{sessionId: string, url: string}>} The accepted session.
 */
export async function dispatchClaudeWeb(block, prompt, payload, options = {}) {
  const {
    post = fetch,
    getToken = resolveBearerToken,
    cwd = process.cwd(),
  } = options;
  const token = getToken(block);
  let response;
  try {
    response = await post(block.fireUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "anthropic-beta": ROUTINE_BETA,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: prompt }),
      signal: AbortSignal.timeout(FIRE_TIMEOUT_MS),
    });
  } catch (err) {
    // A timeout arrives here as an abort rather than a network error, and
    // "could not reach" is the true and useful thing to say about both. It is
    // named separately so the operator can tell a silent endpoint from a
    // refused connection, since only one of those is worth retrying.
    const reason =
      err.name === "TimeoutError"
        ? `no response within ${FIRE_TIMEOUT_MS / 1000}s`
        : err.message;
    throw new Error(`could not reach the routine endpoint: ${reason}`);
  }

  const body = await response.text();
  if (!response.ok) {
    // The token is the usual cause and the usual thing to leak, so the message
    // names the status and the routine rather than echoing the request.
    throw new Error(
      `routine ${block.routineId} refused the dispatch (HTTP ${response.status}).\n` +
        `${body.slice(0, 400)}\n` +
        `A 401 means the bearer token is wrong, revoked, or regenerated.`
    );
  }

  const { sessionId, url } = readFireResponse(body);
  record(
    {
      taskId: sessionId,
      surface: "claude-web",
      routineId: block.routineId,
      sessionUrl: url,
      prompt,
      payload,
      dispatchedAt: new Date().toISOString(),
    },
    cwd
  );
  return { sessionId, url };
}

/**
 * Resolve the dispatcher's own credential through the secrets chokepoint.
 *
 * Never read from configuration: the token authorises starting work on someone
 * else's infrastructure, and it can be regenerated and revoked, so it belongs
 * in the credential manager and in `secrets.rotating` alongside it.
 * @param {object} block Surface configuration.
 * @returns {string} The bearer token.
 */
function resolveBearerToken(block) {
  const name = block.tokenKey ?? "CLAUDE_ROUTINE_TOKEN";
  const resolver = resolve(
    HERE,
    "..",
    "..",
    "lisa-secrets-access",
    "scripts",
    "resolve-secret.mjs"
  );
  try {
    return boundedChildOutput("node", [resolver, "get", name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    throw new Error(
      `could not resolve ${name} through lisa-secrets-access.\n` +
        `${String(err.stderr ?? err.message).trim()}\n` +
        `It is the dispatcher's own credential; store it in the provider ` +
        `rather than in .lisa.config.json.`
    );
  }
}

/**
 * How each agent spells "run this skill".
 *
 * Codex invokes a skill with `$name`, Claude with `/name`. The prefix is the
 * whole invocation: get it wrong and the agent reads a sentence that merely
 * mentions a skill rather than a command that runs one — and being a capable
 * model it will often do *something*, which is worse than failing, because the
 * run looks successful while executing none of the skill's contract.
 *
 * Nothing downstream catches it either. The routine accepts any text, so the
 * dispatch succeeds, a session identifier is recorded, and the ledger says the
 * work was handed off. Only reading the session shows otherwise.
 * @param {string} surface Execution surface.
 * @param {string} skill Skill slug, without a prefix.
 * @param {string} rest The payload the skill is invoked with.
 * @returns {string} The thin invocation to send.
 */
export function buildInvocation(surface, skill, rest) {
  const prefix = surface === "claude-web" ? "/" : "$";
  return `${prefix}${skill} ${rest}`.trim();
}

async function main() {
  const { skill, raw } = splitSkillFlag(process.argv.slice(2));
  const { params, rest } = parseInvocation(raw);
  const surface = resolveExecutionEnv(params);

  if (surface === "local") {
    console.log("local");
    return;
  }

  const block = readSurfaceConfig(surface);
  assertPreconditions(block, surface);

  // The invocation stays thin on purpose. Every durable instruction lives in
  // the repository-local skill, so an interactive run, a scheduled run, and a
  // recovery run all execute one contract.
  const prompt = buildInvocation(surface, skill, rest);

  if (surface === "claude-web") {
    const { sessionId, url } = await dispatchClaudeWeb(block, prompt, rest);
    console.log(`dispatched: ${sessionId}`);
    if (url) console.log(url);
    console.log(`recorded in ${LEDGER}; not polling — this process is done.`);
    return;
  }

  const taskId = dispatchCodexCloud(block, prompt, rest);

  console.log(`dispatched: ${taskId}`);
  console.log(`https://chatgpt.com/codex/tasks/${taskId}`);
  console.log(`recorded in ${LEDGER}; not polling — this process is done.`);
}

/**
 * Whether this module is the one node was asked to run.
 *
 * Both sides are realpath'd: a raw URL comparison answers "no" through a
 * symlinked checkout, a git worktree, or a /tmp path on macOS, so the module
 * loads, runs nothing and exits 0 — a silent no-op that reads as success.
 *
 * A local copy rather than an import: plugin payload scripts ship standalone,
 * with no `lib/` sibling to import from once installed.
 * @param {string} moduleUrl - The caller's own `import.meta.url`.
 * @param {string | undefined} [argv1] - Entry path; defaults to `process.argv[1]`.
 * @returns {boolean} Whether the caller should run its CLI body.
 */
function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedAsScript(import.meta.url)) {
  // Awaited rather than called bare: one dispatch path is async, so a synchronous
  // try/catch would let a rejection escape as an unhandled rejection and exit 0 —
  // reporting dispatched work that was never accepted.
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
