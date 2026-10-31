/**
 * Per-cycle subcommands of the session-manager CLI: ledger, route,
 * blocked-plan and record-cycle (`queue` lives in cli-queue.mjs).
 *
 * Every piece of untrusted text these commands take (a worker's question, a
 * Telegram message, a finish reason, the cycle summary, an item's body and
 * comments) arrives on stdin or in a file, never in argv.
 * @module session-manager/cli-cycle
 */
import {
  AUTOMATION_RUN_OUTCOMES,
  recordAutomationRun,
} from "../../../scripts/automation-run-record.mjs";
import {
  CliError,
  EXIT,
  asSetupErrorAsync,
  humanNeededLabel,
  intFlag,
  loadProject,
  requirePositional,
  stdinText,
} from "./cli-runtime.mjs";
import { parseJson, readJsonFile } from "./cli-queue.mjs";
import {
  clearPendingQuestion,
  clearValidationFailure,
  readLedger,
  recordFinish,
  recordSpawn,
  recordValidationFailure,
  setControl,
  setPendingQuestion,
} from "./ledger.mjs";
import { recordMarked } from "./ledger-questions.mjs";
import { planBlockedRelease } from "./reconcile.mjs";
import { formatAnswer, routeInbound } from "./telegram-route.mjs";

/** The automation loop id every cycle records under. */
const LOOP_ID = "session-manager";

/** The runbook the automation-runbook contract requires for this loop. */
const RUNBOOK = ".lisa/automations/session-manager.runbook.md";
/**
 * Parse `--paused true|false`.
 * @param {string | undefined} value - Flag value
 * @returns {boolean | undefined} Parsed value
 */
function pausedFlag(value) {
  if (value === undefined) return undefined;
  if (value !== "true" && value !== "false") {
    throw new CliError("--paused must be true or false.", 2);
  }
  return value === "true";
}

/**
 * Parse a flag where `none` clears the value.
 * @param {string | undefined} value - Flag value
 * @param {(value: string) => unknown} parse - Parser for a real value
 * @returns {unknown} Parsed value, null for `none`, undefined when absent
 */
function clearable(value, parse) {
  if (value === undefined) return undefined;
  return value === "none" ? null : parse(value);
}

/**
 * With `--sender <name>`, refuse (exit 2) unless the ledger holds `ref` for
 * exactly that worker. The manager passes the cross-session sender of a
 * worker's report, so one worker can never finish or question another
 * worker's item; the manager's own calls (stall, operator stop, repo-routing
 * questions) omit the flag.
 * @param {object} ctx - CLI context
 * @param {string} ref - Ref the report names
 * @returns {Promise<void>}
 */
async function assertSender(ctx, ref) {
  const sender = ctx.values.sender;
  if (sender === undefined) return;
  const items = (await readLedger(ctx.root)).items;
  const worker = Object.hasOwn(items, ref) ? items[ref].worker : null;
  if (worker !== sender) {
    throw new CliError(
      `${sender} is not the worker for ${ref} (the ledger has ` +
        `${worker ?? "no worker"}); ignoring its message.`,
      2
    );
  }
}

/** One handler per `ledger <action>`. */
const LEDGER_ACTIONS = {
  async get(ctx) {
    const ledger = await readLedger(ctx.root);
    const [ref] = ctx.positionals;
    if (!ref) return ledger;
    if (!Object.hasOwn(ledger.items, ref)) {
      throw new CliError(`${ref} is not in the ledger.`, 2);
    }
    return ledger.items[ref];
  },
  "record-spawn": ctx =>
    recordSpawn(ctx.root, {
      ref: requirePositional(ctx, "ref"),
      worker: requireValue(ctx, "worker"),
      sessionId: ctx.values["session-id"] ?? null,
      repo: ctx.values.repo ?? ".",
    }),
  async "set-question"(ctx) {
    const ref = requirePositional(ctx, "ref");
    await assertSender(ctx, ref);
    return setPendingQuestion(ctx.root, {
      ref,
      text: stdinText(ctx, "question"),
      telegramMessageId:
        intFlag(ctx.values["telegram-message-id"], "--telegram-message-id") ??
        null,
      kind: ctx.values.kind,
    });
  },
  marked: ctx =>
    recordMarked(ctx.root, {
      ref: requirePositional(ctx, "ref"),
      markerType: requireValue(ctx, "marker-type"),
      marker: requireValue(ctx, "marker"),
    }),
  "clear-question": ctx =>
    clearPendingQuestion(ctx.root, {
      ref: requirePositional(ctx, "ref"),
      resetAttempts: ctx.values["reset-attempts"] === true,
    }),
  async finish(ctx) {
    const status = ctx.values.status;
    if (status !== "DONE" && status !== "FAILED") {
      throw new CliError("--status must be DONE or FAILED.", 2);
    }
    const ref = requirePositional(ctx, "ref");
    await assertSender(ctx, ref);
    return recordFinish(ctx.root, {
      ref,
      status,
      reason: stdinText(ctx, "reason", { required: false }),
    });
  },
  "validation-failed": ctx =>
    recordValidationFailure(ctx.root, {
      ref: requirePositional(ctx, "ref"),
      updatedAt: requireValue(ctx, "updated-at"),
      reason: stdinText(ctx, "reason", { required: false }),
    }),
  "validation-cleared": ctx =>
    clearValidationFailure(ctx.root, { ref: requirePositional(ctx, "ref") }),
  control: ctx =>
    setControl(
      ctx.root,
      Object.fromEntries(
        Object.entries({
          paused: pausedFlag(ctx.values.paused),
          maxWorkers: clearable(ctx.values["max-workers"], value =>
            intFlag(value, "--max-workers")
          ),
          me: clearable(ctx.values.me, value => value),
        }).filter(([, value]) => value !== undefined)
      )
    ),
};

