/**
 * Worker subcommands of the session-manager CLI: capacity, spawn, resume and
 * classify.
 *
 * `spawn` is the one that starts yolo-mode sessions, so its checks run in a
 * fixed order and each has its own exit code the manager skill branches on:
 * the repo must be a Lisa repo (2), there must be capacity (3), and no live
 * worker may already hold the ref (4). Only then does it run
 * `claude --bg`, with the cwd set to the routed repo and every `TELEGRAM_*`
 * variable removed from the worker's environment. A repo whose workspace
 * trust was never accepted is exit 2 too (see worker-launch.mjs). So is a
 * worker whose first prompt never ran — `/lisa:implement` unknown in that
 * repo, or refused by a `UserPromptSubmit` hook: `spawn` reads the new
 * session's transcript briefly, stops that worker and records no item
 * (lisa#4503). `classify` reads the same transcript every cycle and reports
 * such a worker as `setup-gap` instead of `working` until the stall timer.
 *
 * Either setup gap — and one `classify` finds later — is recorded per repo in
 * the ledger (lisa#4820), and
 * `spawn` refuses a repo with a recorded gap (exit 2) before launching
 * anything, until the operator runs `ledger clear-setup-gap <repo>`.
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
import { claudeConfigDir, readFirstPrompt } from "./first-prompt.mjs";
import {
  clearCommand,
  recordSetupGap,
  setupGapOf,
} from "./ledger-setup-gaps.mjs";
import {
  confirmFirstPrompt,
  resolveFullSessionId,
  runWorkerSession,
} from "./worker-launch.mjs";

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
 * Refuse a repo whose setup gap is recorded (exit 2), before any worker is
 * launched or any attempt recorded. Retrying cannot fix a setup gap, so the
 * repo stays refused until the operator clears it (lisa#4820).
 * @param {Awaited<ReturnType<typeof readLedger>>} ledger - Ledger
 * @param {string} repo - Repo key (`.` for a single-repo project)
 */
function refuseSetupGap(ledger, repo) {
  const gap = setupGapOf(ledger, repo);
  if (gap === null) return;
  throw new CliError(
    `Repo ${repo} has a recorded setup gap (${gap.kind}: ${gap.detail}, ` +
      `recorded ${gap.at}), so no worker was started and nothing was ` +
      `recorded. Fix the repo, then run "${clearCommand(repo)}" to resume ` +
      `dispatching there.`,
    EXIT.SETUP,
    { repo, setupGap: gap, setupGapStatus: "already-recorded" }
  );
}

/**
 * Record a spawn's setup gap, reporting what happened. A failed ledger write
 * is warned about and reported as `not-recorded`, never allowed to replace
 * the setup message the operator needs.
 *
 * probe-direction: fail-open — an unwritten gap only means the next cycle
 * may dispatch to the repo once more and hit the same exit 2.
 * @param {object} ctx - CLI context
 * @param {string} repo - Repo key
 * @param {{kind: string, detail: string}} gap - What failed
 * @returns {Promise<"recorded" | "already-recorded" | "not-recorded">} Status
 */
async function persistSpawnGap(ctx, repo, gap) {
  try {
    const { status } = await recordSetupGap(ctx.root, { repo, ...gap });
    return status === "already-recorded" ? status : "recorded";
  } catch (error) {
    ctx.warn(
      `Could not record the setup gap for repo ${repo} in the ledger ` +
        `(${error.message}); the next cycle may dispatch there again.`
    );
    return "not-recorded";
  }
}

/**
 * Run `launch`; when it fails with a setup gap (exit 2 carrying
 * `json.setupGap`), record the gap under `repo` and rethrow it naming the
 * command that clears it. `json.setupGapStatus` says whether this spawn
 * recorded the gap (`recorded`: tell the operator), found it already
 * recorded, or could not record it (`not-recorded`: tell the operator).
 * @template T
 * @param {object} ctx - CLI context
 * @param {string} repo - Repo key
 * @param {() => Promise<T>} launch - The launch to guard
 * @returns {Promise<T>} What `launch` returned
 */
