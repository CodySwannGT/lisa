/** Complete synthetic raw vendor objects for the existing reader contract. */
const REPO = "fixture/project";
export const page = (more: boolean, cursor: string) => ({
  hasNextPage: more,
  endCursor: cursor,
});
export const intakeRaw = {
  primary: {
    number: 1,
    title: "Whole issue",
    body: "# Entire primary\n## Links\nRelates to #2\n[lisa-human-gate] reason: product decision",
    state: "OPEN",
    labels: [{ name: "status:ready" }],
    assignees: [],
    comments: [
      { body: "Capped embedded comment, not the complete comments source" },
    ],
    author: { id: "17", login: "fixture" },
  },
  comments: [
    [
      {
        id: 1,
        body: "Full first comment",
        user: { id: 17, login: "fixture", type: "User" },
        created_at: "2026-10-01T00:00:00Z",
      },
    ],
    [
      {
        id: 2,
        body: "[lisa-human-gate-release] reason: product decision",
        user: { id: 17, login: "fixture", type: "User" },
        created_at: "2026-10-02T00:00:00Z",
      },
    ],
  ],
  graph: [
    {
      data: {
        repository: {
          issue: {
            id: "synthetic",
            parent: null,
            subIssues: {
              pageInfo: page(false, "end"),
              nodes: [],
            },
          },
        },
      },
    },
  ],
  history: [
    {
      data: {
        repository: {
          issue: {
            timelineItems: {
              pageInfo: page(true, "next"),
              nodes: [
                {
                  __typename: "LabeledEvent",
                  label: { name: "human-needed" },
                  actor: { login: "fixture" },
                },
              ],
            },
          },
        },
      },
    },
    {
      data: {
        repository: {
          issue: {
            timelineItems: {
              pageInfo: page(false, "end"),
              nodes: [
                {
                  __typename: "UnlabeledEvent",
                  label: { name: "human-needed" },
                  actor: { login: "fixture" },
                },
                {
                  __typename: "CrossReferencedEvent",
                  source: {
                    number: 3,
                    title: "Related PR",
                    state: "CLOSED",
                    repository: { nameWithOwner: REPO },
                  },
                },
              ],
            },
          },
        },
      },
    },
  ],
  pullRequests: [
    {
      data: {
        repository: {
          issue: {
            closedByPullRequestsReferences: {
              pageInfo: page(false, "end"),
              nodes: [],
            },
          },
        },
      },
    },
  ],
  blockedBy: [[]],
  blocking: [[]],
  related: {
    number: 2,
    title: "Closed related work",
    body: "Entire related body",
    state: "CLOSED",
    labels: [],
    comments: [],
  },
};
