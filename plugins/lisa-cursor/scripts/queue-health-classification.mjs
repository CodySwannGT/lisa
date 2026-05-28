#!/usr/bin/env node
/**
 * Shared queue-health classification helpers for `/lisa:queue-status`.
 *
 * Queue readers normalize vendor-specific lifecycle data into the small set of
 * signals below so queue-status can distinguish quiet, healthy, stuck, and
 * misconfigured queues without inventing a second lifecycle vocabulary.
 */

export const QUEUE_HEALTH_VERDICTS = [
  "IDLE",
  "HEALTHY",
  "ATTENTION_NEEDED",
  "MISCONFIGURED",
];

/**
 * @typedef {"IDLE" | "HEALTHY" | "ATTENTION_NEEDED" | "MISCONFIGURED"} QueueHealthVerdict
 *
 * @typedef {{
 *   readonly queueResolved?: boolean
 *   readonly namespaceAdopted?: boolean
 *   readonly readyCount?: number
 *   readonly activeCount?: number
 *   readonly blockedCount?: number
 *   readonly stalledCount?: number
 *   readonly resolutionError?: string | null
 * }} QueueHealthInput
 */

/**
 * Classify a queue using the same high-level concepts intake and repair-intake
 * already rely on:
 * - queue must resolve from config;
 * - lifecycle namespace must be adopted/present;
 * - blocked or stalled work means operator attention is needed;
 * - otherwise ready or active work is healthy;
 * - otherwise the queue is truly idle.
 *
 * @param {QueueHealthInput} input
 * @returns {{
 *   readonly verdict: QueueHealthVerdict
 *   readonly reasons: readonly string[]
 *   readonly counts: Readonly<{
 *     ready: number
 *     active: number
 *     blocked: number
 *     stalled: number
 *     attentionNeeded: number
 *   }>
 * }}
 */
export function classifyQueueHealth(input = {}) {
  const counts = {
    ready: normalizeCount(input.readyCount),
    active: normalizeCount(input.activeCount),
    blocked: normalizeCount(input.blockedCount),
    stalled: normalizeCount(input.stalledCount),
  };
  const attentionNeeded = counts.blocked + counts.stalled;

  if (input.queueResolved === false || hasContent(input.resolutionError)) {
    return {
      verdict: "MISCONFIGURED",
      reasons: ["queue-unresolved"],
      counts: {
        ...counts,
        attentionNeeded,
      },
    };
  }

  if (input.namespaceAdopted === false) {
    return {
      verdict: "MISCONFIGURED",
      reasons: ["lifecycle-namespace-absent"],
      counts: {
        ...counts,
        attentionNeeded,
      },
    };
  }

  if (attentionNeeded > 0) {
    return {
      verdict: "ATTENTION_NEEDED",
      reasons: [
        counts.blocked > 0 ? "blocked-work-present" : null,
        counts.stalled > 0 ? "stalled-work-present" : null,
      ].filter(Boolean),
      counts: {
        ...counts,
        attentionNeeded,
      },
    };
  }

  if (counts.ready > 0 || counts.active > 0) {
    return {
      verdict: "HEALTHY",
      reasons: [
        counts.ready > 0 ? "ready-work-present" : null,
        counts.active > 0 ? "active-work-in-flight" : null,
      ].filter(Boolean),
      counts: {
        ...counts,
        attentionNeeded,
      },
    };
  }

  return {
    verdict: "IDLE",
    reasons: ["no-actionable-work"],
    counts: {
      ...counts,
      attentionNeeded,
    },
  };
}

/**
 * Combine individual queue verdicts into the overall queue-status verdict.
 *
 * @param {readonly { verdict: QueueHealthVerdict }[]} sections
 * @returns {QueueHealthVerdict}
 */
export function computeOverallQueueVerdict(sections) {
  const verdicts = sections.map(section => section.verdict);

  if (verdicts.includes("MISCONFIGURED")) {
    return "MISCONFIGURED";
  }
  if (verdicts.includes("ATTENTION_NEEDED")) {
    return "ATTENTION_NEEDED";
  }
  if (verdicts.includes("HEALTHY")) {
    return "HEALTHY";
  }
  return "IDLE";
}

/**
 * @param {number | null | undefined} value
 * @returns {number}
 */
function normalizeCount(value) {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/**
 * @param {string | null | undefined} value
 * @returns {boolean}
 */
function hasContent(value) {
  return typeof value === "string" && value.trim().length > 0;
}
