/**
 * CodySwannGT/lisa#4859 review fixes for the Linear adapter: comment lists
 * page past 100 (N9), an incomplete search refuses (N9), the managed fence
 * survives awkward content and a human-written fence never counts as managed
 * (N9), and a non-GitHub config never silently falls back to GitHub (N7).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allocateLeaf,
  discoverPrior,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-allocate.mjs";
import { withPrivateRoot } from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import { createTracker } from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker.mjs";
import {
  fence,
  unfence,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker-wire.mjs";
import { CLAIM } from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import { publicFailure } from "../../../all/copy-overwrite/scripts/lib/npm-update-invariants.mjs";
import { fakeLinear } from "../../support/npm-update-linear-fake.js";
import {
  LINEAR_CONFIG,
  LINEAR_MAINTAINER,
  REGISTRY_METADATA,
  automation,
  codeHost,
  committedHost,
} from "../../support/npm-update-tracker-host.js";

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

describe("Linear issue connections are complete or refused", () => {
  it.each(["labels", "children", "inverseRelations"])(
    "refuses an issue whose %s connection never ends, naming the issue",
    async name => {
      const linear = fakeLinear({ truncated: [name] });
      linear.seed({});
      const failure = await trackerOver(linear)
        .issue(1)
        .then(
          () => undefined,
          (error: unknown) => error
        );
      expect(publicFailure(failure)).toContain(
        "Linear issue ENG-1 has more than 1000 labels, sub-issues or relations"
      );
      expect(publicFailure(failure)).toContain(
        "cannot confirm there is no hold or open blocker"
      );
    }
  );

  it("reads labels, sub-issues and relations past their first page by cursor (#4873)", async () => {
    const linear = fakeLinear();
    const issue = linear.seed({});
    for (let index = 0; index < 150; index++) issue.labels.push(`l-${index}`);
    for (let index = 0; index < 250; index++) issue.children.push(`c-${index}`);
    for (let index = 0; index < 120; index++)
      issue.relations.push({ type: "related", closed: false });
    issue.relations.push({ type: "blocks", closed: false });
    const read = await trackerOver(linear).issue(1);
    expect(read.children).toHaveLength(250);
    expect(read.blockers).toEqual([{ state: "open" }]);
    expect(read.labels.map(label => label.name)).toContain("l-149");
    const pages = (operation: string) =>
      linear.log
        .filter(entry => entry.operation === operation)
        .map(entry => entry.variables?.after);
    expect(pages("LisaNpmIssueLabels")).toEqual(["100"]);
    expect(pages("LisaNpmIssueChildren")).toEqual(["100", "200"]);
    expect(pages("LisaNpmIssueInverseRelations")).toEqual(["100"]);
  });

  it("requests an explicit 100-node bound and pageInfo for each issue connection", async () => {
    const linear = fakeLinear();
    const queries: string[] = [];
    linear.seed({});
    const tracker = createTracker(
      LINEAR_CONFIG,
      { LINEAR_API_KEY: "k" },
      async (url, init) => {
        queries.push(JSON.parse(String(init?.body)).query);
        return linear.transport(url, init);
      }
    )!;
    await tracker.issue(1);
    const issueQuery = queries.find(query => query.includes("LisaNpmIssue("))!;
    for (const name of ["labels", "children", "inverseRelations"])
      expect(issueQuery).toMatch(
        new RegExp(
          `${name}\\(first: 100\\) \\{ nodes \\{[^]*?pageInfo \\{ hasNextPage endCursor \\}`
        )
      );
  });
});

describe("an oversized unrelated issue in the relationship scan (#4873)", () => {
  afterEach(() => vi.restoreAllMocks());

  /**
   * Allocate with one unrelated npm-mentioning issue already in the team.
   * @param prepare - Shapes that unrelated issue.
   * @returns The allocation's work item, or its public failure.
   */
  async function allocateBeside(
    prepare: (issue: ReturnType<ReturnType<typeof fakeLinear>["seed"]>) => void
  ) {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(REGISTRY_METADATA)
    );
    const config = {
      ...LINEAR_CONFIG,
      automationProvenance: await automation(),
    };
    return withPrivateRoot(async (root, env) => {
      const host = await committedHost(root, env, LINEAR_MAINTAINER);
      const linear = fakeLinear({ members: [LINEAR_MAINTAINER] });
      prepare(linear.seed({ title: "Pin the npm registry mirror" }));
      const api = {
        ...codeHost(host.parent),
        tracker: createTracker(
          config,
          { LINEAR_API_KEY: "k" },
          linear.transport
        )!,
      };
      return allocateLeaf({ api, config, ...host }).then(
        result => result.workItem,
        (error: unknown) => publicFailure(error)
      );
    });
  }

  it("no longer stops allocation when that issue has more than 100 labels, sub-issues and relations", async () => {
    expect(
      await allocateBeside(issue => {
        for (let index = 0; index < 150; index++) {
          issue.labels.push(`l-${index}`);
          issue.children.push(`c-${index}`);
          issue.relations.push({ type: "related", closed: true });
        }
      })
    ).toBe("ENG-2");
  });

  it("names that issue when its inventory is past the bound", async () => {
    expect(
      await allocateBeside(issue => {
        for (let index = 0; index < 1001; index++)
          issue.labels.push(`l-${index}`);
      })
    ).toContain("Linear issue ENG-1 has more than 1000");
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
