/** Literal provider admission tests use labelled response fixtures, not hosted authority. */
import { describe, expect, it } from "vitest";
import {
  createGhRequests,
  createGhState,
  prepareGhRequest,
  observeGhResponse,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-gh-requests.mjs";
import {
  githubHierarchyArgs,
  githubIssueViewArgs,
  backlinkBody,
  githubBacklinkListArgs,
} from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";

const subject = {
  phase: "stage-read",
  repository: "acme/widgets",
  tracker: "acme/widgets",
  issue: "42",
  branch: `lisa/npm-${"a".repeat(64)}`,
  parent: "b".repeat(40),
  origin: { runId: "91", runAttempt: "2" },
  claim: "123",
  recovery: null,
  maintainer: "maintainer",
  pr: null,
  proofs: [],
};
function native(value: unknown, status = 0) {
  return { status, signal: null, stdout: JSON.stringify(value), stderr: "" };
}
describe("closed canonical GH request families", () => {
  it("retains actual issue body fields and refuses additional authority-bearing arguments", () => {
    const scope = createGhRequests(subject);
    const state = createGhState(scope);
    const args = githubIssueViewArgs(subject.tracker, subject.issue);
    expect(prepareGhRequest(scope, state, args).kind).toBe("plain");
    for (const altered of [
      [...args, "--hostname", "elsewhere"],
      ["api", "repos/acme/elsewhere"],
      ["api", "--method", "DELETE", "repos/acme/widgets/issues/42"],
    ])
      expect(() => prepareGhRequest(scope, state, altered)).toThrow(/request/);
    expect(() => createGhRequests({ ...subject, phase: "unknown" })).toThrow();
  });
  it("requires a fresh successful hierarchy response for each exact cursor and consumes before execution", () => {
    const scope = createGhRequests(subject);
    const state = createGhState(scope);
    const first = githubHierarchyArgs(
      { repository: subject.tracker },
      subject.issue,
      null
    );
    const second = githubHierarchyArgs(
      { repository: subject.tracker },
      subject.issue,
      "opaque-cursor"
    );
    expect(() => prepareGhRequest(scope, state, second)).toThrow();
    const request = prepareGhRequest(scope, state, first);
    expect(() => prepareGhRequest(scope, state, first)).toThrow();
    observeGhResponse(
      scope,
      state,
      request,
      native({
        data: {
          repository: {
            issue: {
              subIssues: {
                nodes: [],
                pageInfo: { hasNextPage: true, endCursor: "opaque-cursor" },
              },
            },
          },
        },
      })
    );
    expect(prepareGhRequest(scope, state, second).kind).toBe("hierarchy");
    expect(() => prepareGhRequest(scope, state, second)).toThrow();
  });
  it("does not grant cursors from errors, malformed JSON or typed-field coercions", () => {
    for (const cursor of ["@/private/file", "true", "123", "null"]) {
      const scope = createGhRequests(subject);
      const state = createGhState(scope);
      const request = prepareGhRequest(
        scope,
        state,
        githubHierarchyArgs(
          { repository: subject.tracker },
          subject.issue,
          null
        )
      );
      expect(() =>
        observeGhResponse(
          scope,
          state,
          request,
          native({
            data: {
              repository: {
                issue: {
                  subIssues: {
                    nodes: [],
                    pageInfo: { hasNextPage: true, endCursor: cursor },
                  },
                },
              },
            },
          })
        )
      ).toThrow();
    }
    const scope = createGhRequests(subject);
    const state = createGhState(scope);
    const request = prepareGhRequest(
      scope,
      state,
      githubHierarchyArgs({ repository: subject.tracker }, subject.issue, null)
    );
    observeGhResponse(scope, state, request, native({}, 1));
    expect(() =>
      prepareGhRequest(
        scope,
        state,
        githubHierarchyArgs(
          { repository: subject.tracker },
          subject.issue,
          "cursor"
        )
      )
    ).toThrow();
  });
  it("permits only the canonical same-PR backlink derived from its genuine read-before-write", () => {
    const pr = { number: "8", url: "https://github.com/acme/widgets/pull/8" };
    const scope = createGhRequests({
      ...subject,
      phase: "publication-backlink",
      pr,
    });
    const state = createGhState(scope);
    const get = githubBacklinkListArgs(subject.tracker, subject.issue);
    const patch = [
      "api",
      "--method",
      "PATCH",
      "repos/acme/widgets/issues/comments/77",
      "--field",
      `body=${backlinkBody(pr.url)}`,
    ];
    expect(() => prepareGhRequest(scope, state, patch)).toThrow();
    const request = prepareGhRequest(scope, state, get);
    observeGhResponse(
      scope,
      state,
      request,
      native({
        sourceCount: 2,
        comments: [
          { id: 77, body: `[lisa-pr-link] ${pr.url}\n` },
          {
            id: 78,
            body: "[lisa-pr-link] https://github.com/acme/widgets/pull/9",
          },
        ],
      })
    );
    expect(prepareGhRequest(scope, state, patch).kind).toBe("write");
    expect(() => prepareGhRequest(scope, state, patch)).toThrow();
    expect(() =>
      prepareGhRequest(scope, state, [
        ...patch.slice(0, 3),
        "repos/acme/widgets/issues/comments/78",
        ...patch.slice(4),
      ])
    ).toThrow();
  });
  it("keeps writer operations absent from stage, hooks and PR validation", () => {
    for (const phase of [
      "stage-read",
      "hook-read",
      "publication-validate-pr",
    ]) {
      const scope = createGhRequests({ ...subject, phase });
      expect(() =>
        prepareGhRequest(scope, createGhState(scope), [
          "api",
          "--method",
          "POST",
          "repos/acme/widgets/issues/42/comments",
          "--field",
          "body=arbitrary",
        ])
      ).toThrow();
    }
  });
});
