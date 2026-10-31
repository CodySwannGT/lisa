/**
 * Manager subcommands of the session-manager CLI: start, stop, status,
 * repo-dir and validate. The setup ones (init-config, store-token,
 * trust-status, coexistence) live in cli-setup.mjs.
 *
 * `start` hosts the manager in tmux. With Telegram as the notification
 * channel and a secrets provider configured, it resolves the bot token once
 * from the provider and hands it to tmux on stdin (#4555; see
 * token-store.mjs). With Telegram and no provider it refuses (exit 2) unless
 * the bot token file exists with owner-only permissions in the project's own
 * state dir; with no channel
 * (`notify.provider` `"none"`, or no `notify` block) it needs no token, state
 * dir or plugin and launches without `--channels` (#4555). It treats an existing tmux session started in this root as
 * "already running" rather than starting a second poller on the same bot. A
 * session of that name started in another root is another project's manager,
 * so both `start` and `stop` refuse it (exit 2). `stop` kills only the
 * manager's tmux session: workers hold claimed work and keep running.
 * @module session-manager/cli-manager
 */
import path from "node:path";

import {
  CliError,
  EXIT,
  GLOBAL_CONFIG_FILE,
  asSetupError,
  asSetupErrorAsync,
  intFlag,
  listAgents,
  loadProject,
  mustRun,
  requireConfig,
  requireLisaRepo,
  run,
} from "./cli-runtime.mjs";
import { notifyProvider, resolveRepoDir } from "./config.mjs";
import { probeOwnSession, sessionSurvives } from "./isolation.mjs";
import { listPendingQuestions } from "./ledger-questions.mjs";
import {
  assertTokenPresent,
  buildForegroundCommand,
  buildHasSession,
  buildManagerLaunch,
  buildSourcedLaunch,
  buildStopManager,
  buildStoreTokenCommand,
  resolveStateDir,
} from "./launch.mjs";
import { readLedger } from "./ledger.mjs";
import {
  loadTokenSecrets,
  resolveTelegramToken,
  telegramSecretName,
} from "./token-store.mjs";
import { shellQuote } from "./token.mjs";
import { parseWorkerName, scrubWorkerEnv } from "./workers.mjs";

/**
 * The configured state dir, resolved (exit 2 for the shared default dir).
 * @param {object} ctx - CLI context
 * @param {object} config - Resolved block
 * @returns {string} Absolute state dir
 */
function stateDirOf(ctx, config) {
  return asSetupError(() =>
    resolveStateDir(config.notify?.stateDir, {
      env: ctx.env,
      homedir: ctx.homedir,
    })
  );
}

/** How long a new manager session must survive before `start` says so. */
const DEFAULT_SETTLE_MS = 3000;

/** Upper bound for `--settle-ms`, so `start` always returns promptly. */
const MAX_SETTLE_MS = 60_000;

/**
 * `--settle-ms`, defaulted and bounded, or exit 2.
 * @param {object} ctx - CLI context
 * @returns {number} Milliseconds
 */
function settleMsOf(ctx) {
  const value = intFlag(ctx.values["settle-ms"], "--settle-ms");
  if (value !== undefined && value > MAX_SETTLE_MS) {
    throw new CliError(
      `--settle-ms must be at most ${MAX_SETTLE_MS}.`,
      EXIT.SETUP
    );
  }
  return value ?? DEFAULT_SETTLE_MS;
}

/**
 * `start [--settle-ms <n>]`: host the manager in a detached tmux session,
 * and report `started` only once the session has survived the settle window
 * (claude can exit at once on a bad argv; tmux then closes the session).
 * @param {object} ctx - CLI context
 * @returns {Promise<{ json: object }>} `{status,name,...}`
 */
