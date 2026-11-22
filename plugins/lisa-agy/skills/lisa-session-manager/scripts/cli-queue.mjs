/**
 * The `queue` subcommand of the session-manager CLI: the Ready queue, mine
 * first, paged to completion.
 *
 * "Page to completion" is executable here rather than prose. GitHub is
 * fetched by this module with `gh api --paginate --slurp`, so every page is
 * read or the command fails. Jira and Linear are fetched by their vendor
 * skills (a script cannot reach them), which write an envelope
 * `{complete, pages, items}`; anything but a literal `complete: true` is
 * refused with exit 2, because ordering a partial queue would dispatch the
 * wrong item with full confidence.
 *
 * With `sessionManager.backlogPickup` on, `queue` also ranks the backlog tier
 * (open leaves in no lifecycle role) as `backlogOrdered`, under the same
 * paging rule. The manager walks it only after the whole Ready queue.
 *
 * Both tiers leave out items routed to a repo with a recorded setup gap
 * (#4820) and list every gap once as `setupGaps`, with the command that
 * clears it, so the manager reports it in plain language instead of
 * re-dispatching there every cycle. They also leave out an item owed a
 * stale-link restore (`restore-owed`, CodySwannGT/lisa#5065): a blocker link
 * put back after its blocker reopened, not yet read back present, so the
 * item would otherwise look unblocked while that blocker is open. An item
 * whose stale-link removals ran but were never read back is held the same
 * way (`removal-unverified`): its blocker may have reopened since.
 *
 * The GitHub fetches live in queue-github.mjs and JSON input in
 * json-input.mjs (re-exported here), to keep each module under the line
 * budget.
 * @module session-manager/cli-queue
 */
import {
  assertPagedToCompletion,
  normalizeJiraIssue,
  normalizeLinearIssue,
  orderBacklogQueue,
  orderReadyQueue,
} from "../../../scripts/ready-queue-order.mjs";
import {
  CliError,
  asSetupError,
  humanNeededLabel,
  loadProject,
  validOrAbsent,
} from "./cli-runtime.mjs";
import { resolveHumanGatePolicy } from "../../../scripts/human-gate-act.mjs";
import {
  landedDoneRoles,
  terminalDoneRoles,
} from "../../../scripts/stale-blocker-edges.mjs";
import { readJsonFile } from "./json-input.mjs";
import { readLedger } from "./ledger.mjs";
import { blockingGapRepo, listSetupGaps } from "./ledger-setup-gaps.mjs";
import { fetchGithubBacklog, fetchGithubQueue } from "./queue-github.mjs";
import { readInFlight, readRestores } from "./stale-links-state.mjs";

export { parseJson, readJsonFile } from "./json-input.mjs";

const NORMALIZERS = { jira: normalizeJiraIssue, linear: normalizeLinearIssue };

/**
 * Check one paged envelope and normalize its raw issues.
 * @param {unknown} envelope - `{complete, pages, items}`
 * @param {string} where - Where it came from, for messages
 * @param {"jira"|"linear"} tracker - Vendor
 * @param {readonly string[]} doneRoles - Configured terminal done names, so
 *   a blocker there counts as finished (#5065)
 * @returns {{ items: object[], pages: unknown }} Normalized items
 */
function normalizeEnvelope(envelope, where, tracker, judging) {
  asSetupError(() => assertPagedToCompletion(envelope));
  if (!Array.isArray(envelope.items)) {
    throw new CliError(`${where}: items must be an array.`, 2);
  }
  return {
    items: envelope.items.map(item => NORMALIZERS[tracker](item, judging)),
    pages: envelope.pages ?? null,
  };
}

/**
 * Read a vendor-skill envelope and normalize its raw issues. With
 * `withBacklog`, the envelope must also carry `backlog`, a second
 * `{complete, pages, items}` envelope held to the same paging rule.
 * @param {object} ctx - CLI context
 * @param {"jira"|"linear"} tracker - Vendor
 * @param {boolean} withBacklog - Whether the backlog tier is required
 * @param {ReturnType<typeof loadProject>} project - Loaded project
 * @returns {{ items: object[], pages: unknown, backlog: { items: object[], pages: unknown } | null }} Normalized items
 */
