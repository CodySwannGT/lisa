/**
 * Comment storage, timestamps and comment routes of the in-memory Jira fake
 * (CodySwannGT/lisa#4859, #4873), split out to keep the fake within its size budget.
 * @module tests/support/npm-update-jira-fake-comments
 */
import type {
  JiraComment,
  JiraIssue,
  JiraStore,
  Route,
} from "./npm-update-jira-fake-types.js";

const ISSUE = "([A-Z]+-\\d+)";
const ATLASSIAN = "atlassian";
const API = "/rest/api/3";

/**
 * The current time as Jira writes it: millisecond ISO with a `+0000` offset.
 * @returns The timestamp.
 */
export function jiraNow() {
  return new Date().toISOString().replace("Z", "+0000");
}

/**
 * Find an issue by its `<PROJECT>-<N>` key.
 * @param store - Fake project.
 * @param key - Issue key.
 * @returns The issue, if stored.
 */
export function findIssue(store: JiraStore, key: string) {
  // Jira addresses an issue by its key or by its numeric id (10000 + number here).
  return store.issues.find(
    issue =>
      `${store.project}-${issue.number}` === key ||
      String(10_000 + issue.number) === key
  );
}

/**
 * A comment as Jira returns it.
 * @param comment - Stored comment.
 * @returns The comment JSON.
 */
export function commentJson(comment: JiraComment) {
  return {
    id: comment.id,
    body: comment.body,
    author: { accountId: comment.accountId, accountType: comment.accountType },
    created: comment.created,
    updated: comment.created,
  };
}

/**
 * Store one comment from the given account.
 * @param store - Fake project.
 * @param issue - Its ticket.
 * @param body - ADF body.
 * @param accountId - Author account.
 * @returns The stored comment.
 */
export function addComment(
  store: JiraStore,
  issue: JiraIssue,
  body: unknown,
  accountId = store.accountId
) {
  const total = store.issues.flatMap(item => item.comments).length;
  const comment = {
    id: String(20_000 + total),
    body,
    accountId,
    accountType: accountId === store.accountId ? store.accountType : ATLASSIAN,
    created: jiraNow(),
  };
  issue.comments.push(comment);
  return comment;
}

/**
 * Comment list (paged by startAt/maxResults), read and create routes, scoped to their issue.
 * @param store - Fake project.
 * @returns The routes.
 */
export function commentRoutes(store: JiraStore): Route[] {
  const commentPath = (suffix = "") =>
    new RegExp(`^${API}/issue/${ISSUE}/comment${suffix}$`);
  return [
    [
      "GET",
      commentPath(),
      (key, _body, url) => {
        const all = findIssue(store, key)!.comments.map(commentJson);
        const startAt = Number(url.searchParams.get("startAt") ?? 0);
        const maxResults = Number(url.searchParams.get("maxResults") ?? 50);
        const comments = all.slice(startAt, startAt + maxResults);
        return { startAt, maxResults, total: all.length, comments };
      },
    ],
    [
      "GET",
      commentPath("/(\\d+)"),
      (key, _body, url) => {
        const id = url.pathname.split("/").at(-1);
        const comment = findIssue(store, key)?.comments.find(
          item => item.id === id
        );
        return comment ? commentJson(comment) : undefined;
      },
    ],
    [
      "POST",
      commentPath(),
      (key, body) =>
        commentJson(addComment(store, findIssue(store, key)!, body.body)),
    ],
  ];
}
