/**
 * The `status` subcommand of the session-manager CLI, split out of
 * cli-manager.mjs to keep it under the line budget (#4555): is the manager's
 * tmux session up, which notification provider is configured, what the
 * ledger says about each worker, and which items wait on a human.
 * cli-manager.mjs re-exports {@link status}, so callers keep one import.
 * @module session-manager/cli-status
 */
import path from "node:path";

import { listAgents, requireConfig, run } from "./cli-runtime.mjs";
import { notifyProvider } from "./config.mjs";
import { buildHasSession } from "./launch.mjs";
import { listPendingQuestions } from "./ledger-questions.mjs";
import { readLedger } from "./ledger.mjs";
import { shellQuote } from "./token.mjs";
import { parseWorkerName } from "./workers.mjs";

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
