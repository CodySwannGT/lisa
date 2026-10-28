/** Actual raw SKIPPED check runs obey existing substitute and waiver policy. */
import { describe, expect, it } from "vitest";
import {
  runTerminalReview,
  type TerminalScenario,
} from "../../helpers/review-terminal-fixture.js";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();
const REVIEWED = "Review completed";
/** Named CLI case with independently expected severity and observation. */
type Case = readonly [string, TerminalScenario, number, string, string];
const cases: readonly Case[] = [
  ["terminal pause without substitute", {}, 1, "not_reviewed", "failure"],
  [
    "SKIPPED cannot claim completed review from title",
    { title: REVIEWED },
    1,
    "not_reviewed",
    "failure",
  ],
  [
    "trusted exact-head substitute for paused reviewer",
    { marker: "current" },
    0,
    "substituted",
    "success",
  ],
  [
    "positive SKIPPED title still requires substitute",
    { title: REVIEWED, marker: "current" },
    0,
    "substituted",
    "success",
  ],
  [
    "existing exact default entitlement waiver",
    { title: "Review rate limited" },
    0,
    "waived",
    "neutral",
  ],
  [
    "existing exact custom waiver",
    {
      title: " Provider capacity exhausted ",
      waive: "provider capacity exhausted",
    },
    0,
    "waived",
    "neutral",
  ],
  [
    "custom waiver substring does not grant permission",
    {
      title: "Provider capacity exhausted later",
      waive: "Provider capacity exhausted",
    },
    1,
    "not_reviewed",
    "failure",
  ],
  [
    "custom proof never turns SKIPPED into completed review",
    { title: "Provider reviewed", satisfy: "Provider reviewed" },
    1,
    "not_reviewed",
    "failure",
  ],
  [
    "stale-head substitute denied",
    { marker: "stale" },
    1,
    "not_reviewed",
    "failure",
  ],
  [
    "other reviewer substitute denied",
    { marker: "other" },
    1,
    "not_reviewed",
    "failure",
  ],
  [
    "untrusted author substitute denied",
    { marker: "reader" },
    1,
    "not_reviewed",
    "failure",
  ],
  [
    "unreadable review surface denies substitute",
    { marker: "current", surface: "unread" },
    1,
    "not_reviewed",
    "failure",
  ],
  [
    "unresolved thread denies substitute",
    { marker: "current", surface: "thread" },
    1,
    "not_reviewed",
    "failure",
  ],
  [
    "head objection cannot be substituted",
    { marker: "current", surface: "objection" },
    1,
    "not_reviewed",
    "failure",
  ],
  [
    "queued check cannot be substituted",
    { state: null, title: "Review queued", marker: "current" },
    1,
    "undetermined",
    "failure",
  ],
  [
    "failed check cannot be substituted",
    { state: "failure", title: REVIEWED, marker: "current" },
    1,
    "objected",
    "failure",
  ],
  [
    "legacy error cannot be substituted",
    {
      state: "error",
      title: "Changes requested",
      legacy: true,
      marker: "current",
    },
    1,
    "objected",
    "failure",
  ],
  [
    "successful check proof remains valid",
    { state: "success", title: REVIEWED },
    0,
    "satisfied",
    "success",
  ],
  [
    "successful legacy proof remains valid",
    { state: "success", title: REVIEWED, legacy: true },
    0,
    "satisfied",
    "success",
  ],
  [
    "successful legacy waiver remains neutral",
    { state: "success", title: "Review rate limited", legacy: true },
    0,
    "waived",
    "neutral",
  ],
  [
    "SKIPPED check run outranks duplicate successful status",
    { selection: "duplicate" },
    1,
    "not_reviewed",
    "failure",
  ],
  [
    "newest successful run supersedes old skipped run",
    { selection: "newest-success" },
    0,
    "satisfied",
    "success",
  ],
  [
    "newest skipped run supersedes old successful run",
    {
      state: "success",
      title: REVIEWED,
      selection: "newest-skipped",
    },
    1,
    "not_reviewed",
    "failure",
  ],
];

describe("raw terminal skipped review evidence", () => {
  it.each(cases)("%s", (name, scenario, status, condition, conclusion) => {
    const observation = runTerminalReview(scenario, process.env);
    console.log(
      `TERMINAL_REVIEW_OBSERVATION ${JSON.stringify({ name, ...observation })}`
    );
    expect(observation.status).toBe(status);
    const result = JSON.parse(observation.stdout);
    expect(result.vacuity.gateConditions.CodeRabbit).toBe(condition);
    expect(result.vacuity.verdict.conclusion).toBe(conclusion);
    expect(result.vacuity.carried.unreviewed).toEqual([]);
    expect(result.vacuity.objection.unread).toBeUndefined();
    expect(result.vacuity.objection.objected).toBe(
      scenario.surface === "objection"
    );
    if (condition === "substituted")
      expect(result.vacuity.verdict.title).toMatch(/^SUBSTITUTED/);
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
  });
});
