// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file npm-update-tracker-cancel.mjs
 * @description Cancellation and supersession closure for Jira and Linear work items
 * (CodySwannGT/lisa#4873). GitHub closes an issue as `not_planned` and proves the
 * Bot closed it through `closed_by`; Jira moves the ticket to the configured
 * canceled status and proves the author through the issue changelog, and Linear
 * moves the issue to the canceled workflow state and proves the actor through the
 * issue history. Either way, a closure the automation did not make never counts.
 * @module npm-updater
 */
import { required, operatorRefusal } from "./npm-update-invariants.mjs";

const PAGES = 20;
const HISTORY =
  "query LisaNpmIssueHistory($id: String!, $after: String) { issue(id: $id) { history(first: 100, after: $after) { nodes { createdAt actor { id } toState { id type } } pageInfo { hasNextPage endCursor } } } }";

/** Jira writes `+0000`; every timestamp the updater compares is normalized ISO-8601. */
export function isoTime(value) {
  const parsed = Date.parse(
    String(value ?? "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2")
  );
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

/** A closure by anyone but the automation identity is preserved, never adopted. */
function foreignClosure(ref) {
  return operatorRefusal(
    "closure is not the authenticated managed cancellation",
    `${ref} was closed by someone other than the npm updater's automation account, so the updater will not treat it as its own cancellation. Reopen it, or handle this update by hand.`
  );
}

/** Jira: one workflow transition into the configured canceled status. */
export function jiraCancel(jira, number) {
  return jira.moveTo(number, jira.lifecycle.canceled);
}

/** Jira: the newest status change must be into the canceled status, by the automation account. */
export async function jiraAssertCancelled(jira, number) {
  const changes = [];
  for (let page = 0; page < PAGES; page++) {
    const reply = await jira.call(
      `/issue/${jira.ref(number)}/changelog?startAt=${page * 100}&maxResults=100`,
      "issue"
    );
    required(Array.isArray(reply?.values), "provider page is not an array");
    changes.push(...reply.values);
    if (reply.isLast === true || !reply.values.length) break;
    required(page < PAGES - 1, "provider pagination exceeded bound");
  }
  const moves = changes
    .filter(entry => (entry.items ?? []).some(item => item.field === "status"))
    .sort((left, right) =>
      String(isoTime(left.created)).localeCompare(
        String(isoTime(right.created))
      )
    );
  const last = moves.at(-1);
  const into = last?.items.filter(item => item.field === "status").at(-1);
  required(
    String(into?.toString ?? "").toLowerCase() ===
      jira.lifecycle.canceled.toLowerCase(),
    "cancellation closure readback differs"
  );
  if (last.author?.accountId !== (await jira.myself()))
    throw foreignClosure(jira.ref(number));
}

/** Linear: the configured canceled state, else the team's one state of type `canceled`. */
export async function linearCanceledState(linear) {
  const states = (await linear.team()).states.nodes;
  const name = linear.lifecycle.canceled;
  const matches = name
    ? states.filter(state => state.name.toLowerCase() === name.toLowerCase())
    : states.filter(state => state.type === "canceled");
  required(
    matches.length === 1 && matches[0].type === "canceled",
    "configured Linear canceled state differs"
  );
  return matches[0];
}

/** Linear: one state update into the canceled state. */
export async function linearCancel(linear, number) {
  await linear.update(number, {
    stateId: (await linearCanceledState(linear)).id,
  });
}

/** Linear: the newest state change must be into the canceled state, by the automation user. */
export async function linearAssertCancelled(linear, number) {
  const canceled = await linearCanceledState(linear);
  const entries = [];
  let after = null;
  for (let page = 0; page < PAGES; page++) {
    const connection = (
      await linear.graphql(HISTORY, { id: linear.ref(number), after }, "issue")
    ).issue?.history;
    required(Array.isArray(connection?.nodes), "provider page is not an array");
    entries.push(...connection.nodes);
    if (!connection.pageInfo?.hasNextPage) break;
    required(page < PAGES - 1, "provider pagination exceeded bound");
    after = connection.pageInfo.endCursor;
  }
  const last = entries
    .filter(entry => entry.toState)
    .sort((left, right) =>
      String(left.createdAt).localeCompare(String(right.createdAt))
    )
    .at(-1);
  required(
    last?.toState?.id === canceled.id,
    "cancellation closure readback differs"
  );
  if (last.actor?.id !== (await linear.viewer()))
    throw foreignClosure(linear.ref(number));
}
