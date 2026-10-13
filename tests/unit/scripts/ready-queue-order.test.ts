/**
 * Mine-first Ready-queue ordering, proven per vendor.
 *
 * The session manager dispatches from one ordered list, so the three tracker
 * shapes must collapse to one item shape before ordering. These tests pin the
 * normalizers (priority ranks, containers, pull-request rows), the ordering
 * (mine, then unassigned, then priority, age and ref), the exclusion reasons,
 * and the paging guard that refuses a half-read queue.
 * @module tests/unit/scripts/ready-queue-order
 */
import { describe, expect, it } from "vitest";

import {
  assertPagedToCompletion,
  normalizeGithubIssue,
  normalizeJiraIssue,
  normalizeLinearIssue,
  orderReadyQueue,
} from "../../../plugins/src/base/scripts/ready-queue-order.mjs";

const ME = "me-1";
const OTHER = "other-2";
const DAY_1 = "2026-01-01";
const DAY_2 = "2026-01-02";
const DAY_3 = "2026-01-03";
const ASSIGNED_TO_OTHER = "assigned-to-other";
const SHARED_SHAPE = "returns the shared item shape";

/** Keys of an object, sorted for a stable comparison. */
const sortedKeys = (value: object): string[] =>
  Object.keys(value).sort((left, right) => left.localeCompare(right));

/**
 * Narrow a normalizer result that must not be null, failing loudly if it is.
 * @param value - Normalizer result
 * @returns The non-null item
 */
function present<T>(value: T | null): T {
  if (value === null) throw new Error("expected a normalized item, got null");
  return value;
}

const SHAPE_KEYS = [
  "assigneeId",
  "authorId",
  "body",
  "createdAt",
  "isContainer",
  "labels",
  "priorityRank",
  "ref",
  "repoLabels",
  "title",
];

const githubIssue = ({
  number,
  assignee = null,
  priority,
  created,
  extra = {},
}: {
  number: number;
  assignee?: string | null;
  priority?: string | undefined;
  created: string;
  extra?: Record<string, unknown>;
}) => ({
  number,
  title: `Issue ${number}`,
  body: "Body",
  created_at: created,
  user: { id: 100, login: "author", type: "User" },
  assignee: assignee ? { id: 1, login: assignee } : null,
  assignees: assignee ? [{ id: 1, login: assignee }] : [],
  labels: [
    { name: "status:ready" },
    { name: "repo:api" },
    ...(priority ? [{ name: `priority:${priority}` }] : []),
  ],
  repository_url: "https://api.github.com/repos/acme/repo-a",
  ...extra,
});

const jiraIssue = ({
  key,
  assignee = null,
  priority,
  created,
  extra = {},
}: {
  key: string;
  assignee?: string | null;
  priority?: string | undefined;
  created: string;
  extra?: Record<string, unknown>;
}) => ({
  key,
  fields: {
    summary: `Summary ${key}`,
    description: "Body",
    created,
    labels: ["repo:web"],
    assignee: assignee ? { accountId: assignee } : null,
    reporter: { accountId: "author" },
    priority: priority ? { name: priority } : null,
    issuetype: { name: "Story", subtask: false, hierarchyLevel: 0 },
    subtasks: [],
    ...extra,
  },
});

const linearIssue = ({
  identifier,
  assignee = null,
  priority = 0,
  created,
  extra = {},
}: {
  identifier: string;
  assignee?: string | null;
  priority?: number;
  created: string;
  extra?: Record<string, unknown>;
}) => ({
  identifier,
  title: `Title ${identifier}`,
  description: "Body",
  createdAt: created,
  priority,
  assignee: assignee ? { id: assignee } : null,
  creator: { id: "author" },
  labels: { nodes: [{ name: "repo:api" }] },
  children: { nodes: [] },
  ...extra,
});