export async function start(ctx) {
  const settleMs = settleMsOf(ctx);
  const config = requireConfig(ctx);
  const notify = notifyProvider(config);
  const stateDir = notify === "telegram" ? stateDirOf(ctx, config) : undefined;
  // tmux gets the scrubbed env: if this call starts the tmux server, its
  // global environment must not carry a TELEGRAM_* value into other sessions.
  const env = scrubWorkerEnv(ctx.env);
  // A running manager already holds its token, so it is reported before the
  // provider is asked for one: a rate-limited vault must not turn "already
  // running" into a failure, or spend a vault call on nothing.
  const session = probeOwnSession(ctx, config.name, env);
  if (session.missing) throw new CliError("tmux is not on PATH.", EXIT.SETUP);
  if (session.running) {
    return { json: { status: "already-running", name: config.name } };
  }
  // Resolved before any session is created: a provider that cannot answer
  // must leave nothing half-started.
  const token =
    stateDir === undefined
      ? null
      : await telegramToken(ctx, config.name, stateDir);
  if (token?.source === "file") {
    asSetupError(() => assertTokenPresent(stateDir));
  }
  const argv = asSetupError(() =>
    buildManagerLaunch({
      name: config.name,
      root: ctx.root,
      ...(stateDir === undefined ? {} : { stateDir }),
      scriptsDir: ctx.scriptsDir,
      interval: config.interval,
      notify,
    })
  );
  const foreground = () => buildForegroundCommand(argv, token?.shellVars ?? {});
  if (token?.source === "provider") {
    launchWithToken({ ctx, argv, env, token, foreground });
  } else {
    mustRun("tmux", argv, { env, cwd: ctx.root });
  }
  if (!(await sessionSurvives(config.name, env, settleMs))) {
    throw new CliError(
      `The manager's tmux session "${config.name}" exited within ` +
        `${settleMs} ms of starting, so the manager is not running. Run the ` +
        `launch in the foreground to see claude's error:\n  ${foreground()}`,
      EXIT.SETUP
    );
  }
  return {
    json: {
      status: "started",
      name: config.name,
      notify,
      ...(stateDir === undefined ? {} : { stateDir }),
      ...(token === null
        ? {}
        : {
            tokenSource: token.source,
            ...(token.secret ? { secret: token.secret } : {}),
          }),
      attach: `tmux attach -t ${config.name}`,
    },
  };
}

/**
 * Where `start` gets the Telegram bot token (#4555). With a secrets provider
 * it is resolved once from the provider (exit 2 for a leftover plaintext
 * file, naming the `store-token` command that migrates it; exit 1 when the
 * provider cannot answer). With none, the plugin reads `<stateDir>/.env`.
 * The value is kept off the returned JSON; `shellVars` is the foreground
 * line's way to resolve it in the operator's own shell instead.
 * @param {object} ctx - CLI context
 * @param {string} managerName - `sessionManager.name`
 * @param {string} stateDir - Resolved state dir
 * @returns {Promise<{ source: "file" } | { source: "provider",
 *   secret: string, value: string, shellVars: Record<string, string> }>}
 *   Token source
 */
async function telegramToken(ctx, managerName, stateDir) {
  const secrets = await asSetupErrorAsync(() =>
    loadTokenSecrets(ctx.root, ctx.env)
  );
  if (secrets === null) return { source: "file" };
  const secret = telegramSecretName(managerName);
  const value = await asSetupErrorAsync(() =>
    resolveTelegramToken({
      ...secrets,
      name: secret,
      stateDir,
      fixCommand: buildStoreTokenCommand({
        scriptsDir: ctx.scriptsDir,
        projectRoot: ctx.root,
      }),
    })
  );
  const resolver = path.resolve(
    ctx.scriptsDir,
    "../../lisa-secrets-access/scripts/resolve-secret.mjs"
  );
  return {
    source: "provider",
    secret,
    value,
    shellVars: {
      TELEGRAM_BOT_TOKEN: `$(node ${shellQuote(resolver)} get ${secret})`,
    },
  };
}

/**
 * Start the manager's tmux session with the bot token on tmux's stdin
 * (`start-server ; source-file -`), never in argv. tmux's own stderr is never
 * passed through: a parse error can quote the line, which holds the token.
 * @param {{ ctx: object, argv: string[], env: object,
 *   token: { value: string }, foreground: () => string }} input - Context,
 *   the launch argv, the scrubbed env, the token and the foreground line
 */
function launchWithToken({ ctx, argv, env, token, foreground }) {
  const sourced = asSetupError(() =>
    buildSourcedLaunch(argv, { TELEGRAM_BOT_TOKEN: token.value })
  );
  const result = run("tmux", sourced.argv, {
    env,
    cwd: ctx.root,
    input: sourced.input,
  });
  if (result.missing) throw new CliError("tmux is not on PATH.", EXIT.SETUP);
  if (result.status !== 0) {
    throw new CliError(
      `tmux could not start the manager's session (exit ` +
        `${String(result.status)}). tmux's own error is not shown, because ` +
        `the command it read carries the bot token. Run the launch in the ` +
        `foreground to see the error:\n  ${foreground()}`,
      EXIT.FAILURE
    );
  }
}

/**
 * `stop`: kill the manager's tmux session only, and only when it was started
 * in this root (exit 2 for another project's session of the same name).
 * @param {object} ctx - CLI context
 * @returns {{ json: object }} `{status:"stopped"|"not-running",name}`
 */