function readEnvelopeQueue(ctx, tracker, withBacklog, project) {
  const file = ctx.values.input;
  if (!file) {
    throw new CliError(`queue --tracker ${tracker} needs --input <file>.`, 2);
  }
  const envelope = readJsonFile(file);
  const config = { tracker, global: project.global, local: project.local };
  const judging = {
    doneRoles: terminalDoneRoles(config),
    landedRoles: landedDoneRoles(config),
  };
  const ready = normalizeEnvelope(envelope, file, tracker, judging);
  if (!withBacklog) return { ...ready, backlog: null };
  if (!envelope.backlog) {
    throw new CliError(
      `${file}: sessionManager.backlogPickup is on, so the input needs a ` +
        `"backlog" envelope {complete:true,pages,items} of open leaf items ` +
        `in no lifecycle role.`,
      2
    );
  }
  return {
    ...ready,
    backlog: normalizeEnvelope(
      envelope.backlog,
      `${file} backlog`,
      tracker,
      judging
    ),
  };
}

/**
 * Refs waiting on a human: every ledger item with a pending question.
 * @param {{items: Record<string, {pendingQuestion?: unknown}>}} ledger - Ledger
 * @returns {Set<string>} Refs
 */
function pendingRefs(ledger) {
  return new Set(
    Object.entries(ledger.items)
      .filter(([, item]) => item.pendingQuestion)
      .map(([ref]) => ref)
  );
}

/**
 * Move items waiting on a human out of `ordered` into `excluded` with reason
 * `pending-question` (#4555). The item stays marked for its human; every
 * other item is still dispatched, so one question never stalls the queue.
 * @param {{ordered: {ref: string}[], excluded: {ref: string, reason: string}[]}} order - Ordered tier
 * @param {Set<string>} waiting - Refs with a pending question
 * @returns {{ordered: {ref: string}[], excluded: {ref: string, reason: string}[]}} Filtered tier
 */
function withoutPending(order, waiting) {
  return {
    ...order,
    ordered: order.ordered.filter(item => !waiting.has(item.ref)),
    excluded: [
      ...order.excluded,
      ...order.ordered
        .filter(item => waiting.has(item.ref))
        .map(item => ({ ref: item.ref, reason: "pending-question" })),
    ],
  };
}

/**
 * Move items held by the stale-link state out of `ordered` into `excluded`:
 * `restore-owed` until `stale-links-restored` reads their put-back links
 * present, and `removal-unverified` until `stale-links-verify` reads back a
 * removal whose read-back failed. Only those items wait; every other item
 * still dispatches.
 * @param {{ordered: {ref: string}[], excluded: {ref: string, reason: string}[]}} order - Ordered tier
 * @param {Map<string, string>} held - Lower-cased ref -> reason
 * @returns {{ordered: {ref: string}[], excluded: {ref: string, reason: string}[]}} Filtered tier
 */
function withoutStaleLinkHolds(order, held) {
  const reasonOf = item => held.get(String(item.ref).toLowerCase());
  return {
    ...order,
    ordered: order.ordered.filter(item => reasonOf(item) === undefined),
    excluded: [
      ...order.excluded,
      ...order.ordered
        .filter(item => reasonOf(item) !== undefined)
        .map(item => ({ ref: item.ref, reason: reasonOf(item) })),
    ],
  };
}

/**
 * The items the stale-link state holds, by lower-cased ref.
 * @param {string} root - Project root
 * @returns {Map<string, string>} Ref -> reason
 */
function staleLinkHolds(root) {
  const key = ref => ref.toLowerCase();
  return new Map([
    ...Object.keys(readInFlight(root)).map(ref => [
      key(ref),
      "removal-unverified",
    ]),
    ...Object.keys(readRestores(root)).map(ref => [key(ref), "restore-owed"]),
  ]);
}

/**
 * Move items routed to a repo with a recorded setup gap out of `ordered` into
 * `excluded` with reason `setup-gap:<repo>` (#4820). Retrying cannot fix a
 * setup gap, so dispatching there would only fail the same way every cycle.
 * @param {{ordered: {ref: string, repoLabels?: string[]}[], excluded: {ref: string, reason: string}[]}} order - Ordered tier
 * @param {Record<string, object>} gaps - `control.setupGaps`
 * @param {boolean} multiRepo - Whether `sessionManager.repos` is set
 * @returns {{ordered: {ref: string}[], excluded: {ref: string, reason: string}[]}} Filtered tier
 */