describe("normalizeGithubIssue", () => {
  it(SHARED_SHAPE, () => {
    const item = normalizeGithubIssue(
      githubIssue({ number: 12, assignee: ME, priority: "high", created: "t" })
    );
    expect(sortedKeys(present(item))).toEqual(SHAPE_KEYS);
    expect(item).toEqual({
      ref: "acme/repo-a#12",
      title: "Issue 12",
      assigneeId: ME,
      priorityRank: 1,
      createdAt: "t",
      labels: ["status:ready", "repo:api", "priority:high"],
      body: "Body",
      authorId: "100",
      isContainer: false,
      repoLabels: ["repo:api"],
    });
  });

  it.each([
    ["critical", 0],
    ["high", 1],
    ["medium", 2],
    ["low", 3],
    [undefined, 4],
  ])("ranks priority:%s as %i", (priority, rank) => {
    expect(
      normalizeGithubIssue(githubIssue({ number: 1, priority, created: "t" }))
        ?.priorityRank
    ).toBe(rank);
  });

  it("takes the most urgent of several priority labels", () => {
    const issue = githubIssue({ number: 1, priority: "low", created: "t" });
    issue.labels.push({ name: "Priority:Critical" });
    expect(normalizeGithubIssue(issue)?.priorityRank).toBe(0);
  });

  it("drops pull-request rows", () => {
    expect(
      normalizeGithubIssue(
        githubIssue({
          number: 2,
          created: "t",
          extra: { pull_request: { url: "x" } },
        })
      )
    ).toBeNull();
  });

  it("marks an issue with open sub-issues as a container", () => {
    const open = githubIssue({
      number: 3,
      created: "t",
      extra: { sub_issues_summary: { total: 3, completed: 1 } },
    });
    const done = githubIssue({
      number: 4,
      created: "t",
      extra: { sub_issues_summary: { total: 2, completed: 2 } },
    });
    expect(normalizeGithubIssue(open)?.isContainer).toBe(true);
    expect(normalizeGithubIssue(done)?.isContainer).toBe(false);
  });

  it("uses an explicit repo over repository_url, and a bare #N with neither", () => {
    const issue = githubIssue({ number: 5, created: "t" });
    expect(normalizeGithubIssue(issue, { repo: "acme/web" })?.ref).toBe(
      "acme/web#5"
    );
    const { repository_url: _ignored, ...bare } = issue;
    expect(normalizeGithubIssue(bare)?.ref).toBe("#5");
  });
});

describe("normalizeJiraIssue", () => {
  it(SHARED_SHAPE, () => {
    const item = normalizeJiraIssue(
      jiraIssue({
        key: "TEAM-1",
        assignee: ME,
        priority: "High",
        created: "t",
      })
    );
    expect(sortedKeys(item)).toEqual(SHAPE_KEYS);
    expect(item).toEqual({
      ref: "TEAM-1",
      title: "Summary TEAM-1",
      assigneeId: ME,
      priorityRank: 1,
      createdAt: "t",
      labels: ["repo:web"],
      body: "Body",
      authorId: "author",
      isContainer: false,
      repoLabels: ["repo:web"],
    });
  });

  it.each([
    ["Highest", 0],
    ["Blocker", 0],
    ["High", 1],
    ["Critical", 1],
    ["Medium", 2],
    ["Major", 2],
    ["Low", 3],
    ["Minor", 3],
    ["Lowest", 4],
    ["Trivial", 4],
    ["P9-custom", 5],
    [undefined, 5],
  ])("ranks %s as %i", (priority, rank) => {
    expect(
      normalizeJiraIssue(jiraIssue({ key: "TEAM-2", priority, created: "t" }))
        .priorityRank
    ).toBe(rank);
  });

  it("marks epics and issues with open subtasks as containers", () => {
    const epic = jiraIssue({
      key: "TEAM-3",
      created: "t",
      extra: { issuetype: { name: "Epic", hierarchyLevel: 1 } },
    });
    const parent = jiraIssue({
      key: "TEAM-4",
      created: "t",
      extra: {
        subtasks: [
          {
            key: "TEAM-5",
            fields: { status: { statusCategory: { key: "new" } } },
          },
        ],
      },
    });
    const finished = jiraIssue({
      key: "TEAM-6",
      created: "t",
      extra: {
        subtasks: [
          {
            key: "TEAM-7",
            fields: { status: { statusCategory: { key: "done" } } },
          },
        ],
      },
    });
    expect(normalizeJiraIssue(epic).isContainer).toBe(true);
    expect(normalizeJiraIssue(parent).isContainer).toBe(true);
    expect(normalizeJiraIssue(finished).isContainer).toBe(false);
  });

  it("flattens an ADF description to text", () => {
    const item = normalizeJiraIssue(
      jiraIssue({
        key: "TEAM-8",
        created: "t",
        extra: {
          description: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "One" }] },
              { type: "paragraph", content: [{ type: "text", text: "Two" }] },
            ],
          },
        },
      })
    );
    expect(item.body).toBe("One\nTwo");
  });
});

