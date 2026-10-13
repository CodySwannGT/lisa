#!/usr/bin/env node
/**
 * Vendor-neutral Ready-queue normalization and operator-first dispatch order.
 *
 * ## Why this exists
 *
 * Intake has always taken Ready work in whatever order the tracker returned
 * it, and `intake.assignee` only NARROWS a selection — it never ranks one. A
 * dispatcher that runs several workers at once needs a stable answer to "what
 * next?": work assigned to the operator first (the person the dispatcher works
 * for), then work assigned to me (the identity the tracker credential belongs
 * to, often an agent account rather than the operator), then unassigned work,
 * most urgent and oldest first. Work assigned to anyone else is theirs, so it
 * is excluded, never re-ordered. When the credential IS the operator's, the
 * first two groups coincide. With "me" as the only identity, an operator whose
 * credential is an agent account had every one of their own items excluded as
 * someone else's (CodySwannGT/lisa#4467).
 *
 * The three trackers disagree on every field this needs — GitHub has priority
 * LABELS, Linear a native 0..4 number where 0 means "none", Jira a priority
 * NAME from a scheme that varies by site — so each vendor gets one normalizer
 * onto a single item shape, and ordering only ever sees that shape.
 *
 * `queue-status-build-readers.mjs` reads raw GitHub only; Jira and Linear
 * arrive here already fetched by their vendor access skills. This module never
 * fetches: the caller pages the tracker to completion, and
 * {@link assertPagedToCompletion} refuses to order a half-read queue, because
 * a truncated sweep silently reorders by omission (#3529, #4105).
 *
 * Held items are judged by {@link isHumanGated}, the one shared answer to "is
 * a person holding this?", rather than by a local label check (#3805).
 * @module ready-queue-order
 */

import {
  DEFAULT_HUMAN_NEEDED_LABEL,
  isHumanGated,
} from "./intake-blocker-reprobe.mjs";

/** Rank for GitHub `priority:<value>` labels; no label ranks 4. */
const GITHUB_PRIORITY_RANKS = Object.freeze({
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
});
const GITHUB_NO_PRIORITY = 4;

/** Rank for Jira priority names, across the default and legacy schemes. */
const JIRA_PRIORITY_RANKS = Object.freeze({
  highest: 0,
  blocker: 0,
  high: 1,
  critical: 1,
  medium: 2,
  major: 2,
  low: 3,
  minor: 3,
  lowest: 4,
  trivial: 4,
});
const JIRA_UNKNOWN_PRIORITY = 5;

/** Linear native priority: 1 urgent .. 4 low, and 0 means no priority. */
const LINEAR_NO_PRIORITY = 4;

/** Linear workflow state types that leave a child finished. */
const LINEAR_FINISHED_STATE_TYPES = new Set(["completed", "canceled"]);

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
  return typeof value === "string" ? value : "";
}

/**
 * A stable id as a string, or null. Numeric GitHub ids become strings so every
 * comparison in this module is string-to-string.
 * @param {unknown} value
 * @returns {string | null}
 */
function idOrNull(value) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return Number.isSafeInteger(value) ? String(value) : null;
}

/**
 * Label names from strings, `{name}` objects or a GraphQL `{nodes}` connection.
 * @param {unknown} labels
 * @returns {string[]}
 */
function labelNames(labels) {
  const list = Array.isArray(labels)
    ? labels
    : Array.isArray(labels?.nodes)
      ? labels.nodes
      : [];
  return list
    .map(label => (typeof label === "string" ? label : text(label?.name)))
    .map(label => label.trim())
    .filter(label => label.length > 0);
}

/**
 * The `repo:<name>` labels, lowercased, as `repo-scope-split` reads them.
 * @param {readonly string[]} labels
 * @returns {string[]}
 */
function repoLabelsOf(labels) {
  return labels
    .map(label => label.toLowerCase())
    .filter(label => label.startsWith("repo:") && label.length > 5);
}

/**
 * Flatten an Atlassian Document Format node to plain text, one line per block.
 * A string description (the Markdown some access paths return) passes through.
 * @param {unknown} node
 * @returns {string}
 */
function adfText(node) {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return text(node.text);
  if (node.type === "hardBreak") return "\n";
  const children = Array.isArray(node.content) ? node.content : [];
  const joiner = node.type === "doc" ? "\n" : "";
  return children.map(adfText).join(joiner);
}

