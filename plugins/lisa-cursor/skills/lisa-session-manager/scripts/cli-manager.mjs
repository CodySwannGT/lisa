/**
 * Manager subcommands of the session-manager CLI: start, stop, status,
 * repo-dir and validate. The setup ones (init-config, store-token,
 * trust-status, coexistence) live in cli-setup.mjs.
 *
 * `start` hosts the manager in tmux. With Telegram as the notification
 * channel it refuses (exit 2) unless the bot token file exists with
 * owner-only permissions in the project's own state dir; with no channel
 * (`notify.provider` `"none"`, or no `notify` block) it needs no token, state
 * dir or plugin and launches without `--channels` (#4555). It treats an existing tmux session started in this root as
 * "already running" rather than starting a second poller on the same bot. A
 * session of that name started in another root is another project's manager,
 * so both `start` and `stop` refuse it (exit 2). `stop` kills only the
 * manager's tmux session: workers hold claimed work and keep running.
 * @module session-manager/cli-manager
 */
import {
  CliError,
  EXIT,
  GLOBAL_CONFIG_FILE,
  asSetupError,
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
import {
  assertTokenPresent,
  buildForegroundCommand,
  buildHasSession,
  buildManagerLaunch,
  buildStopManager,
  resolveStateDir,
} from "./launch.mjs";
import { readLedger } from "./ledger.mjs";
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
  const session = probeOwnSession(ctx, config.name, env);
  if (session.missing) throw new CliError("tmux is not on PATH.", EXIT.SETUP);
  if (session.running) {
    return { json: { status: "already-running", name: config.name } };
  }
  if (stateDir !== undefined) asSetupError(() => assertTokenPresent(stateDir));
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
  mustRun("tmux", argv, { env, cwd: ctx.root });
  if (!(await sessionSurvives(config.name, env, settleMs))) {
    const foreground = buildForegroundCommand(argv);
    throw new CliError(
      `The manager's tmux session "${config.name}" exited within ` +
        `${settleMs} ms of starting, so the manager is not running. Run the ` +
        `launch in the foreground to see claude's error:\n  ${foreground}`,
      EXIT.SETUP
    );
  }
  return {
    json: {
      status: "started",
      name: config.name,
      notify,
      ...(stateDir === undefined ? {} : { stateDir }),
      attach: `tmux attach -t ${config.name}`,
    },
  };
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
 * `status`: is the manager's tmux session up, and what does the ledger say
 * about each worker it dispatched.
 * @param {object} ctx - CLI context
 * `notify` is the configured notification provider (`telegram` or `none`),
 * so the manager knows each cycle whether a channel exists.
 * @returns {Promise<{ json: object }>}
 *   `{manager,notify,control,workers,untracked}`
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
    },
  };
}
