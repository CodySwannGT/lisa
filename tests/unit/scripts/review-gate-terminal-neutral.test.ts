/** Completed raw NEUTRAL checks follow terminal policy without review credit. */
import { describe, expect, it } from "vitest";
import {
  runTerminalReview,
  type TerminalScenario,
} from "../../helpers/review-terminal-fixture.js";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();
/** Name, raw facts, exit, condition, published conclusion, and settlement. */
type Case = readonly [
  string,
  TerminalScenario,
  number,
  string,
  string,
  boolean,
];
const RATE_LIMITED = "Review rate limited";
const FINISHED = "Provider finished";
const REVIEWED = "Review completed";

// Each expected outcome comes from existing waiver/substitute and surface policy.
const cases: readonly Case[] = [
  [
    "N01 neutral exact default waiver with native rate-limit summary",
    {
      state: "neutral",
      title: RATE_LIMITED,
      summary:
        "Result: Rate limited - Review rate limited\n\nThe reviewer reached its request limit.",
    },
    0,
    "waived",
    "neutral",
    true,
  ],
  [
    "N02 neutral exact normalized custom waiver",
    {
      state: "neutral",
      title: " Provider capacity exhausted ",
      waive: "provider capacity exhausted",
    },
    0,
    "waived",
    "neutral",
    true,
  ],
  [
    "N03 neutral generic terminal result needs review",
    { state: "neutral", title: FINISHED },
    1,
    "not_reviewed",
    "failure",
    true,
  ],
  [
    "N04 neutral positive title grants no vendor review",
    { state: "neutral", title: REVIEWED },
    1,
    "not_reviewed",
    "failure",
    true,
  ],
  [
    "N05 neutral positive structured summary grants no vendor review",
    {
      state: "neutral",
      title: "Analysis finished",
      summary:
        "Result: Success - Review completed\n\nThe title and summary cannot override neutral.",
    },
    1,
    "not_reviewed",
    "failure",
    true,
  ],
  [
    "N06 neutral trusted exact-head substitute",
    { state: "neutral", title: FINISHED, marker: "current" },
    0,
    "substituted",
    "success",
    true,
  ],
  [
    "N07 neutral positive title still uses substitute",
    { state: "neutral", title: REVIEWED, marker: "current" },
    0,
    "substituted",
    "success",
    true,
  ],
  [
    "N08 neutral positive summary still uses substitute",
    {
      state: "neutral",
      title: "Analysis finished",
      summary:
        "Result: Success - Review completed\n\nControlled external result.",
      marker: "current",
    },
    0,
    "substituted",
    "success",
    true,
  ],
  [
    "N09 neutral exact waiver can receive trusted substitute",
    { state: "neutral", title: RATE_LIMITED, marker: "current" },
    0,
    "substituted",
    "success",
    true,
  ],
  [
    "N10 neutral stale-head substitute denied",
    { state: "neutral", title: FINISHED, marker: "stale" },
    1,
    "not_reviewed",
    "failure",
    true,
  ],
  [
    "N11 neutral wrong-context substitute denied",
    { state: "neutral", title: FINISHED, marker: "other" },
    1,
    "not_reviewed",
    "failure",
    true,
  ],
  [
    "N12 neutral read-only author substitute denied",
    { state: "neutral", title: FINISHED, marker: "reader" },
    1,
    "not_reviewed",
    "failure",
    true,
  ],
  [
    "N13 neutral unreadable surface denies substitute",
    {
      state: "neutral",
      title: FINISHED,
      marker: "current",
      surface: "unread",
    },
    1,
    "not_reviewed",
    "failure",
    true,
  ],
  [
    "N14 neutral open thread denies substitute",
    {
      state: "neutral",
      title: FINISHED,
      marker: "current",
      surface: "thread",
    },
    1,
    "not_reviewed",
    "failure",
    true,
  ],
  [
    "N15 neutral head objection denies substitute",
    {
      state: "neutral",
      title: FINISHED,
      marker: "current",
      surface: "objection",
    },
    1,
    "not_reviewed",
    "failure",
    true,
  ],
  [
    "N16 neutral custom waiver substring denied",
    {
      state: "neutral",
      title: "Provider capacity exhausted later",
      waive: "Provider capacity exhausted",
    },
    1,
    "not_reviewed",
    "failure",
    true,
  ],
  [
    "N17 neutral custom proof cannot grant vendor review",
    {
      state: "neutral",
      title: "Provider reviewed",
      satisfy: "Provider reviewed",
    },
    1,
    "not_reviewed",
    "failure",
    true,
  ],
  [
    "N18 in-progress check remains in flight with substitute",
    { state: null, title: "Review in progress", marker: "current" },
    1,
    "undetermined",
    "failure",
    false,
  ],
  [
    "N19 queued raw status remains in flight with substitute",
    {
      state: null,
      runStatus: "queued",
      title: "Review queued",
      marker: "current",
    },
    1,
    "undetermined",
    "failure",
    false,
  ],
  [
    "N20 completed row missing conclusion remains in flight",
    {
      state: null,
      runStatus: "completed",
      title: REVIEWED,
      marker: "current",
    },
    1,
    "undetermined",
    "failure",
    false,
  ],
  [
    "N21 pending legacy status remains in flight",
    {
      state: "pending",
      legacy: true,
      title: "Review pending",
      marker: "current",
    },
    1,
    "undetermined",
    "failure",
    false,
  ],
  [
    "N22 successful structured first-line proof remains valid",
    {
      state: "success",
      title: "Finished",
      summary:
        "Result: Success - Review completed\n\nControlled external result.",
    },
    0,
    "satisfied",
    "success",
    true,
  ],
  [
    "N23 neutral check run outranks successful legacy status",
    { state: "neutral", title: FINISHED, selection: "duplicate" },
    1,
    "not_reviewed",
    "failure",
    true,
  ],
  [
    "N24 newest success supersedes older neutral",
    {
      state: "neutral",
      title: FINISHED,
      selection: "newest-success",
    },
    0,
    "satisfied",
    "success",
    true,
  ],
  [
    "N25 newest skipped supersedes older neutral",
    {
      state: "neutral",
      title: FINISHED,
      selection: "newest-skipped",
    },
    1,
    "not_reviewed",
    "failure",
    true,
  ],
  [
    "N26 exact neutral waiver cannot hide open thread",
    { state: "neutral", title: RATE_LIMITED, surface: "thread" },
    1,
    "objected",
    "failure",
    true,
  ],
  [
    "N27 exact neutral waiver retains existing unread-surface policy",
    { state: "neutral", title: RATE_LIMITED, surface: "unread" },
    0,
    "waived",
    "neutral",
    true,
  ],
  [
    "N28 exact neutral waiver cannot hide head objection",
    { state: "neutral", title: RATE_LIMITED, surface: "objection" },
    1,
    "objected",
    "failure",
    true,
  ],
  [
    "N29 failure cannot inherit an exact waiver",
    { state: "failure", title: RATE_LIMITED, marker: "current" },
    1,
    "objected",
    "failure",
    true,
  ],
];