/** Ledger actions the CLI accepts, for usage and argv specs. */
export const LEDGER_ACTION_NAMES = Object.keys(LEDGER_ACTIONS);

/**
 * A required flag value, or exit 2.
 * @param {object} ctx - CLI context
 * @param {string} flag - Flag name without dashes
 * @returns {string} Value
 */
function requireValue(ctx, flag) {
  const value = ctx.values[flag];
  if (!value) throw new CliError(`Missing --${flag}.`, 2);
  return value;
}

/**
 * `ledger <action>`: read or update the manager's ledger.
 * @param {object} ctx - CLI context; `ctx.action` is the ledger action
 * @returns {Promise<{ json: unknown }>} The item, control or whole ledger
 */
export async function ledger(ctx) {
  const handler = LEDGER_ACTIONS[ctx.action];
  return { json: await asSetupErrorAsync(() => handler(ctx)) };
}

/**
 * `route [--reply-to <id>] [--owner <name>]`: decide what one Telegram message
 * (on stdin) is: an answer for a worker, an operator command, or ambiguous.
 * @param {object} ctx - CLI context
 * @returns {Promise<{ json: object }>} Route, plus `message` for an answer
 *   when `--owner` is given
 */
export async function route(ctx) {
  const text = stdinText(ctx, "message", { required: false });
  const routed = routeInbound({
    text,
    replyToMessageId: intFlag(ctx.values["reply-to"], "--reply-to") ?? null,
    ledger: await readLedger(ctx.root),
  });
  const owner = ctx.values.owner;
  if (routed.kind === "answer" && owner) {
    return { json: { ...routed, message: formatAnswer(owner, routed.body) } };
  }
  return { json: routed };
}

/**
 * `blocked-plan [--input <file>] [--ref <ref>]`: plan one Blocked item from
 * its JSON (stdin, or the file). `--ref` fills in the ledger's pending
 * question when the input does not carry one.
 *
 * Who may release a human hold comes from `sessionManager.trustedAuthorIds`
 * only. Any `trustedHumanActorIds` in the input is discarded: the input is
 * assembled from the item's own (untrusted) body and comments, so a list
 * carried beside them would let the item's text vouch for itself.
 * @param {object} ctx - CLI context
 * @returns {Promise<{ json: object }>} `{action,reason,edges,gate}`
 */
export async function blockedPlan(ctx) {
  const input = ctx.values.input
    ? readJsonFile(ctx.values.input)
    : parseJson(stdinText(ctx, "item JSON"), "stdin");
  const ref = ctx.values.ref;
  const pendingQuestion =
    input.pendingQuestion ??
    (ref ? (await readLedger(ctx.root)).items[ref]?.pendingQuestion : null);
  const project = loadProject(ctx.root);
  const trustedHumanActorIds = project.config?.trustedAuthorIds ?? [];
  return {
    json: planBlockedRelease({
      ...input,
      // The configured label, so a Jira `Human Needed` hold is still a hold.
      humanNeededLabel:
        input.humanNeededLabel ?? humanNeededLabel(project, undefined),
      pendingQuestion,
      trustedHumanActorIds,
    }),
  };
}

/**
 * `record-cycle --outcome <o> [--ref <url>]... [--run-id <id>]`: record this
 * cycle's run outcome, with the one-line summary on stdin.
 * @param {object} ctx - CLI context
 * @returns {Promise<{ json: object }>} What was recorded
 */
export async function recordCycle(ctx) {
  const outcome = ctx.values.outcome;
  if (!AUTOMATION_RUN_OUTCOMES.includes(outcome)) {
    throw new CliError(
      `--outcome must be one of: ${AUTOMATION_RUN_OUTCOMES.join(", ")}.`,
      EXIT.SETUP
    );
  }
  const result = await asSetupErrorAsync(() =>
    recordAutomationRun({
      projectRoot: ctx.root,
      loopId: LOOP_ID,
      runbook: RUNBOOK,
      outcome,
      summary: stdinText(ctx, "cycle summary"),
      refs: ctx.values.ref ?? [],
      ...(ctx.values["run-id"] ? { runId: ctx.values["run-id"] } : {}),
    })
  );
  return {
    json: {
      path: result.path,
      appended: result.appended,
      loop_id: result.record.loop_id,
      outcome: result.record.outcome,
      run_id: result.record.run_id,
    },
  };
}