describe("normalizeLinearIssue", () => {
  it(SHARED_SHAPE, () => {
    const item = normalizeLinearIssue(
      linearIssue({
        identifier: "TEAM-9",
        assignee: ME,
        priority: 2,
        created: "t",
      })
    );
    expect(sortedKeys(item)).toEqual(SHAPE_KEYS);
    expect(item).toEqual({
      ref: "TEAM-9",
      title: "Title TEAM-9",
      assigneeId: ME,
      priorityRank: 1,
      createdAt: "t",
      labels: ["repo:api"],
      body: "Body",
      authorId: "author",
      isContainer: false,
      repoLabels: ["repo:api"],
    });
  });

  it.each([
    [1, 0],
    [2, 1],
    [3, 2],
    [4, 3],
    [0, 4],
  ])("ranks native priority %i as %i", (priority, rank) => {
    expect(
      normalizeLinearIssue(
        linearIssue({ identifier: "TEAM-10", priority, created: "t" })
      ).priorityRank
    ).toBe(rank);
  });

  it("marks an issue with open children as a container", () => {
    const open = linearIssue({
      identifier: "TEAM-11",
      created: "t",
      extra: { children: { nodes: [{ state: { type: "started" } }] } },
    });
    const closed = linearIssue({
      identifier: "TEAM-12",
      created: "t",
      extra: {
        children: {
          nodes: [
            { state: { type: "completed" } },
            { state: { type: "canceled" } },
          ],
        },
      },
    });
    expect(normalizeLinearIssue(open).isContainer).toBe(true);
    expect(normalizeLinearIssue(closed).isContainer).toBe(false);
  });

  it("accepts a flat label array", () => {
    const item = normalizeLinearIssue(
      linearIssue({
        identifier: "TEAM-13",
        created: "t",
        extra: { labels: [{ name: "Repo:Web" }] },
      })
    );
    expect(item.repoLabels).toEqual(["repo:web"]);
  });
});

const item = (
  ref: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  ref,
  title: ref,
  assigneeId: null,
  priorityRank: 4,
  createdAt: "2026-01-01T00:00:00Z",
  labels: [],
  body: "",
  authorId: "author",
  isContainer: false,
  repoLabels: [],
  ...overrides,
});