async function rememberingSetupGap(ctx, repo, launch) {
  try {
    return await launch();
  } catch (error) {
    const gap = error instanceof CliError ? error.json?.setupGap : null;
    if (error.exitCode !== EXIT.SETUP || !gap) throw error;
    const setupGapStatus = await persistSpawnGap(ctx, repo, gap);
    const paused =
      setupGapStatus === "not-recorded"
        ? ""
        : ` Dispatch to repo ${repo} is now paused: once it is fixed, run ` +
          `"${clearCommand(repo)}".`;
    throw new CliError(`${error.message}${paused}`, EXIT.SETUP, {
      ...error.json,
      repo,
      setupGapStatus,
    });
  }
}

/**
 * Start the worker and confirm its first prompt ran.
 * @param {object} ctx - CLI context
 * @param {ReturnType<typeof buildWorkerSpawn>} spec - Spawn spec
 * @param {string} repoDir - Where the worker starts
 * @returns {Promise<{name: string, sessionId: string | null,
 *   firstPrompt: "alive" | "unconfirmed"}>} The launched worker
 */
async function launchWorker(ctx, spec, repoDir) {
  const name = spec.args[2];
  const sessionId = parseSessionId(runWorkerSession(spec));
  if (sessionId === null) {
    ctx.warn(
      `claude --bg printed no session id; find ${name} in claude agents --json.`
    );
  }
  // Before anything is recorded: a first prompt that never ran is a setup
  // gap (exit 2), not an attempt. With no session id there is no transcript
  // to find, so waiting would only delay the spawn.
  const firstPrompt =
    sessionId === null
      ? "unconfirmed"
      : await confirmFirstPrompt(ctx, { name, sessionId, repoDir });
  return { name, sessionId, firstPrompt };
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
  const repo = key ?? ".";
  refuseSetupGap(ledger, repo);
  // A spawn no longer clears a pending question (lisa#4571), and a worker
  // under one classifies as waiting, never stalled or dead. So refuse here:
  // the question must be answered and cleared first ("Clearing").
  if (ledger.items[ref]?.pendingQuestion) {
    throw new CliError(
      `${ref} has a pending question in the ledger; nothing was spawned. ` +
        `Answer it and run "Clearing" (ledger clear-question ${ref}) first.`,
      EXIT.SETUP
    );
  }
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
  const { name, sessionId, firstPrompt } = await rememberingSetupGap(
    ctx,
    repo,
    () => launchWorker(ctx, spec, repoDir)
  );
  await recordSpawn(ctx.root, { ref, worker: name, sessionId, repo });
  await appendSessionEvent(ctx.root, {
    event: "spawn",
    ref,
    worker: name,
    sessionId,
    repo,
    cwd: repoDir,
  });
  return { json: { ref, name, sessionId, repo, cwd: repoDir, firstPrompt } };
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
  // A finish keeps a pending question (lisa#4571), so an answer can still
  // arrive for a worker that reported DONE or FAILED. Resuming it would
  // restart a worker the ledger no longer tracks, so refuse: "Clearing"
  // delivers nothing to a finished worker.
  if (item.status === "DONE" || item.status === "FAILED") {
    throw new CliError(
      `${ref} finished (${item.status}); a finished worker is never ` +
        `resumed. Clear its question without delivering it ("Clearing").`,
      EXIT.SETUP
    );
  }
  if (!item.sessionId && !item.worker) {
    throw new CliError(`${ref} has no recorded session id to resume.`, 2);
  }
  // probe-direction: fail-closed — no full id means no resume: a short id
  // would start an unseen copy of the conversation instead of the worker.
  const sessionId = resolveFullSessionId(listAgents(ctx, { all: true }), item);
  if (sessionId === null) {
    throw new CliError(
      `${ref}: no claude agents row gives the full session id for ` +
        `${item.worker ?? item.sessionId}, and resuming by short id starts a ` +
        `copy instead of the worker. Check claude agents --json --all.`,
      2
    );
  }
  const repoKey = item.repo === "." ? undefined : item.repo;
  const spec = asSetupError(() =>
    buildWorkerResume({
      sessionId,
      text,
      repoDir: requireLisaRepo(resolveRepoDir(config, repoKey, ctx.root)),
      env: ctx.env,
    })
  );
  runWorkerSession(spec);
  await appendSessionEvent(ctx.root, {
    event: "resume",
    ref,
    worker: item.worker,
    sessionId,
  });
  return {
    json: {
      ref,
      worker: item.worker,
      sessionId,
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
 * The repo dir a ledger item's worker started in, or null when it cannot be
 * resolved (no config for a child repo key, or a key the config lost).
 * @param {object} ctx - CLI context
 * @param {object | null} config - Resolved `sessionManager` block, if any
 * @param {{repo?: string|null}} entry - Ledger item
 * @returns {string | null} Absolute dir
 */
function workerDir(ctx, config, entry) {
  if (!entry.repo || entry.repo === ".") return ctx.root;
  try {
    return config ? resolveRepoDir(config, entry.repo, ctx.root) : null;
  } catch {
    return null;
  }
}

/**
 * The first-prompt failure the item's worker transcript records, if any.
 *
 * probe-direction: fail-open — an unreadable or missing transcript yields
 * null, which leaves classification exactly as it was before this check.
 * A finished item (DONE or FAILED) classifies `finished` whatever its
 * transcript says, so its transcript is never read.
 * @param {object} ctx - CLI context
 * @param {object | null} config - Resolved `sessionManager` block, if any
 * @param {{worker?: string|null, sessionId?: string|null, repo?: string|null,
 *   status?: string}} entry - Ledger item
 * @returns {{kind: string, detail: string} | null} Failure
 */
function transcriptFailure(ctx, config, entry) {
  if (entry.status === "DONE" || entry.status === "FAILED") return null;
  const cwd =
    entry.worker && entry.sessionId ? workerDir(ctx, config, entry) : null;
  if (cwd === null) return null;
  return (
    readFirstPrompt({
      configDir: claudeConfigDir(ctx.env, ctx.homedir),
      cwd,
      sessionId: entry.sessionId,
    })?.failure ?? null
  );
}

/**
 * Record a gap `classify` found in a running worker's transcript, unless the
 * repo already has one (so its `at` stays when the gap was first seen) or
 * the worker started before the operator last cleared the repo (its old
 * transcript would otherwise undo the clear every cycle). A worker whose
 * first prompt failed after spawn's window never went through spawn's exit 2,
 * so without this its repo would still be dispatched to (lisa#4820).
 *
 * probe-direction: fail-open — a failed write is warned about and must not
 * abort classifying the remaining items; the next cycle retries it.
 * @param {object} ctx - CLI context
 * @param {{repo?: string|null, startedAt?: string|null}} entry - Ledger item
 * @param {{kind: string, detail: string}} failure - From the transcript
 * @returns {Promise<void>}
 */
async function rememberClassifiedGap(ctx, entry, failure) {
  const repo = entry.repo ?? ".";
  try {
    await recordSetupGap(ctx.root, {
      repo,
      ...failure,
      startedAt: entry.startedAt ?? null,
    });
  } catch (error) {
    ctx.warn(
      `Could not record the setup gap for repo ${repo} in the ledger ` +
        `(${error.message}); the next cycle will try again.`
    );
  }
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
    const setupGap = transcriptFailure(ctx, config, entry);
    const classification = classifyWorker({
      agent,
      entry,
      logsHash: hash,
      now: ctx.now(),
      stall,
      firstPromptFailure: setupGap,
    });
    if (hash !== null) await recordProgress(ctx.root, { ref, logsHash: hash });
    if (classification === "setup-gap") {
      await rememberClassifiedGap(ctx, entry, setupGap);
    }
    rows.push({
      ref,
      worker: entry.worker ?? null,
      sessionId: entry.sessionId ?? null,
      repo: entry.repo ?? null,
      classification,
      attempts: entry.attempts ?? 0,
      agentStatus: agent?.status ?? agent?.state ?? null,
      pendingQuestion: entry.pendingQuestion ?? null,
      setupGap: classification === "setup-gap" ? setupGap : null,
    });
  }
  return { json: rows };
}
