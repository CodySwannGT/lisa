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
 * The selection rule is executed, not only matched: the shipped `jq` programs
 * are run against fixture comment and review lists, because a filter that reads
 * correctly can still select the wrong reviews.
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

/**
 * The skill's own one-line summary. The Codex copy shortens the frontmatter
 * description and carries the full text as the first body line.
 * @param root - Copy root.
 * @param content - Whole skill text.
 * @returns The full description text.
 */
function summary(root: string, content: string): string {
  if (!root.includes(".codex-plugin"))
    return /^description: (.*)$/m.exec(content)?.[1] ?? "";
  const afterFrontmatter = content.indexOf("\n---\n", 4) + "\n---\n".length;
  return (
    content
      .slice(afterFrontmatter)
      .split("\n")
      .find(line => line.trim() !== "") ?? ""
  );
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

  it("fetches the reviews and the PR's issue comments, paginated", () => {
    const step = section(content, "Step 1c");
    expect(step).toContain(
      "gh api --paginate repos/<owner>/<repo>/pulls/<pr>/reviews --slurp"
    );
    expect(step).toContain(
      "gh api --paginate repos/<owner>/<repo>/issues/<pr>/comments --slurp"
    );
    expect(step).toMatch(/outside diff range/i);
    expect(step).toMatch(/nitpick/i);
  });

  it("keeps non-dismissed, non-empty bodies from every head, older ones included", () => {
    expect(selectReviews([], REVIEWS)).toEqual([1, 2, 5]);
    expect(section(content, "Step 1c")).not.toMatch(/commit_id == \$head/);
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

  it("answers body items in a quoting PR comment that carries one marker per review", () => {
    const step = section(content, "Step 2");
    expect(step).toMatch(/review-body item/i);
    expect(step).toContain("gh pr comment <pr>");
    expect(step).toMatch(/quot/i);
    expect(step).toContain("<!-- [lisa-review-body] review=<id> -->");
    expect(step).toMatch(/already addressed in <sha>/);
    expect(step).toMatch(/no thread to resolve/i);
  });

  it("marks a summary-only review so it is not re-read and step (e) can dismiss it", () => {
    // A body with no actionable items used to get no marker, so it was re-read
    // every run and drive-pr-to-merge step (e) waited on it forever.
    const step1c = section(content, "Step 1c");
    expect(step1c).toMatch(/no actionable items still needs its marker/i);
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

  it("counts review-body items separately in the Step 4 report", () => {
    const step = section(content, "Step 4");
    expect(step).toContain("review-body items: N implemented / M answered");
    expect(step).toContain("summary-only reviews: <ids>");
  });

  it("says in its description and composition that it covers review bodies", () => {
    expect(summary(root, content)).toMatch(/review bod(y|ies)/i);
    expect(section(content, "Composition")).toMatch(/review bod(y|ies)/i);
  });
});

describe.each(ROOTS)("drive-pr-to-merge routes review bodies (%s)", root => {
  const content = readSkill(root, "lisa-drive-pr-to-merge");

  it("summarises the delegated cycle as threads AND review-body findings", () => {
    const start = content.indexOf("\n### d. Review comments");
    const end = content.indexOf("**A green review check is not proof", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const step = content.slice(start, end);
    expect(step).toMatch(/unresolved human \+ bot thread/);
    expect(step).toMatch(/review-body finding/);
  });

  it("never dismisses a stale change request whose body items are unmarked", () => {
    const start = content.indexOf("\n### e. ");
    const end = content.indexOf("\n### f. ", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const step = content.slice(start, end);
    expect(step).toMatch(
      /never dismiss a stale\s+`CHANGES_REQUESTED` review while its\s+body has items with no\s+`\[lisa-review-body\] review=<id>` marker/i
    );
    expect(step).toMatch(/through step\s+\(d\) first/);
  });

  it("counts the no-actionable-items marker as the marker that permits dismissal", () => {
    const start = content.indexOf("\n### e. ");
    const end = content.indexOf("\n### f. ", start);
    const step = content.slice(start, end);
    expect(step).toMatch(
      /`no actionable items` marker[^.]*summary-only body counts, because/i
    );
  });
});
