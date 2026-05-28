#!/usr/bin/env node
/**
 * Shared build-side queue readers for `/lisa:queue-status`.
 *
 * These helpers normalize vendor-specific build lifecycle items into a common
 * snapshot shape so queue-status can report lifecycle counts, actionable
 * highlights, and repair-intake signals without drifting from Lisa's build
 * lifecycle contract.
 */

import { classifyQueueHealth } from "./queue-health-classification.mjs";
import { resolveBuildLifecycleRoles } from "./queue-contract-resolution.mjs";

export const BUILD_LIFECYCLE_ORDER = [
  "ready",
  "claimed",
  "review",
  "blocked",
  "done",
];

const ACTIONABLE_ROLE_ORDER = ["blocked", "ready", "claimed", "review"];
const RAW_BUILD_READER_TRACKERS = new Set(["github"]);

const HIGHLIGHT_COPY = {
  blocked: {
    summary: "Oldest blocked build item",
    nextStep: "Run /lisa:repair-intake <queue> after clearing the blocker.",
  },
  stalled: {
    summary: "Oldest stalled build item likely actionable for repair-intake",
    nextStep:
      "Run /lisa:repair-intake <queue> to re-evaluate the stalled build item.",
  },
  ready: {
    summary: "Oldest ready build item awaiting intake",
    nextStep: "Run /lisa:intake <queue> to claim the next build issue.",
  },
  claimed: {
    summary: "Oldest claimed build item still in flight",
    nextStep:
      "Inspect the active implementation path before escalating to /lisa:repair-intake <queue>.",
  },
  review: {
    summary: "Oldest build item waiting in review",
    nextStep:
      "Check the linked PR or review handoff before re-running /lisa:intake <queue>.",
  },
};

/**
 * Read a GitHub-backed build queue snapshot from issue payloads.
 *
 * @param {{
 *   readonly issues?: readonly Record<string, any>[]
 *   readonly roles?: Record<string, any>
 *   readonly namespaceAdopted?: boolean
 *   readonly queueResolved?: boolean
 *   readonly queueArgument?: string
 *   readonly resolutionError?: string | null
 * }} input
 */
export function readGithubBuildQueueSnapshot(input = {}) {
  const roles = input.roles ?? resolveBuildLifecycleRoles({}, "github").roles;
  const normalizedItems = (input.issues ?? [])
    .map(issue => normalizeGithubBuildIssue(issue, roles))
    .filter(Boolean);

  return createBuildQueueSnapshot({
    tracker: "github",
    items: normalizedItems,
    roles,
    namespaceAdopted: input.namespaceAdopted,
    queueResolved: input.queueResolved,
    queueArgument: input.queueArgument,
    resolutionError: input.resolutionError,
  });
}

/**
 * Build a vendor-agnostic build queue snapshot from normalized lifecycle items.
 *
 * @param {{
 *   readonly tracker?: string
 *   readonly items?: readonly Record<string, any>[]
 *   readonly roles?: Record<string, any>
 *   readonly namespaceAdopted?: boolean
 *   readonly queueResolved?: boolean
 *   readonly queueArgument?: string
 *   readonly resolutionError?: string | null
 * }} input
 */
export function createBuildQueueSnapshot(input = {}) {
  const tracker = normalizeTracker(input.tracker);
  const unsupportedReaderError = resolveUnsupportedReaderError(input, tracker);
  const rawRoles = input.roles ?? {};
  const roles = normalizeRoles(rawRoles);
  const items = normalizeItems(input.items);
  const counts = buildLifecycleCounts(items);
  const repairSignals = buildRepairSignals(items, input.queueArgument);
  const highlights = buildActionableHighlights(
    items,
    repairSignals,
    input.queueArgument
  );
  const queueResolved =
    input.queueResolved ??
    (unsupportedReaderError
      ? false
      : typeof input.resolutionError !== "string");
  const namespaceAdopted =
    input.namespaceAdopted ?? inferNamespaceAdopted(items, rawRoles);
  const resolutionError =
    unsupportedReaderError ?? input.resolutionError ?? null;

  const health = classifyQueueHealth({
    queueResolved,
    namespaceAdopted,
    readyCount: counts.ready,
    activeCount: counts.claimed + counts.review,
    blockedCount: counts.blocked,
    stalledCount: repairSignals.stalled.length,
    resolutionError,
  });

  return {
    tracker,
    queueResolved,
    namespaceAdopted,
    roles,
    counts,
    highlights,
    repairSignals,
    health,
    resolutionError,
  };
}

/**
 * @param {Record<string, any>} issue
 * @param {Record<string, any>} roles
 * @returns {Record<string, any> | null}
 */
