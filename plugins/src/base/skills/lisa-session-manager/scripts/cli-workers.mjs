/**
 * Worker subcommands of the session-manager CLI: capacity, spawn, resume and
 * classify.
 *
 * `spawn` is the one that starts yolo-mode sessions, so its checks run in a
 * fixed order and each has its own exit code the manager skill branches on:
 * the repo must be a Lisa repo (2), there must be capacity (3), and no live
 * worker may already hold the ref (4). Only then does it run
 * `claude --bg`, with the cwd set to the routed repo and every `TELEGRAM_*`
 * variable removed from the worker's environment.
 * @module session-manager/cli-workers
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { computeCapacity, readMachineStats } from "./capacity.mjs";
import {
  CliError,
  EXIT,
  asSetupError,
  intFlag,
  listAgents,
  loadProject,
  mustRun,
  requireConfig,
  requireLisaRepo,
  requirePositional,
  run,
  stdinText,
  validOrAbsent,
} from "./cli-runtime.mjs";
import { SESSION_MANAGER_DEFAULTS, resolveRepoDir } from "./config.mjs";
import {
  appendSessionEvent,
  readLedger,
  recordProgress,
  recordSpawn,
} from "./ledger.mjs";
import {
  DEFAULT_STALL,
  buildWorkerName,
  buildWorkerResume,
  buildWorkerSpawn,
  classifyWorker,
  countRunningWorkers,
  findLiveWorker,
  parseSessionId,
} from "./workers.mjs";

/**
 * Compute the capacity report for this machine and these agents.
 * @param {object} ctx - CLI context
 * @param {object} capacityConfig - `sessionManager.capacity`
 * @param {ReturnType<typeof listAgents>} agents - Normalized rows
 * @returns {Promise<ReturnType<typeof computeCapacity>>} Report
 */
async function measure(ctx, capacityConfig, agents) {
  const meminfoPath = ctx.values.meminfo;
  const stats = await readMachineStats({
    // The hidden --meminfo flag reads a Linux meminfo file on any host.
    platform: meminfoPath ? "linux" : ctx.platform,
    meminfoPath,
    exec: async command => mustRun(command, [], { env: ctx.env }),
    readFile: file => readFile(file, "utf8"),
  });
  const { control } = await readLedger(ctx.root);
  return computeCapacity({
    stats,
    running: countRunningWorkers(agents),
    config: capacityConfig,
    control,
    flagMaxWorkers: intFlag(ctx.values["max-workers"], "--max-workers"),
  });
}

/**
 * `capacity`: the report the manager reads before every dispatch. Works with
 * no `sessionManager` block (the documented defaults apply).
 * @param {object} ctx - CLI context
 * @returns {Promise<{ json: object }>} Capacity report
 */
export async function capacity(ctx) {
  const config = validOrAbsent(loadProject(ctx.root));
  const capacityConfig = config?.capacity ?? SESSION_MANAGER_DEFAULTS.capacity;
  return { json: await measure(ctx, capacityConfig, listAgents(ctx)) };
}

/**
 * Every worker name this project has used or can see, so a retry never
 * reuses one.
 * @param {ReturnType<typeof listAgents>} agents - Normalized rows
 * @param {Awaited<ReturnType<typeof readLedger>>} ledger - Ledger
 * @returns {Set<string>} Names
 */
function knownNames(agents, ledger) {
  const fromLedger = Object.values(ledger.items).flatMap(item => [
    item.worker,
    ...(item.history ?? []).map(event => event.worker),
  ]);
  return new Set(
    [...agents.map(agent => agent.name), ...fromLedger].filter(Boolean)
  );
}

/**
 * `spawn <ref> [--repo <key>]`: start one worker for one claimed item.
 * @param {object} ctx - CLI context
 * @returns {Promise<{ json: object }>} `{ref,name,sessionId,repo,cwd}`
 */
export async function spawn(ctx) {
  const ref = requirePositional(ctx, "ref");
  const config = requireConfig(ctx);
  const key = ctx.values.repo;
  const repoDir = requireLisaRepo(
    asSetupError(() => resolveRepoDir(config, key, ctx.root))
  );

  const agents = listAgents(ctx, { all: true });
  const report = await measure(ctx, config.capacity, agents);
  if (!report.can_spawn) {
    throw new CliError(
      `No capacity: ${report.running} running, cap ${report.cap}` +
        `${report.paused ? ", paused" : ""}${report.overloaded ? ", overloaded" : ""}.`,
      EXIT.NO_CAPACITY,
      report
    );
  }
  const live = asSetupError(() => findLiveWorker(agents, ref));
  if (live) {
    throw new CliError(
      `${ref} already has a live worker: ${live.name}.`,
      EXIT.LIVE_WORKER,
      { ref, worker: live.name, sessionId: live.sessionId }
    );
  }

  const ledger = await readLedger(ctx.root);
  const spec = asSetupError(() => {
    const name = buildWorkerName(ref, ctx.now(), knownNames(agents, ledger));
    return buildWorkerSpawn({
      ref,
      name,
      manager: config.name,
      repoDir,
      env: ctx.env,
    });
  });
  const name = spec.args[2];
  const stdout = mustRun(spec.command, spec.args, spec);
  const sessionId = parseSessionId(stdout);
  if (sessionId === null) {
    ctx.warn(
      `claude --bg printed no session id; find ${name} in claude agents --json.`
    );
  }
  const repo = key ?? ".";
  await recordSpawn(ctx.root, { ref, worker: name, sessionId, repo });
  await appendSessionEvent(ctx.root, {
    event: "spawn",
    ref,
    worker: name,
    sessionId,
    repo,
    cwd: repoDir,
  });
  return { json: { ref, name, sessionId, repo, cwd: repoDir } };
}