describe("orderReadyQueue", () => {
  it("puts mine first, then unassigned, ordering by priority, age, then ref", () => {
    const result = orderReadyQueue(
      [
        item("U-late", { priorityRank: 0, createdAt: "2026-02-01" }),
        item("U-early", { priorityRank: 0, createdAt: DAY_1 }),
        item("U-low", { priorityRank: 3, createdAt: "2025-01-01" }),
        item("M-low", { assigneeId: ME, priorityRank: 3 }),
        item("M-b", {
          assigneeId: ME,
          priorityRank: 1,
          createdAt: "2026-01-05",
        }),
        item("M-a", {
          assigneeId: ME,
          priorityRank: 1,
          createdAt: "2026-01-05",
        }),
      ],
      { me: ME }
    );
    expect(result.ordered.map(one => one.ref)).toEqual([
      "M-a",
      "M-b",
      "M-low",
      "U-early",
      "U-late",
      "U-low",
    ]);
    expect(result.excluded).toEqual([]);
  });

  it("does not mutate its input", () => {
    const items = Object.freeze([
      Object.freeze(item("B", { priorityRank: 1 })),
      Object.freeze(item("A", { priorityRank: 0 })),
    ]);
    expect(() => orderReadyQueue(items, { me: ME })).not.toThrow();
    expect(items.map(one => one.ref)).toEqual(["B", "A"]);
  });

  it("excludes with a reason per rule", () => {
    const result = orderReadyQueue(
      [
        item("other", { assigneeId: OTHER }),
        item("container", { isContainer: true }),
        item("gated", { labels: ["human-needed"] }),
        item("custom-gated", { labels: ["needs-person"] }),
        item("untrusted", { authorId: "stranger" }),
        item("ok"),
      ],
      {
        me: ME,
        trustedAuthorIds: ["author"],
        humanNeededLabel: "needs-person",
      }
    );
    expect(result.ordered.map(one => one.ref)).toEqual(["gated", "ok"]);
    expect(result.excluded).toEqual([
      { ref: "other", reason: ASSIGNED_TO_OTHER },
      { ref: "container", reason: "container" },
      { ref: "custom-gated", reason: "human-gated" },
      { ref: "untrusted", reason: "untrusted-author" },
    ]);
  });

  it("treats a body-declared hold as human-gated", () => {
    const result = orderReadyQueue(
      [item("held", { body: "<!-- [lisa-human-gate] reason=design -->" })],
      { me: ME }
    );
    expect(result.excluded).toEqual([{ ref: "held", reason: "human-gated" }]);
  });

  it("applies no author filter when trustedAuthorIds is empty or absent", () => {
    const items = [item("x", { authorId: "anyone" })];
    expect(orderReadyQueue(items, { me: ME }).ordered).toHaveLength(1);
    expect(
      orderReadyQueue(items, { me: ME, trustedAuthorIds: [] }).ordered
    ).toHaveLength(1);
  });

  it("excludes every assigned item as other's when me is unknown", () => {
    const result = orderReadyQueue(
      [item("x", { assigneeId: ME }), item("y")],
      {}
    );
    expect(result.ordered.map(one => one.ref)).toEqual(["y"]);
    expect(result.excluded).toEqual([{ ref: "x", reason: ASSIGNED_TO_OTHER }]);
  });

  describe("Gherkin: Dispatch order", () => {
    const cases = {
      jira: () => [
        normalizeJiraIssue(
          jiraIssue({
            key: "A",
            assignee: ME,
            priority: "Low",
            created: DAY_3,
          })
        ),
        normalizeJiraIssue(
          jiraIssue({ key: "B", priority: "Highest", created: DAY_2 })
        ),
        normalizeJiraIssue(
          jiraIssue({
            key: "C",
            assignee: OTHER,
            priority: "Highest",
            created: DAY_1,
          })
        ),
      ],
      github: () =>
        [
          githubIssue({
            number: 1,
            assignee: ME,
            priority: "low",
            created: DAY_3,
          }),
          githubIssue({
            number: 2,
            priority: "critical",
            created: DAY_2,
          }),
          githubIssue({
            number: 3,
            assignee: OTHER,
            priority: "critical",
            created: DAY_1,
          }),
        ].map(issue =>
          present(normalizeGithubIssue(issue, { repo: "acme/repo-a" }))
        ),
      linear: () => [
        normalizeLinearIssue(
          linearIssue({
            identifier: "A",
            assignee: ME,
            priority: 4,
            created: DAY_3,
          })
        ),
        normalizeLinearIssue(
          linearIssue({ identifier: "B", priority: 1, created: DAY_2 })
        ),
        normalizeLinearIssue(
          linearIssue({
            identifier: "C",
            assignee: OTHER,
            priority: 1,
            created: DAY_1,
          })
        ),
      ],
    };
    const refs = {
      jira: ["A", "B", "C"],
      github: ["acme/repo-a#1", "acme/repo-a#2", "acme/repo-a#3"],
      linear: ["A", "B", "C"],
    };

    it.each(Object.keys(cases) as (keyof typeof cases)[])(
      "orders A (mine, low) before B (unassigned, urgent) and excludes C on %s",
      tracker => {
        const [a, b, c] = refs[tracker];
        const result = orderReadyQueue(cases[tracker](), { me: ME });
        expect(result.ordered.map(one => one.ref)).toEqual([a, b]);
        expect(result.excluded).toEqual([
          { ref: c, reason: ASSIGNED_TO_OTHER },
        ]);
      }
    );
  });
});

describe("assertPagedToCompletion", () => {
  it("returns the envelope when complete is true", () => {
    const envelope = { complete: true, pages: 2, items: [] };
    expect(assertPagedToCompletion(envelope)).toBe(envelope);
  });

  it.each([
    [{ complete: false, pages: 1, items: [] }],
    [{ pages: 1, items: [] }],
    [{ complete: "true", items: [] }],
    [null],
    [undefined],
  ])("throws for %j", envelope => {
    expect(() => assertPagedToCompletion(envelope)).toThrow(/complete/u);
  });
});