function normalizeGithubBuildIssue(issue, roles) {
  if (!issue || typeof issue !== "object") {
    return null;
  }

  const role = resolveGithubBuildRole(issue.labels, roles);

  return normalizeItem({
    id: String(issue.id ?? issue.number ?? issue.url ?? issue.title ?? ""),
    ref:
      issue.number !== undefined && issue.number !== null
        ? `#${issue.number}`
        : String(issue.url ?? issue.title ?? ""),
    title: String(issue.title ?? "").trim(),
    url: typeof issue.url === "string" ? issue.url : null,
    createdAt: issue.createdAt ?? null,
    updatedAt: issue.updatedAt ?? null,
    role,
    stalled: Boolean(issue.stalled),
  });
}

/**
 * @param {readonly any[] | undefined} labels
 * @param {Record<string, any>} roles
 * @returns {string | null}
 */
function resolveGithubBuildRole(labels, roles) {
  if (!Array.isArray(labels)) {
    return null;
  }

  const labelNames = new Set(
    labels
      .map(label =>
        typeof label === "string"
          ? label
          : typeof label?.name === "string"
            ? label.name
            : null
      )
      .filter(Boolean)
  );

  for (const role of BUILD_LIFECYCLE_ORDER) {
    if (role === "done") {
      if (resolveDoneRoleNames(roles).some(name => labelNames.has(name))) {
        return "done";
      }
      continue;
    }

    const configuredName = roles[role];
    if (configuredName && labelNames.has(configuredName)) {
      return role;
    }
  }

  return null;
}

/**
 * @param {Record<string, any> | undefined} roles
 * @returns {Record<string, any>}
 */
function normalizeRoles(roles) {
  return {
    ready:
      typeof roles?.ready === "string" && roles.ready.trim().length > 0
        ? roles.ready.trim()
        : "ready",
    claimed:
      typeof roles?.claimed === "string" && roles.claimed.trim().length > 0
        ? roles.claimed.trim()
        : "claimed",
    review:
      typeof roles?.review === "string" && roles.review.trim().length > 0
        ? roles.review.trim()
        : "review",
    blocked:
      typeof roles?.blocked === "string" && roles.blocked.trim().length > 0
        ? roles.blocked.trim()
        : "blocked",
    done: normalizeDoneRoles(roles?.done),
  };
}

/**
 * @param {string | undefined} tracker
 * @returns {string}
 */
function normalizeTracker(tracker) {
  return typeof tracker === "string" && tracker.trim().length > 0
    ? tracker.trim().toLowerCase()
    : "unknown";
}

/**
 * @param {Record<string, any>} input
 * @param {string} tracker
 * @returns {string | null}
 */
function resolveUnsupportedReaderError(input, tracker) {
  if (
    tracker === "unknown" ||
    RAW_BUILD_READER_TRACKERS.has(tracker) ||
    Object.hasOwn(input, "items")
  ) {
    return null;
  }

  return `vendor reader not implemented for build tracker '${tracker}'`;
}

/**
 * @param {Record<string, any> | undefined} done
 * @returns {Record<string, string>}
 */