export function stop(ctx) {
  const config = requireConfig(ctx);
  const env = scrubWorkerEnv(ctx.env);
  if (!probeOwnSession(ctx, config.name, env).running) {
    return { json: { status: "not-running", name: config.name } };
  }
  const result = run("tmux", buildStopManager(config.name), { env });
  const stopped = result.status === 0;
  return {
    json: { status: stopped ? "stopped" : "not-running", name: config.name },
  };
}

/**
 * `repo-dir [--repo <key>] [--raw]`: the directory a claim or worker for this
 * repo key must run in.
 * @param {object} ctx - CLI context
 * @returns {{ json?: object, text?: string }} JSON, or the bare path
 */
export function repoDir(ctx) {
  const config = requireConfig(ctx);
  const key = ctx.values.repo;
  const dir = requireLisaRepo(
    asSetupError(() => resolveRepoDir(config, key, ctx.root))
  );
  if (ctx.values.raw) return { text: `${dir}\n` };
  return { json: { repo: key ?? ".", dir } };
}

/**
 * Problems `validateSessionManager` cannot see: they need the filesystem.
 * @param {object} ctx - CLI context
 * @param {object} config - Resolved block
 * @returns {string[]} Problems
 */
function environmentProblems(ctx, config) {
  const problems = Object.keys(config.repos?.entries ?? {}).flatMap(key => {
    try {
      requireLisaRepo(resolveRepoDir(config, key, ctx.root));
      return [];
    } catch (error) {
      return [`sessionManager.repos.entries.${key}: ${error.message}`];
    }
  });
  if (
    notifyProvider(config) === "telegram" &&
    typeof config.notify?.stateDir === "string"
  ) {
    try {
      stateDirOf(ctx, config);
    } catch (error) {
      problems.push(`sessionManager.notify.stateDir: ${error.message}`);
    }
  }
  return problems;
}

/**
 * `validate`: every problem with the block, exit 2 when there is any.
 * @param {object} ctx - CLI context
 * @returns {{ json: object, exitCode: number }} `{valid,errors}`
 */
export function validate(ctx) {
  const project = loadProject(ctx.root);
  const errors = project.config
    ? [...project.errors, ...environmentProblems(ctx, project.config)]
    : [`No sessionManager block in ${GLOBAL_CONFIG_FILE}.`];
  return {
    json: { valid: errors.length === 0, errors },
    exitCode: errors.length === 0 ? EXIT.OK : EXIT.SETUP,
  };
}

/**
 * The line an operator at this machine runs to answer a pending question:
 * the answer goes on stdin, never in argv. Every word is single-quoted for
 * the shell, so a path or ref holding `$(…)` or a backtick runs nothing.
 * @param {{scriptsDir: string, root: string}} ctx - CLI context
 * @param {string} ref - Item ref
 * @returns {string} Command line
 */
function answerCommandFor(ctx, ref) {
  const script = path.join(ctx.scriptsDir, "session-manager.mjs");
  return `node ${shellQuote(script)} answer ${shellQuote(ref)} --project-root ${shellQuote(ctx.root)} < answer.txt`;
}

/**
 * `status`: is the manager's tmux session up, and what does the ledger say
 * about each worker it dispatched.
 * @param {object} ctx - CLI context
 * `notify` is the configured notification provider (`telegram` or `none`),
 * so the manager knows each cycle whether a channel exists.
 * @returns {Promise<{ json: object }>}
 *   `{manager,notify,control,workers,untracked,pendingQuestions}`
 */
export async function status(ctx) {
  const config = requireConfig(ctx);
  const tmux = run("tmux", buildHasSession(config.name), { env: ctx.env });
  const agents = listAgents(ctx, { all: true });
  const ledger = await readLedger(ctx.root);
  const liveNames = new Set(
    agents.filter(agent => agent.active).map(agent => agent.name)
  );
  const tracked = new Set(Object.values(ledger.items).map(i => i.worker));
  return {
    json: {
      manager: { name: config.name, running: tmux.status === 0 },
      notify: notifyProvider(config),
      control: ledger.control,
      workers: Object.entries(ledger.items).map(([ref, item]) => ({
        ref,
        worker: item.worker ?? null,
        sessionId: item.sessionId ?? null,
        repo: item.repo ?? null,
        status: item.status ?? null,
        attempts: item.attempts ?? 0,
        pendingQuestion: Boolean(item.pendingQuestion),
        live: liveNames.has(item.worker),
      })),
      untracked: [...liveNames]
        .filter(name => parseWorkerName(name) !== null && !tracked.has(name))
        .sort(),
      pendingQuestions: listPendingQuestions(ledger, ref =>
        answerCommandFor(ctx, ref)
      ),
    },
  };
}
