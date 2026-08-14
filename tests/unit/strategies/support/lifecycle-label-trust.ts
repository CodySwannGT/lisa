/**
 * Shared fixtures for the lifecycle-label trust tests (#2539).
 *
 * The two issue fixtures are RECORDED from the live GitHub timeline API
 * (`gh api repos/CodySwannGT/lisa/issues/<n>/timeline`), not invented. They are
 * the pair the guard must be able to separate: #2470 is a bot claim 27s after
 * filing (false), #2494 is a bot label 3001s after filing that corroborated real
 * work. Both carry the SAME bot actor, which is why actor alone cannot decide.
 * @module tests/unit/strategies/support/lifecycle-label-trust
 */

export const READY = "status:ready";
export const IN_PROGRESS = "status:in-progress";
export const DONE = "status:done";
export const FICTIONAL = "status:whatever";

/** Env rungs — shipped somewhere, but NOT terminal. */
export const ON_DEV = "status:on-dev";
export const ON_STG = "status:on-stg";

export const HUMAN = { login: "CodySwannGT", type: "User" } as const;
export const BOT = { login: "coderabbitai[bot]", type: "Bot" } as const;

export const LABELED = "labeled";

export const IMPLAUSIBLE = "bot-actor-implausible-latency";
export const PLAUSIBLE = "bot-actor-plausible-latency";

/** #2470 was created at this instant; the bot stamped it 27s later. */
export const CREATED_2470 = "2026-08-13T08:33:48Z";

/** The instant `coderabbitai[bot]` stamped #2470 — 27s after filing. */
export const BOT_STAMP_2470 = "2026-08-13T08:34:15Z";

/** Recorded from the #2470 timeline. */
export const ISSUE_2470 = {
  issueCreatedAt: CREATED_2470,
  issueAuthor: HUMAN,
  labels: [READY, IN_PROGRESS],
  timeline: [
    {
      event: LABELED,
      label: { name: READY },
      actor: HUMAN,
      created_at: "2026-08-13T08:33:49Z",
    },
    {
      event: LABELED,
      label: { name: IN_PROGRESS },
      actor: BOT,
      created_at: BOT_STAMP_2470,
    },
  ],
} as const;

/** Recorded from the #2494 timeline. */
export const ISSUE_2494 = {
  issueCreatedAt: "2026-08-13T11:04:12Z",
  issueAuthor: HUMAN,
  labels: ["bug", IN_PROGRESS],
  timeline: [
    {
      event: LABELED,
      label: { name: "bug" },
      actor: HUMAN,
      created_at: "2026-08-13T11:04:14Z",
    },
    {
      event: LABELED,
      label: { name: IN_PROGRESS },
      actor: BOT,
      created_at: "2026-08-13T11:54:13Z",
    },
  ],
} as const;

/**
 * Collapse markdown line wrapping so prose assertions can match plain
 * substrings instead of backtracking-prone whitespace regexes.
 *
 * @param source raw markdown
 * @returns the same text with every whitespace run collapsed to one space
 */
export const flatten = (source: string): string => source.replace(/\s+/gu, " ");