describe("raw terminal neutral review evidence", () => {
  it.each(cases)(
    "%s",
    (name, scenario, status, condition, conclusion, settled) => {
      const observation = runTerminalReview(scenario, process.env);
      console.log(
        `TERMINAL_NEUTRAL_OBSERVATION ${JSON.stringify({
          name,
          ...observation,
          runtime: {
            node: process.version,
            execPath: process.execPath,
            platform: process.platform,
            arch: process.arch,
          },
        })}`
      );
      expect(observation.command[0]).toBe(process.execPath);
      expect(observation.status).toBe(status);
      const result = JSON.parse(observation.stdout);
      expect(result.vacuity.settled).toBe(settled);
      expect(result.vacuity.gateConditions.CodeRabbit).toBe(condition);
      expect(result.vacuity.verdict.conclusion).toBe(conclusion);
      expect(result.vacuity.carried.unreviewed).toEqual([]);
      expect(result.vacuity.objection.unread).toBeUndefined();
      expect(result.vacuity.objection.objected).toBe(
        scenario.surface === "objection"
      );
      if (condition === "substituted") {
        expect(result.vacuity.verdict.title).toMatch(/^SUBSTITUTED/);
        expect(result.vacuity.violations).toEqual([]);
      }
      if (condition === "not_reviewed")
        expect(result.vacuity.gateStates.CodeRabbit).toBe("unsatisfied");
      if (condition === "waived")
        expect(result.vacuity.gateStates.CodeRabbit).toBe("waived");
      if (condition !== "satisfied")
        expect(result.vacuity.verdict.title).not.toMatch(/^REVIEWED/);
      const refused = observation.calls.filter(row => row.refused);
      expect(refused).toHaveLength(scenario.surface === "unread" ? 1 : 0);
      expect(
        observation.calls.some(row => row.query?.includes(".check_runs"))
      ).toBe(true);
      expect(
        observation.calls.every(
          row =>
            row.args[0] === "api" ||
            (row.args[0] === "pr" && row.args[1] === "view")
        )
      ).toBe(true);
    }
  );
});
