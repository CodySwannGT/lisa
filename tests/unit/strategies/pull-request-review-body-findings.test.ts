/**
 * Regression tests for CodySwannGT/lisa#4643 item 1: a finding that exists only
 * in a review BODY was never read.
 *
 * `lisa-pull-request-review` fetched GraphQL `reviewThreads` and nothing else.
 * CodeRabbit posts its "outside diff range" and "nitpick" comments in the review
 * body, with no thread, so those findings were never implemented, answered, or
 * reported — and `lisa-drive-pr-to-merge` step (d) hands all review feedback to
 * this skill, so nothing downstream caught them either.
 *
 * A push does not answer a review body, so reviews from earlier heads stay in
 * scope. What retires one is a `[lisa-review-body] review=<id>` marker in a PR
 * comment, which also makes re-runs idempotent.
 *
 * The selection rule is executed, not matched: the shipped `jq` programs are
 * run against fixture comment and review lists, because a filter that reads
 * correctly can still select the wrong reviews. The skills' guidance prose
 * around those programs is reviewed, not pinned.
 *
 * Every copy root is asserted so a missed `bun run build:plugins` fails the
 * suite.
 * @module tests/unit/strategies/pull-request-review-body-findings
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();

const ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-devin/skills",
  "plugins/lisa/.codex-plugin/skills",
] as const;

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const HANDLED_PREFIX = "-c ";
const REVIEWS_PREFIX = '--argjson handled "$handled" -c ';

const REVIEWS = [
  [
    {
      id: 1,
      user: { login: "bot" },
      state: "COMMENTED",
      commit_id: HEAD,
      body: "Outside diff range comments (1)",
    },
    {
      id: 2,
      user: { login: "bot" },
      state: "COMMENTED",
      commit_id: OLD,
      body: "Nitpick on an older head, never answered",
    },
    {
      id: 3,
      user: { login: "bot" },
      state: "DISMISSED",
      commit_id: HEAD,
      body: "Dismissed finding",
    },
  ],
  [
    {
      id: 4,
      user: { login: "human" },
      state: "APPROVED",
      commit_id: HEAD,
      body: "",
    },
    {
      id: 5,
      user: { login: "human" },
      state: "CHANGES_REQUESTED",
      commit_id: OLD,
      body: "Please rename this",
    },
  ],
];

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

/**
 * Slice a section from its line-anchored heading to the next `## ` heading.
 * @param content - Whole skill text.
 * @param heading - Heading text after `## `.
 * @returns The section body.
 */
function section(content: string, heading: string): string {
  const start = content.indexOf(`\n## ${heading}`);
  const next = content.indexOf("\n## ", start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  return content.slice(start, next === -1 ? content.length : next);
}

/**
 * Extract a shipped `jq` program from Step 1c by the arguments before it.
 * @param content - Whole skill text.
 * @param prefix - Literal text between `jq ` and the program's opening quote.
 * @returns The single-quoted jq program.
 */
function stepProgram(content: string, prefix: string): string {
  const step = section(content, "Step 1c");
  const opener = `jq ${prefix}'`;
  const start = step.indexOf(opener);
  const body = start + opener.length;
  expect(start).toBeGreaterThanOrEqual(0);
  return step.slice(body, step.indexOf("'", body));
}

/**
 * Run a shipped jq program over a fixture.
 * @param program - The jq program.
 * @param args - Arguments before `-c`.
 * @param input - Fixture value, serialised to stdin.
 * @returns The parsed output.
 */
function runJq(program: string, args: string[], input: unknown): unknown {
  const outcome = boundedSpawnSync({
    label: "shipped review-body jq",
    command: "jq",
    args: [...args, "-c", program],
    input: JSON.stringify(input),
  });
  expect(outcome.stderr).toBe("");
  expect(outcome.status).toBe(0);
  return JSON.parse(outcome.stdout);
}

describe.each(ROOTS)("pull-request-review reads review bodies (%s)", root => {
  const content = readSkill(root, "lisa-pull-request-review");
  const handledIds = (comments: unknown): unknown =>
    runJq(stepProgram(content, HANDLED_PREFIX), [], comments);
  const selectReviews = (handled: unknown, reviews: unknown): number[] =>
    (
      runJq(
        stepProgram(content, REVIEWS_PREFIX),
        ["--argjson", "handled", JSON.stringify(handled)],
        reviews
      ) as { id: number }[]
    ).map(review => review.id);

  it("keeps non-dismissed, non-empty bodies from every head, older ones included", () => {
    expect(selectReviews([], REVIEWS)).toEqual([1, 2, 5]);
  });

  it("skips a review an existing marker comment already answered", () => {
    const comments = [
      [
        {
          author_association: "OWNER",
          user: { type: "User" },
          body: "> Please rename this\nDone in abc1234\n<!-- [lisa-review-body] review=5 -->",
        },
        {
          author_association: "MEMBER",
          user: { type: "User" },
          body: "An unrelated comment mentioning review=2",
        },
      ],
      [
        {
          author_association: "NONE",
          user: { type: "Bot" },
          body: "<!-- [lisa-review-body] review=1 -->\nalready addressed",
        },
      ],
    ];
    const handled = handledIds(comments);
    expect(handled).toEqual([1, 5]);
    expect(selectReviews(handled, REVIEWS)).toEqual([2]);
  });

  it("ignores a marker posted by an outsider on a public repository", () => {
    // Anyone can comment on a public PR. A spoofed marker must neither hide a
    // finding nor clear the way for step (e) to dismiss the review.
    const comments = [
      [
        {
          author_association: "NONE",
          user: { type: "User" },
          body: "<!-- [lisa-review-body] review=2 -->",
        },
        {
          author_association: "CONTRIBUTOR",
          user: { type: "User" },
          body: "<!-- [lisa-review-body] review=5 -->",
        },
        {
          author_association: "COLLABORATOR",
          user: { type: "User" },
          body: "<!-- [lisa-review-body] review=1 -->",
        },
      ],
    ];
    const handled = handledIds(comments);
    expect(handled).toEqual([1]);
    expect(selectReviews(handled, REVIEWS)).toEqual([2, 5]);
  });

  it("handles empty comment and review lists without erroring", () => {
    const handled = handledIds([[]]);
    expect(handled).toEqual([]);
    expect(selectReviews(handled, [[]])).toEqual([]);
  });

  it("marks a summary-only review so it is not re-read and step (e) can dismiss it", () => {
    // A body with no actionable items used to get no marker, so it was re-read
    // every run and drive-pr-to-merge step (e) waited on it forever.
    const step = section(content, "Step 2");
    const template =
      /gh pr comment <pr> --body "(Review <id>: no actionable items[^"]*)"/.exec(
        step
      )?.[1];
    expect(template).toBeDefined();
    expect(template).toContain("<!-- [lisa-review-body] review=<id> -->");
    const body = (template ?? "").replaceAll("<id>", "2");
    const handled = handledIds([
      [{ author_association: "OWNER", user: { type: "User" }, body }],
    ]);
    expect(handled).toEqual([2]);
    expect(selectReviews(handled, REVIEWS)).toEqual([1, 5]);
  });
});