/**
 * Normalize one GitHub REST issue row. Returns null for a pull-request row,
 * which the issues endpoint returns alongside issues and which is never a
 * dispatchable leaf.
 * @param {Record<string, any>} issue - REST `issues` list row
 * @param {{ repo?: string }} [options] - `owner/repo`, else read from repository_url
 * @returns {ReturnType<typeof shape> | null}
 */
export function normalizeGithubIssue(issue, options = {}) {
  if (!issue || issue.pull_request) return null;
  const labels = labelNames(issue.labels);
  const ranks = labels
    .map(label => label.toLowerCase())
    .filter(label => label.startsWith("priority:"))
    .map(label => GITHUB_PRIORITY_RANKS[label.slice("priority:".length)])
    .filter(rank => rank !== undefined);
  const repo =
    text(options.repo) || text(issue.repository_url).split("/repos/")[1] || "";
  const summary = issue.sub_issues_summary;
  const assignee = issue.assignee ?? issue.assignees?.[0] ?? null;

  return shape({
    ref: `${repo}#${issue.number}`,
    title: text(issue.title),
    // GitHub "me" is the login (`gh api user --jq .login`), so match on it.
    assigneeId: idOrNull(assignee?.login),
    priorityRank: ranks.length > 0 ? Math.min(...ranks) : GITHUB_NO_PRIORITY,
    createdAt: text(issue.created_at),
    labels,
    body: text(issue.body),
    // Authors are trusted by stable id, never by login (ready-role-filing).
    authorId: idOrNull(issue.user?.id),
    isContainer: Number(summary?.total ?? 0) > Number(summary?.completed ?? 0),
  });
}

/**
 * Normalize one Jira REST/MCP issue. An epic (hierarchy level above 0) or an
 * issue with any subtask not yet in the done category is a container.
 * @param {Record<string, any>} issue - Issue with `key` and `fields`
 * @returns {ReturnType<typeof shape>}
 */
export function normalizeJiraIssue(issue) {
  const fields = issue?.fields ?? {};
  const labels = labelNames(fields.labels);
  const priority = text(fields.priority?.name).trim().toLowerCase();
  const type = fields.issuetype ?? {};
  const openSubtasks = (Array.isArray(fields.subtasks) ? fields.subtasks : [])
    .map(sub => sub?.fields?.status?.statusCategory?.key)
    .filter(category => category !== "done");

  return shape({
    ref: text(issue?.key),
    title: text(fields.summary),
    assigneeId: idOrNull(fields.assignee?.accountId),
    priorityRank: JIRA_PRIORITY_RANKS[priority] ?? JIRA_UNKNOWN_PRIORITY,
    createdAt: text(fields.created),
    labels,
    body: adfText(fields.description),
    authorId: idOrNull(fields.reporter?.accountId ?? fields.creator?.accountId),
    isContainer:
      Number(type.hierarchyLevel ?? 0) > 0 ||
      text(type.name).toLowerCase() === "epic" ||
      openSubtasks.length > 0,
  });
}

/**
 * Normalize one Linear GraphQL issue. An issue with any child not completed
 * or canceled is a container.
 * @param {Record<string, any>} issue - Issue node
 * @returns {ReturnType<typeof shape>}
 */
export function normalizeLinearIssue(issue) {
  const native = Number(issue?.priority ?? 0);
  const children = Array.isArray(issue?.children?.nodes)
    ? issue.children.nodes
    : Array.isArray(issue?.children)
      ? issue.children
      : [];
  const labels = labelNames(issue?.labels);

  return shape({
    ref: text(issue?.identifier),
    title: text(issue?.title),
    assigneeId: idOrNull(issue?.assignee?.id),
    priorityRank:
      Number.isInteger(native) && native >= 1 && native <= 4
        ? native - 1
        : LINEAR_NO_PRIORITY,
    createdAt: text(issue?.createdAt),
    labels,
    body: text(issue?.description),
    authorId: idOrNull(issue?.creator?.id),
    isContainer: children.some(
      child => !LINEAR_FINISHED_STATE_TYPES.has(child?.state?.type)
    ),
  });
}

/**
 * The one item shape every normalizer returns, in a fixed key order.
 * @param {{ ref: string, title: string, assigneeId: string | null, priorityRank: number, createdAt: string, labels: string[], body: string, authorId: string | null, isContainer: boolean }} input
 */