function normalizeDoneRoles(done) {
  if (typeof done === "string" && done.trim().length > 0) {
    return { default: done.trim() };
  }

  const normalized = {};
  for (const [key, value] of Object.entries(done ?? {})) {
    if (typeof value === "string" && value.trim().length > 0) {
      normalized[key] = value.trim();
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : { default: "done" };
}

/**
 * @param {Record<string, any>} roles
 * @returns {readonly string[]}
 */
function resolveDoneRoleNames(roles) {
  return Object.values(normalizeDoneRoles(roles?.done));
}

/**
 * @param {readonly Record<string, any>[] | undefined} items
 * @returns {readonly Record<string, any>[]}
 */
function normalizeItems(items) {
  return (items ?? []).map(normalizeItem).filter(Boolean);
}

/**
 * @param {Record<string, any>} item
 * @returns {Record<string, any> | null}
 */
function normalizeItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const role =
    typeof item.role === "string" && BUILD_LIFECYCLE_ORDER.includes(item.role)
      ? item.role
      : null;

  return {
    id: String(item.id ?? item.ref ?? item.title ?? ""),
    ref: String(item.ref ?? item.id ?? item.title ?? ""),
    title: String(item.title ?? "").trim(),
    url: typeof item.url === "string" ? item.url : null,
    role,
    createdAt: normalizeTimestamp(item.createdAt),
    updatedAt: normalizeTimestamp(item.updatedAt),
    stalled: Boolean(item.stalled),
  };
}

/**
 * @param {readonly Record<string, any>[]} items
 */
function buildLifecycleCounts(items) {
  const counts = Object.fromEntries(
    BUILD_LIFECYCLE_ORDER.map(role => [role, 0])
  );

  for (const item of items) {
    if (item.role && counts[item.role] !== undefined) {
      counts[item.role] += 1;
    }
  }

  return counts;
}

/**
 * @param {readonly Record<string, any>[]} items
 * @param {string | undefined} queueArgument
 */
function buildRepairSignals(items, queueArgument) {
  const blocked = items
    .filter(item => item.role === "blocked")
    .sort(compareQueueItemsByCreatedAt)
    .map(toRepairSignalItem);
  const stalled = items
    .filter(item => item.stalled)
    .sort(compareQueueItemsByCreatedAt)
    .map(toRepairSignalItem);

  return {
    actionable: blocked.length > 0 || stalled.length > 0,
    blocked,
    stalled,
    suggestedCommand:
      blocked.length > 0 || stalled.length > 0
        ? expandHighlightNextStep(
            "Run /lisa:repair-intake <queue> to inspect the most actionable stuck build work.",
            queueArgument
          )
        : null,
  };
}

/**
 * @param {readonly Record<string, any>[]} items
 * @param {Record<string, any>} repairSignals
 * @param {string | undefined} queueArgument
 */
function buildActionableHighlights(items, repairSignals, queueArgument) {
  const highlights = [];

  const oldestStalled = repairSignals.stalled[0];
  if (oldestStalled) {
    highlights.push({
      role: "stalled",
      ref: oldestStalled.ref,
      title: oldestStalled.title,
      url: oldestStalled.url,
      createdAt: oldestStalled.createdAt,
      summary: HIGHLIGHT_COPY.stalled.summary,
      nextStep: expandHighlightNextStep(
        HIGHLIGHT_COPY.stalled.nextStep,
        queueArgument
      ),
    });
  }

  for (const role of ACTIONABLE_ROLE_ORDER) {
    const oldest = findOldestItemForRole(items, role);
    if (!oldest) {
      continue;
    }

    const copy = HIGHLIGHT_COPY[role];
    highlights.push({
      role,
      ref: oldest.ref,
      title: oldest.title,
      url: oldest.url,
      createdAt: oldest.createdAt,
      summary: copy.summary,
      nextStep: expandHighlightNextStep(copy.nextStep, queueArgument),
    });
  }

  return highlights;
}

/**
 * @param {readonly Record<string, any>[]} items
 * @param {string} role
 */
function findOldestItemForRole(items, role) {
  return (
    items
      .filter(item => item.role === role)
      .sort(compareQueueItemsByCreatedAt)[0] ?? null
  );
}

/**
 * @param {readonly Record<string, any>[]} items
 * @param {Record<string, any>} roles
 * @returns {boolean}
 */
function inferNamespaceAdopted(items, roles) {
  if (items.some(item => item.role)) {
    return true;
  }

  return (
    ["ready", "claimed", "review", "blocked"].some(
      role => typeof roles[role] === "string" && roles[role].trim().length > 0
    ) || hasConfiguredDoneRole(roles?.done)
  );
}

/**
 * @param {unknown} done
 * @returns {boolean}
 */
function hasConfiguredDoneRole(done) {
  if (typeof done === "string") {
    return done.trim().length > 0;
  }

  if (!done || typeof done !== "object") {
    return false;
  }

  return Object.values(done).some(
    value => typeof value === "string" && value.trim().length > 0
  );
}

/**
 * @param {Record<string, any>} item
 * @returns {Record<string, any>}
 */
function toRepairSignalItem(item) {
  return {
    ref: item.ref,
    title: item.title,
    url: item.url,
    createdAt: item.createdAt,
  };
}

/**
 * @param {string} template
 * @param {string | undefined} queueArgument
 * @returns {string}
 */
function expandHighlightNextStep(template, queueArgument) {
  return template.replace("<queue>", queueArgument ?? "queue");
}

/**
 * @param {Record<string, any>} left
 * @param {Record<string, any>} right
 * @returns {number}
 */
function compareQueueItemsByCreatedAt(left, right) {
  const leftMs = left.createdAt
    ? Date.parse(left.createdAt)
    : Number.POSITIVE_INFINITY;
  const rightMs = right.createdAt
    ? Date.parse(right.createdAt)
    : Number.POSITIVE_INFINITY;

  if (leftMs !== rightMs) {
    return leftMs - rightMs;
  }

  return String(left.ref).localeCompare(String(right.ref));
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function normalizeTimestamp(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
