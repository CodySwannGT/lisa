#!/usr/bin/env node
/**
 * Shared PRD-side queue readers for `/lisa:queue-status`.
 *
 * These helpers normalize vendor-specific PRD lifecycle items into a common
 * snapshot shape so queue-status can report lifecycle counts, actionable
 * highlights, and queue-health verdict inputs without drifting from Lisa's PRD
 * lifecycle contract.
 */

import { classifyQueueHealth } from "./queue-health-classification.mjs";

export const PRD_LIFECYCLE_ORDER = [
  "draft",
  "ready",
  "in_review",
  "blocked",
  "ticketed",
  "shipped",
  "verified",
];

const ACTIONABLE_ROLE_ORDER = [
  "blocked",
  "in_review",
  "shipped",
  "ready",
  "ticketed",
];
const RAW_PRD_READER_SOURCES = new Set(["github"]);

const HIGHLIGHT_COPY = {
  blocked: {
    summary: "Oldest blocked PRD",
    nextStep: "Run /lisa:repair-intake <queue> after clarifying the blocker.",
  },
  in_review: {
    summary: "Oldest PRD still in review",
    nextStep:
      "Inspect the active intake run or resume it with /lisa:repair-intake <queue>.",
  },
  shipped: {
    summary: "Oldest shipped PRD awaiting verification",
    nextStep: "Run /lisa:verify-prd <item-url> to close the shipped loop.",
  },
  ready: {
    summary: "Oldest ready PRD awaiting intake",
    nextStep: "Run /lisa:intake <queue> to ticket the next PRD.",
  },
  ticketed: {
    summary: "Oldest ticketed PRD still waiting on downstream delivery",
    nextStep:
      "Monitor downstream build work or inspect the build queue with /lisa:queue-status queue=build.",
  },
};

/**
 * Read a GitHub-backed PRD queue snapshot from issue payloads.
 *
 * @param {{
 *   readonly issues?: readonly Record<string, any>[]
 *   readonly roles?: Record<string, string>
 *   readonly namespaceAdopted?: boolean
 *   readonly queueResolved?: boolean
 *   readonly queueArgument?: string
 *   readonly resolutionError?: string | null
 * }} input
 */
export function readGithubPrdQueueSnapshot(input = {}) {
  const roles = input.roles ?? {};
  const normalizedItems = (input.issues ?? [])
    .map(issue => normalizeGithubPrdIssue(issue, roles))
    .filter(Boolean);

  return createPrdQueueSnapshot({
    source: "github",
    items: normalizedItems,
    roles,
    namespaceAdopted: input.namespaceAdopted,
    queueResolved: input.queueResolved,
    queueArgument: input.queueArgument,
    resolutionError: input.resolutionError,
  });
}

/**
 * Build a vendor-agnostic PRD queue snapshot from normalized lifecycle items.
 *
 * @param {{
 *   readonly source?: string
 *   readonly items?: readonly Record<string, any>[]
 *   readonly roles?: Record<string, string>
 *   readonly namespaceAdopted?: boolean
 *   readonly queueResolved?: boolean
 *   readonly queueArgument?: string
 *   readonly resolutionError?: string | null
 * }} input
 */
export function createPrdQueueSnapshot(input = {}) {
  const source = normalizeSource(input.source);
  const unsupportedReaderError = resolveUnsupportedReaderError(input, source);
  const rawRoles = input.roles ?? {};
  const roles = normalizeRoles(rawRoles);
  const items = normalizeItems(input.items);
  const counts = buildLifecycleCounts(items);
  const highlights = buildActionableHighlights(items, input.queueArgument);
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
    activeCount: counts.in_review + counts.ticketed,
    blockedCount: counts.blocked,
    stalledCount: counts.shipped,
    resolutionError,
  });

  return {
    source,
    queueResolved,
    namespaceAdopted,
    roles,
    counts,
    highlights,
    health,
    resolutionError,
  };
}

/**
 * @param {Record<string, any>} issue
 * @param {Record<string, string>} roles
 * @returns {Record<string, any> | null}
 */
function normalizeGithubPrdIssue(issue, roles) {
  if (!issue || typeof issue !== "object") {
    return null;
  }

  const role = resolveGithubPrdRole(issue.labels, roles);

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
  });
}

/**
 * @param {readonly any[] | undefined} labels
 * @param {Record<string, string>} roles
 * @returns {string | null}
 */
function resolveGithubPrdRole(labels, roles) {
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

  for (const role of PRD_LIFECYCLE_ORDER) {
    const configuredName = roles[role];
    if (configuredName && labelNames.has(configuredName)) {
      return role;
    }
  }

  return null;
}

/**
 * @param {Record<string, string> | undefined} roles
 * @returns {Record<string, string>}
 */
function normalizeRoles(roles) {
  const normalized = {};

  for (const role of PRD_LIFECYCLE_ORDER) {
    normalized[role] =
      typeof roles?.[role] === "string" && roles[role].trim().length > 0
        ? roles[role].trim()
        : role;
  }

  return normalized;
}

/**
 * @param {string | undefined} source
 * @returns {string}
 */
function normalizeSource(source) {
  return typeof source === "string" && source.trim().length > 0
    ? source.trim().toLowerCase()
    : "unknown";
}

/**
 * @param {Record<string, any>} input
 * @param {string} source
 * @returns {string | null}
 */
function resolveUnsupportedReaderError(input, source) {
  if (
    source === "unknown" ||
    RAW_PRD_READER_SOURCES.has(source) ||
    Object.hasOwn(input, "items")
  ) {
    return null;
  }

  return `vendor reader not implemented for PRD source '${source}'`;
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
    typeof item.role === "string" && PRD_LIFECYCLE_ORDER.includes(item.role)
      ? item.role
      : null;

  const createdAt = normalizeTimestamp(item.createdAt);
  const updatedAt = normalizeTimestamp(item.updatedAt);

  return {
    id: String(item.id ?? item.ref ?? item.title ?? ""),
    ref: String(item.ref ?? item.id ?? item.title ?? ""),
    title: String(item.title ?? "").trim(),
    url: typeof item.url === "string" ? item.url : null,
    role,
    createdAt,
    updatedAt,
  };
}

/**
 * @param {readonly Record<string, any>[]} items
 */
function buildLifecycleCounts(items) {
  const counts = Object.fromEntries(PRD_LIFECYCLE_ORDER.map(role => [role, 0]));

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
function buildActionableHighlights(items, queueArgument) {
  const highlights = [];

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
      nextStep: expandHighlightNextStep(
        copy.nextStep,
        queueArgument,
        oldest.url
      ),
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
 * @param {Record<string, string>} roles
 * @returns {boolean}
 */
function inferNamespaceAdopted(items, roles) {
  if (items.some(item => item.role)) {
    return true;
  }

  return Object.values(roles).some(
    value => typeof value === "string" && value.trim().length > 0
  );
}

/**
 * @param {string} template
 * @param {string | undefined} queueArgument
 * @param {string | null} itemUrl
 * @returns {string}
 */
function expandHighlightNextStep(template, queueArgument, itemUrl) {
  return template
    .replace("<queue>", queueArgument ?? "queue")
    .replace("<item-url>", itemUrl ?? "item URL");
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
