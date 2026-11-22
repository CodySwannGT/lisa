/**
 * Kind-keyed operator and trusted-author entries in the Ready-queue order
 * (CodySwannGT/lisa#4623).
 *
 * The queue matched every operator entry against the normalized assignee id
 * (a GitHub login, a Jira accountId, a Linear user id) and every trusted
 * author against the normalized author id (a GitHub NUMERIC id), so one
 * config value meant different identities to different readers. `login:`
 * now matches only a GitHub login and `id:` only an account id, on the
 * assignee and on the author alike; a plain entry keeps its old meaning.
 * @module tests/unit/scripts/ready-queue-order-id-kinds
 */
import { describe, expect, it } from "vitest";

import {
  normalizeGithubIssue,
  normalizeJiraIssue,
  orderReadyQueue,
} from "../../../plugins/src/base/scripts/ready-queue-order.mjs";

const AGENT = "agent-account";
const ASSIGNED_TO_OTHER = "assigned-to-other";
const UNTRUSTED = "untrusted-author";

/**
 * One raw GitHub REST issue row.
 * @param number - Issue number
 * @param assignee - Assignee `{login, id}`, or null
 * @returns Raw row
 */
function githubRow(
  number: number,
  assignee: { login: string; id: number } | null
) {
  return {
    number,
    title: `Issue ${number}`,
    body: "",
    created_at: `2026-01-0${number}T00:00:00Z`,
    user: { id: 583231, login: "author-login", type: "User" },
    assignee,
    assignees: assignee ? [assignee] : [],
    labels: [{ name: "status:ready" }],
    repository_url: "https://api.github.com/repos/acme/repo-a",
  };
}

/**
 * Normalize GitHub rows and order them for `policy`.
 * @param rows - Raw rows
 * @param policy - Ordering options
 * @returns The order
 */
function orderGithub(
  rows: ReturnType<typeof githubRow>[],
  policy: Record<string, unknown>
) {
  const items = rows
    .map(row => normalizeGithubIssue(row))
    .filter((item): item is NonNullable<typeof item> => item !== null);
  return orderReadyQueue(items, { me: AGENT, ...policy });
}

const OPERATOR = { login: "583231", id: 99999 };
const ITEM_1 = "acme/repo-a#1";
const ITEM_3 = "acme/repo-a#3";

describe("Scenario: The queue reads a kind-keyed operator the same way as the answer matcher", () => {
  it("orders an item assigned to login 583231 as the operator's for login:583231", () => {
    const result = orderGithub(
      [
        githubRow(1, null),
        githubRow(2, { login: AGENT, id: 5 }),
        githubRow(3, OPERATOR),
      ],
      { operators: ["login:583231"] }
    );
    expect(result.ordered.map(one => one.ref)).toEqual([
      ITEM_3,
      "acme/repo-a#2",
      ITEM_1,
    ]);
    expect(result.excluded).toEqual([]);
  });

  it("matches id:99999 against the assignee's numeric id, never its login", () => {
    const byId = orderGithub([githubRow(3, OPERATOR)], {
      operators: ["id:99999"],
    });
    expect(byId.excluded).toEqual([]);
    const loginOnly = orderGithub([githubRow(3, OPERATOR)], {
      operators: ["id:583231"],
    });
    expect(loginOnly.excluded).toEqual([
      { ref: ITEM_3, reason: ASSIGNED_TO_OTHER },
    ]);
  });

  it("matches a Jira assignee's accountId with an id: entry, never a login: entry", () => {
    const jira = normalizeJiraIssue({
      key: "TEAM-1",
      fields: {
        summary: "s",
        created: "t",
        assignee: { accountId: "557058:abc" },
        reporter: { accountId: "author" },
        issuetype: { name: "Story", hierarchyLevel: 0 },
        subtasks: [],
      },
    });
    expect(
      orderReadyQueue([jira], { me: AGENT, operators: ["id:557058:abc"] })
        .excluded
    ).toEqual([]);
    expect(
      orderReadyQueue([jira], { me: AGENT, operators: ["login:557058:abc"] })
        .excluded
    ).toEqual([{ ref: "TEAM-1", reason: ASSIGNED_TO_OTHER }]);
  });

  it("lets a malformed operator entry match nobody", () => {
    expect(
      orderGithub([githubRow(3, OPERATOR)], { operators: ["user:583231"] })
        .excluded
    ).toEqual([{ ref: ITEM_3, reason: ASSIGNED_TO_OTHER }]);
  });
});

describe("kind-keyed trusted authors", () => {
  it("trusts id:583231 by the author's numeric id", () => {
    expect(
      orderGithub([githubRow(1, null)], { trustedAuthorIds: ["id:583231"] })
        .excluded
    ).toEqual([]);
  });

  it("trusts login:author-login by the GitHub author's login", () => {
    expect(
      orderGithub([githubRow(1, null)], {
        trustedAuthorIds: ["login:author-login"],
      }).excluded
    ).toEqual([]);
  });

  it("never trusts login:583231 by a numeric id that equals it", () => {
    expect(
      orderGithub([githubRow(1, null)], { trustedAuthorIds: ["login:583231"] })
        .excluded
    ).toEqual([{ ref: ITEM_1, reason: UNTRUSTED }]);
  });
});

describe("Scenario: Existing plain entries behave exactly as before", () => {
  it("reads a plain all-digit operator as the GitHub assignee login", () => {
    const result = orderGithub([githubRow(3, OPERATOR)], {
      operators: ["583231"],
    });
    expect(result.excluded).toEqual([]);
    expect(
      orderGithub([githubRow(3, OPERATOR)], { operators: ["99999"] }).excluded
    ).toEqual([{ ref: ITEM_3, reason: ASSIGNED_TO_OTHER }]);
  });

  it("reads a plain trusted author as the numeric author id, never a login", () => {
    expect(
      orderGithub([githubRow(1, null)], { trustedAuthorIds: ["583231"] })
        .excluded
    ).toEqual([]);
    expect(
      orderGithub([githubRow(1, null)], { trustedAuthorIds: ["author-login"] })
        .excluded
    ).toEqual([{ ref: ITEM_1, reason: UNTRUSTED }]);
  });
});
