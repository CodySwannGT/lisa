/**
 * Shared fixtures for the orphan and hold sweep tests (CodySwannGT/lisa#4722):
 * canonical refs, a stale unassigned orphan, a held item, and `plan`, which
 * runs `planOrphanSweep` with a fixed clock and the base hold policy.
 * @module tests/unit/session-manager/support/orphan-fixtures
 */
import { planOrphanSweep } from "../../../../plugins/src/base/skills/lisa-session-manager/scripts/orphan-sweep.mjs";

export const REPO = "example-org/demo-repo";
export const NOW = "2026-11-13T12:00:00Z";
export const OLD = "2026-11-10T12:00:00Z";
export const RECENT = "2026-11-13T10:00:00Z";
export const ME = "lisa-bot";
export const OPERATOR = "op-login";
export const STRANGER = "someone-else";
export const NEEDED = "human-needed";
export const READY = "status:ready";
export const CLAIMED = "status:in-progress";
export const LIFECYCLE = [
  READY,
  CLAIMED,
  "status:blocked",
  "status:done",
  NEEDED,
];
export const MERGED_URL = `https://github.com/${REPO}/pull/9`;
export const TOPIC = "tenancy-audit-triage";
export const CREDENTIAL = "stripe-api-key";

/**
 * A canonical ref for issue `n`.
 * @param n - Issue number
 * @returns The ref
 */
export const ref = (n: number): string => `${REPO}#${n}`;

/**
 * An orphan candidate in the `claimed` role, stale and unassigned by default.
 * @param n - Issue number
 * @param extra - Field overrides
 * @returns The item
 */
export function orphan(n: number, extra: Record<string, unknown> = {}) {
  return {
    ref: ref(n),
    role: "claimed",
    labels: [CLAIMED],
    body: "Do the thing.",
    comments: [],
    assignees: [],
    updatedAt: OLD,
    pr: null,
    ...extra,
  };
}

/**
 * A body held the way the writers stamp it.
 * @param reason - The hold's slug
 * @returns The body
 */
export function heldBody(reason: string): string {
  return [
    "## Problem",
    "",
    "Something needs doing.",
    "",
    `Held for a human product call: ${reason.replaceAll("-", " ")}.`,
    `<!-- [lisa-human-gate] reason=${reason} -->`,
  ].join("\n");
}

/**
 * A hold candidate in the `ready` role, stale and unassigned by default.
 * @param n - Issue number
 * @param extra - Field overrides
 * @returns The hold
 */
export function hold(n: number, extra: Record<string, unknown> = {}) {
  return {
    ref: ref(n),
    labels: [READY, NEEDED],
    body: heldBody(CREDENTIAL),
    comments: [],
    assignees: [],
    updatedAt: OLD,
    ...extra,
  };
}

/** Options every case starts from. */
export const OPTS = {
  liveRefs: [] as string[],
  me: ME,
  operatorIds: [OPERATOR],
  now: NOW,
  humanNeededLabel: NEEDED,
  readyLabel: READY,
  lifecycleLabels: LIFECYCLE,
};

/**
 * Plan with the base options plus overrides.
 * @param input - Items and holds
 * @param input.items - Orphan candidates
 * @param input.holds - Hold candidates
 * @param opts - Option overrides
 * @returns The plan
 */
export function plan(
  input: { items?: unknown[]; holds?: unknown[] },
  opts: Record<string, unknown> = {}
) {
  return planOrphanSweep(input, { ...OPTS, ...opts });
}