/**
 * The ledger row for `ref`, or exit 2.
 * @param {Awaited<ReturnType<typeof readLedger>>} ledger - Ledger
 * @param {string} ref - Item ref
 * @returns {object} Ledger item
 */
function ledgerItem(ledger, ref) {
  const item = Object.hasOwn(ledger.items, ref) ? ledger.items[ref] : null;
  if (!item) throw new CliError(`${ref} is not in the ledger.`, 2);
  return item;
}

/**
 * `resume <ref>`: resume a stopped worker with the message on stdin, in the
 * worker's own repo and with the same environment scrub as a spawn.
 * @param {object} ctx - CLI context
 * @returns {Promise<{ json: object }>} `{ref,worker,sessionId,resumed}`
 */
export async function resume(ctx) {
  const ref = requirePositional(ctx, "ref");
  const text = stdinText(ctx, "message for the worker");
  const config = requireConfig(ctx);
  const item = ledgerItem(await readLedger(ctx.root), ref);
  if (!item.sessionId) {
    throw new CliError(`${ref} has no recorded session id to resume.`, 2);
  }
  const repoKey = item.repo === "." ? undefined : item.repo;
  const spec = asSetupError(() =>
    buildWorkerResume({
      sessionId: item.sessionId,
      text,
      repoDir: requireLisaRepo(resolveRepoDir(config, repoKey, ctx.root)),
      env: ctx.env,
    })
  );
  mustRun(spec.command, spec.args, spec);
  await appendSessionEvent(ctx.root, {
    event: "resume",
    ref,
    worker: item.worker,
    sessionId: item.sessionId,
  });
  return {
    json: {
      ref,
      worker: item.worker,
      sessionId: item.sessionId,
      resumed: true,
    },
  };
}

/**
 * Hash of `claude logs <name>`, or null when it cannot be read. An unchanged
 * hash across cycles is the only "no output" signal the CLI offers.
 *
 * probe-direction: fail-closed — a failed `claude logs` read yields null,
 * which `classifyWorker` never credits as progress, so the worker can only
 * move toward `stalled` (a retry), never be kept `working` on a read that
 * did not happen.
 * @param {object} ctx - CLI context
 * @param {string} name - Worker name
 * @returns {string | null} sha256 hex
 */
function logsHash(ctx, name) {
  const result = run("claude", ["logs", name], { env: ctx.env });
  if (result.status !== 0) return null;
  return createHash("sha256").update(result.stdout).digest("hex");
}

/**
 * `classify [<ref>]`: classify one ledger item, or every one, for this cycle,
 * and record each logs hash as progress.
 * @param {object} ctx - CLI context
 * @returns {Promise<{ json: object[] }>} One row per item
 */
export async function classify(ctx) {
  const config = validOrAbsent(loadProject(ctx.root));
  const stall = config?.stall ?? DEFAULT_STALL;
  const ledger = await readLedger(ctx.root);
  const [only] = ctx.positionals;
  const refs = only ? [only] : Object.keys(ledger.items).sort();
  const agents = listAgents(ctx, { all: true });
  const rows = [];
  for (const ref of refs) {
    const entry = ledgerItem(ledger, ref);
    // A worker-less item (asked about, never dispatched) has no session to
    // pair with; `null === null` would adopt any unnamed agent as its worker.
    const named = entry.worker
      ? agents.filter(agent => agent.name === entry.worker)
      : [];
    const agent = named.find(row => row.active) ?? named[0] ?? null;
    const hash = agent ? logsHash(ctx, entry.worker) : null;
    const classification = classifyWorker({
      agent,
      entry,
      logsHash: hash,
      now: ctx.now(),
      stall,
    });
    if (hash !== null) await recordProgress(ctx.root, { ref, logsHash: hash });
    rows.push({
      ref,
      worker: entry.worker ?? null,
      sessionId: entry.sessionId ?? null,
      repo: entry.repo ?? null,
      classification,
      attempts: entry.attempts ?? 0,
      agentStatus: agent?.status ?? agent?.state ?? null,
      pendingQuestion: entry.pendingQuestion ?? null,
    });
  }
  return { json: rows };
}
