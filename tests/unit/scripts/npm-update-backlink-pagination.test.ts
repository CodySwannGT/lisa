/** Native GH page grammar remains canonical and bounded; fixtures grant no provider identity. */
import { describe, expect, it } from "vitest";
import {
  githubBacklinkListArgs,
  githubBacklinkComments,
  partitionBacklinks,
  backlinkBody,
} from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import {
  createGhRequests,
  createGhState,
  prepareGhRequest,
  observeGhResponse,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-gh-requests.mjs";
const url = "https://github.com/acme/widgets/pull/12";
const repository = "acme/widgets";
const subject = {
  phase: "publication-backlink",
  repository,
  tracker: repository,
  issue: "42",
  branch: `lisa/npm-${"a".repeat(64)}`,
  parent: "b".repeat(40),
  origin: { runId: "10", runAttempt: "1" },
  claim: "123",
  recovery: null,
  maintainer: "maintainer",
  pr: { number: "12", url },
  proofs: [],
};

describe("canonical backlink pagination", () => {
  it("finds only this PR's real managed comment on a later bounded page", () => {
    const pages = [
      Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        body: `Human comment ${index}`,
      })),
      [{ id: 101, body: `${backlinkBody(url)}\n` }],
    ];
    const args = githubBacklinkListArgs(repository, "42");
    expect(args).toEqual([
      "api",
      "--paginate",
      "--slurp",
      "repos/acme/widgets/issues/42/comments?per_page=100",
    ]);
    const comments = githubBacklinkComments(pages);
    expect(comments).toHaveLength(101);
    expect(
      partitionBacklinks(comments, url, comment =>
        comment && typeof comment === "object" && "body" in comment
          ? comment.body
          : undefined
      ).mine
    ).toHaveProperty("id", 101);
    const scope = createGhRequests(subject);
    const state = createGhState(scope);
    observeGhResponse(scope, state, prepareGhRequest(scope, state, args), {
      status: 0,
      stdout: JSON.stringify(pages),
    });
    const write = [
      "api",
      "--method",
      "PATCH",
      "repos/acme/widgets/issues/comments/101",
      "--field",
      `body=${backlinkBody(url)}`,
    ];
    expect(prepareGhRequest(scope, state, write).kind).toBe("write");
    expect(() => prepareGhRequest(scope, state, write)).toThrow(/exhausted/);
  });

  it("refuses malformed or over-bound pages before deriving writer authority", () => {
    for (const value of [
      [{ id: 1, body: backlinkBody(url) }],
      [Array(101).fill({})],
      Array(101).fill([]),
      { pages: [] },
    ])
      expect(() => githubBacklinkComments(value)).toThrow(/page/);
  });
});