function shape(input) {
  return {
    ref: input.ref,
    title: input.title,
    assigneeId: input.assigneeId,
    priorityRank: input.priorityRank,
    createdAt: input.createdAt,
    labels: input.labels,
    body: input.body,
    authorId: input.authorId,
    isContainer: input.isContainer,
    repoLabels: repoLabelsOf(input.labels),
  };
}

/**
 * Why an item may not be dispatched, or null when it may.
 *
 * Order matters only for the reason reported: an item can fail several rules,
 * and "someone else owns it" is the most useful thing to say about it.
 * @param {Record<string, any>} item
 * @param {{ me: string | null, operators: ReadonlySet<string>, trusted: ReadonlySet<string>, humanNeededLabel: string }} context
 * @returns {string | null}
 */
function exclusionReason(item, context) {
  const assignee = idOrNull(item.assigneeId);
  if (
    assignee !== null &&
    assignee !== context.me &&
    !context.operators.has(assignee)
  ) {
    return "assigned-to-other";
  }
  if (item.isContainer === true) return "container";
  if (
    isHumanGated({
      labels: item.labels,
      body: item.body,
      comments: item.comments,
      trustedHumanActorIds: item.trustedHumanActorIds,
      humanNeededLabel: context.humanNeededLabel,
    })
  ) {
    return "human-gated";
  }
  if (
    context.trusted.size > 0 &&
    !context.trusted.has(idOrNull(item.authorId))
  ) {
    return "untrusted-author";
  }
  return null;
}

/**
 * @param {Record<string, any>} left
 * @param {Record<string, any>} right
 * @returns {number}
 */
function compareWithinGroup(left, right) {
  return (
    Number(left.priorityRank) - Number(right.priorityRank) ||
    text(left.createdAt).localeCompare(text(right.createdAt)) ||
    text(left.ref).localeCompare(text(right.ref))
  );
}

/**
 * Order normalized Ready items for dispatch: the operator's, then mine, then
 * unassigned.
 *
 * Group 0 is assigned to an operator, group 1 to `me`, group 2 unassigned;
 * within a group, priority rank ascending, then creation time ascending, then
 * ref as a stable tiebreak. Excluded items keep their input order. With no
 * `me` and no operators, every assigned item is someone else's — the safe
 * direction, since claiming assigned work steals it.
 *
 * `operators` match the way `me` does, against the normalized assignee id:
 * GitHub login, Jira accountId, Linear user id.
 * @param {readonly Record<string, any>[]} items - Normalized items
 * @param {{ me?: string | null, operators?: readonly unknown[], trustedAuthorIds?: readonly unknown[], humanNeededLabel?: string }} [options]
 * @returns {{ ordered: Record<string, any>[], excluded: { ref: string, reason: string }[] }}
 */
export function orderReadyQueue(items, options = {}) {
  const context = {
    me: idOrNull(options.me),
    operators: new Set((options.operators ?? []).map(idOrNull).filter(Boolean)),
    trusted: new Set(
      (options.trustedAuthorIds ?? []).map(idOrNull).filter(Boolean)
    ),
    humanNeededLabel: options.humanNeededLabel ?? DEFAULT_HUMAN_NEEDED_LABEL,
  };
  const judged = (items ?? []).map(item => ({
    item,
    reason: exclusionReason(item, context),
  }));
  const eligible = judged
    .filter(one => one.reason === null)
    .map(one => one.item);
  const group = item => {
    const assignee = idOrNull(item.assigneeId);
    if (assignee === null) return 2;
    return context.operators.has(assignee) ? 0 : 1;
  };

  return {
    ordered: [...eligible].sort(
      (left, right) =>
        group(left) - group(right) || compareWithinGroup(left, right)
    ),
    excluded: judged
      .filter(one => one.reason !== null)
      .map(one => ({ ref: one.item.ref, reason: one.reason })),
  };
}

/**
 * Refuse a queue envelope that was not paged to completion.
 *
 * The vendor fetch writes `{complete, pages, items}`; anything but a literal
 * `complete: true` means some pages may be missing, and ordering a partial
 * queue would dispatch the wrong item with full confidence.
 * @template T
 * @param {T} envelope - `{ complete: true, pages, items }`
 * @returns {T} The same envelope
 */
export function assertPagedToCompletion(envelope) {
  if (envelope?.complete !== true) {
    throw new Error(
      "Ready queue was not paged to completion (envelope.complete !== true); refusing to order a partial queue."
    );
  }
  return envelope;
}