function withoutSetupGaps(order, gaps, multiRepo) {
  const blocked = order.ordered.map(item => ({
    item,
    repo: blockingGapRepo(item, gaps, multiRepo),
  }));
  return {
    ...order,
    ordered: blocked.filter(row => row.repo === null).map(row => row.item),
    excluded: [
      ...order.excluded,
      ...blocked
        .filter(row => row.repo !== null)
        .map(row => ({ ref: row.item.ref, reason: `setup-gap:${row.repo}` })),
    ],
  };
}

/**
 * `queue --tracker <github|jira|linear>`: the Ready queue, the operator's
 * items first (`sessionManager.operatorIds`), then mine, then unassigned.
 * @param {object} ctx - CLI context
 * With `sessionManager.backlogPickup` on it also returns the backlog tier,
 * ordered the same way and always dispatched after every Ready item.
 * @param {object} ctx - CLI context
 * @returns {Promise<{ json: object }>}
 *   `{tracker,me,operators,total,pages,ordered,excluded,setupGaps,backlogPickup[,
 *   backlogTotal,backlogPages,backlogOrdered,backlogExcluded]}`
 */
export async function queue(ctx) {
  const tracker = ctx.values.tracker;
  if (tracker !== "github" && !Object.hasOwn(NORMALIZERS, tracker ?? "")) {
    throw new CliError("--tracker must be github, jira or linear.", 2);
  }
  const project = loadProject(ctx.root);
  const config = validOrAbsent(project);
  const backlogPickup = config?.backlogPickup === true;
  const { items, pages, backlog } =
    tracker === "github"
      ? {
          ...fetchGithubQueue(ctx, project),
          backlog: backlogPickup ? fetchGithubBacklog(ctx, project) : null,
        }
      : readEnvelopeQueue(ctx, tracker, backlogPickup, project);
  const ledger = await readLedger(ctx.root);
  const me = ctx.values.me ?? ledger.control.me ?? null;
  const operators = config?.operatorIds ?? [];
  // Resolved local-then-global like `human-gate-act.mjs policy`, so a hold
  // the project's mode keeps is never dispatched as Ready work (#4687).
  const gatePolicy = resolveHumanGatePolicy(project.local, project.global);
  const policy = {
    me,
    operators,
    trustedAuthorIds: config?.trustedAuthorIds ?? undefined,
    humanNeededLabel: humanNeededLabel(project, tracker),
    humanOnly: gatePolicy.humanOnly,
    humanGateMode: gatePolicy.mode,
  };
  const waiting = pendingRefs(ledger);
  const gaps = ledger.control.setupGaps;
  const multiRepo = Boolean(config?.repos);
  const held = staleLinkHolds(ctx.root);
  const order = withoutStaleLinkHolds(
    withoutSetupGaps(
      withoutPending(orderReadyQueue(items, policy), waiting),
      gaps,
      multiRepo
    ),
    held
  );
  const json = {
    tracker,
    me,
    operators,
    total: items.length,
    pages,
    ...order,
    setupGaps: listSetupGaps(ledger),
    backlogPickup,
  };
  if (!backlog) return { json };
  // An item both Ready and in the backlog fetch is Ready work; never twice.
  const readyRefs = new Set(items.map(item => item.ref));
  const backlogItems = backlog.items.filter(item => !readyRefs.has(item.ref));
  const tier = withoutStaleLinkHolds(
    withoutSetupGaps(
      withoutPending(
        orderBacklogQueue(backlogItems, {
          ...policy,
          validationFailures: ledger.validationFailures,
        }),
        waiting
      ),
      gaps,
      multiRepo
    ),
    held
  );
  return {
    json: {
      ...json,
      backlogTotal: backlogItems.length,
      backlogPages: backlog.pages,
      backlogOrdered: tier.ordered,
      backlogExcluded: tier.excluded,
    },
  };
}
