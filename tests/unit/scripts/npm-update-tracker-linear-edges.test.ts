/**
 * CodySwannGT/lisa#4859 review fixes for the Linear adapter: comment lists
 * page past 100 (N9), an incomplete search refuses (N9), the managed fence
 * survives awkward content and a human-written fence never counts as managed
 * (N9), and a non-GitHub config never silently falls back to GitHub (N7).
 */
import { describe, expect, it } from "vitest";
import { discoverPrior } from "../../../all/copy-overwrite/scripts/lib/npm-update-allocate.mjs";
import { createTracker } from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker.mjs";
import {
  fence,
  unfence,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker-wire.mjs";
import { CLAIM } from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import { fakeLinear } from "../../support/npm-update-linear-fake.js";
import { LINEAR_CONFIG } from "../../support/npm-update-tracker-host.js";

const SELECTION = "e".repeat(64);
const PROPOSAL = { repository: "acme/widgets", selectionKey: SELECTION };

/**
 * A Linear adapter over the given fake.
 * @param linear - The fake workspace.
 * @returns The adapter.
 */
function trackerOver(linear: ReturnType<typeof fakeLinear>) {
  return createTracker(
    LINEAR_CONFIG,
    { LINEAR_API_KEY: "k" },
    linear.transport
  )!;
}

describe("Linear pagination", () => {
  it("reads every comment past the first page of 100 by cursor", async () => {
    const linear = fakeLinear();
    linear.seed({});
    for (let index = 0; index < 150; index++)
      linear.comment(1, `comment ${index}`, "someone-else");
    const comments = await trackerOver(linear).comments(1);
    expect(comments).toHaveLength(150);
    expect(comments[149]!.body).toBe("comment 149");
    const pages = linear.log.filter(
      entry => entry.operation === "LisaNpmComments"
    );
    expect(pages.map(entry => entry.variables?.after)).toEqual([null, "100"]);
  });

  it("refuses prior discovery when the selection search has another page", async () => {
    const linear = fakeLinear();
    for (let index = 0; index < 101; index++)
      linear.seed({ description: `Selection key: ${SELECTION}` });
    const api = { tracker: trackerOver(linear) };
    expect((await api.tracker.searchPrior(PROPOSAL)).incomplete_results).toBe(
      true
    );
    await expect(discoverPrior(api, PROPOSAL)).rejects.toThrow(/incomplete/);
  });
});

describe("Linear managed fence", () => {
  it.each([
    "body with\n````\ninside",
    "ends with a fence\n````",
    "\n````lisa\nnested",
    "",
  ])("round-trips %j exactly", text => {
    expect(unfence(fence(text))).toBe(text);
  });

  it("leaves an unfenced human body unchanged", () => {
    expect(unfence("````lisa\nno closing fence")).toBe(
      "````lisa\nno closing fence"
    );
  });

  it("reads a human-written fenced claim as its text but never as a managed actor", async () => {
    const linear = fakeLinear();
    linear.seed({});
    linear.comment(1, fence(CLAIM), "someone-else");
    const tracker = trackerOver(linear);
    const [comment] = await tracker.comments(1);
    expect(comment!.body).toBe(CLAIM);
    expect(await tracker.isManagedActor(comment!.user)).toBe(false);
  });
});

describe("no silent GitHub fallback for a Jira or Linear config", () => {
  it("refuses prior discovery when a Linear config reaches an api without its adapter", async () => {
    const githubLike = {
      request: async () => {
        throw Error("GitHub search must not be reached");
      },
    };
    await expect(
      discoverPrior(githubLike, PROPOSAL, { cwd: "/x", config: LINEAR_CONFIG })
    ).rejects.toThrow(/configured tracker adapter differs/);
  });
});
