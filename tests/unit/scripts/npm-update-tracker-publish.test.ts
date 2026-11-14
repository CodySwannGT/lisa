/**
 * CodySwannGT/lisa#4873: the gate and publish phases for Jira- and
 * Linear-tracked hosts. The claim is proved by the tracker adapter against the
 * declared automation identity; a Linear UUID claim id is accepted where a
 * GitHub decimal one was required; the gate's GitHub request catalogue never
 * reads a GitHub issue or comment for a vendor work item; the pull request
 * declares the vendor key without a broken GitHub link; and the managed
 * backlink is written once through the adapter and read back exactly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allocateLeaf } from "../../../all/copy-overwrite/scripts/lib/npm-update-allocate.mjs";
import {
  createTracker,
  vendorBacklink,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker.mjs";
import { createGhRequests } from "../../../all/copy-overwrite/scripts/lib/npm-update-gh-requests.mjs";
import { controllerSubject } from "../../../all/copy-overwrite/scripts/lib/npm-update-controller-factory.mjs";
import { publicationBody } from "../../../all/copy-overwrite/scripts/lib/npm-update-publication.mjs";
import { publicFailure } from "../../../all/copy-overwrite/scripts/lib/npm-update-invariants.mjs";
import { withPrivateRoot } from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import { backlinkBody } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import { adfCodeBlock } from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker-wire.mjs";
import { CLAIM } from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import { fakeJira } from "../../support/npm-update-jira-fake.js";
import { fakeLinear } from "../../support/npm-update-linear-fake.js";
import {
  JIRA_CONFIG,
  JIRA_MAINTAINER,
  LINEAR_CONFIG,
  LINEAR_MAINTAINER,
  REGISTRY_METADATA,
  automation,
  codeHost,
  committedHost,
} from "../../support/npm-update-tracker-host.js";

const JIRA_ENV = { JIRA_API_TOKEN: "t", JIRA_LOGIN: "bot@example.test" };
const LINEAR_ENV = { LINEAR_API_KEY: "k" };
const PR_URL = "https://github.com/acme/widgets/pull/7";
const NOT_AUTOMATION = "was not made by the npm updater's automation account";

/**
 * Allocate one Jira or Linear work item against a fake tracker.
 * @param kind - Which tracker.
 * @returns The fake, its adapter and the allocation.
 */
async function allocated(kind: "jira" | "linear") {
  const config = {
    ...(kind === "jira" ? JIRA_CONFIG : LINEAR_CONFIG),
    automationProvenance: await automation(),
  };
  return withPrivateRoot(async (root, env) => {
    const maintainer = kind === "jira" ? JIRA_MAINTAINER : LINEAR_MAINTAINER;
    const host = await committedHost(root, env, maintainer);
    const fake =
      kind === "jira"
        ? fakeJira({ assignable: [JIRA_MAINTAINER] })
        : fakeLinear({ members: [LINEAR_MAINTAINER] });
    const tracker = createTracker(
      config,
      kind === "jira" ? JIRA_ENV : LINEAR_ENV,
      fake.transport
    )!;
    const allocation = await allocateLeaf({
      api: { ...codeHost(host.parent), tracker },
      config,
      ...host,
    });
    return { fake, tracker, allocation, config, host };
  });
}

/**
 * The signed claim fields of an allocation.
 * @param allocation - The allocation.
 * @param allocation.workItem - Its work item key.
 * @param allocation.claimCommentId - Its claim comment id.
 * @param allocation.claimSha256 - Its claim digest.
 * @returns The descriptor subset the adapter proves.
 */
function claimOf(allocation: {
  workItem: string;
  claimCommentId: string;
  claimSha256: string;
}) {
  return {
    workItem: allocation.workItem,
    claimCommentId: allocation.claimCommentId,
    claimSha256: allocation.claimSha256,
  };
}

describe("the publish-time claim proof for Jira and Linear", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(REGISTRY_METADATA)
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("accepts a Jira claim written by the configured automation accountId", async () => {
    const { tracker, allocation } = await allocated("jira");
    await expect(
      tracker.proveClaim(claimOf(allocation))
    ).resolves.toBeUndefined();
  });

  it("accepts a Linear claim whose comment id is a UUID", async () => {
    const { tracker, allocation } = await allocated("linear");
    expect(allocation.claimCommentId).not.toMatch(/^[1-9]\d*$/);
    await expect(
      tracker.proveClaim(claimOf(allocation))
    ).resolves.toBeUndefined();
  });

  it("refuses a Jira claim by any other user in plain words", async () => {
    const { fake, tracker, allocation } = await allocated("jira");
    const forged = (fake as ReturnType<typeof fakeJira>).comment(
      1,
      adfCodeBlock(CLAIM),
      "557058:someone-else"
    );
    const failure = await tracker
      .proveClaim({ ...claimOf(allocation), claimCommentId: forged.id })
      .then(
        () => undefined,
        (error: unknown) => publicFailure(error)
      );
    expect(failure).toContain(`The claim on PROJ-1 ${NOT_AUTOMATION}`);
  });

  it("refuses a Linear claim by any other user in plain words", async () => {
    const { fake, tracker, allocation } = await allocated("linear");
    const forged = (fake as ReturnType<typeof fakeLinear>).comment(
      1,
      CLAIM,
      "0f3c2a1b-4d5e-4f60-8a7b-9c0d1e2f3a40"
    );
    const failure = await tracker
      .proveClaim({ ...claimOf(allocation), claimCommentId: forged.id })
      .then(
        () => undefined,
        (error: unknown) => publicFailure(error)
      );
    expect(failure).toContain(`The claim on ENG-1 ${NOT_AUTOMATION}`);
  });
});

describe("the gate's GitHub catalogue for a vendor work item", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(REGISTRY_METADATA)
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("binds the Linear key and UUID claim, and never reads a GitHub issue or comment", async () => {
    const { allocation, config, host } = await allocated("linear");
    const descriptor = {
      parent: host.proposal.parent,
      workItem: allocation.workItem,
      claimCommentId: allocation.claimCommentId,
      runId: "10",
      runAttempt: "1",
    };
    for (const phase of ["stage-read", "hook-read"]) {
      const subject = controllerSubject(
        {
          config,
          policy: host.policy,
          proposal: host.proposal,
          allocation,
          descriptor,
        },
        phase,
        null
      );
      expect(subject.workItem).toBe("ENG-1");
      const endpoints = createGhRequests(subject).records.map(record =>
        record.args.join(" ")
      );
      expect(endpoints.join("\n")).not.toMatch(/issues|issue view/);
    }
  });

  it("keeps refusing a non-decimal claim on a GitHub subject", () => {
    expect(() =>
      createGhRequests({
        phase: "stage-read",
        repository: "acme/widgets",
        tracker: "acme/widgets",
        issue: "42",
        branch: `lisa/npm-${"a".repeat(64)}`,
        parent: "b".repeat(40),
        origin: { runId: "91", runAttempt: "2" },
        claim: "0f3c2a1b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
        recovery: null,
        maintainer: "maintainer",
        pr: null,
        proofs: [],
      })
    ).toThrow(/invalid closed GH subject/);
  });
});

describe("publication for a vendor work item", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(REGISTRY_METADATA)
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("declares the vendor key once and links no github.com issue", () => {
    const body = publicationBody({
      draft: { body: "Update.\n" },
      workItem: "ENG-1",
    });
    expect(body).toBe("Update.\n\nWork-Item: ENG-1\n");
    expect(
      publicationBody({ draft: { body: "Update.\n" }, workItem: "acme/w#4" })
    ).toBe(
      "Update.\n\nWork-Item: acme/w#4\n\nRelates to https://github.com/acme/w/issues/4\n"
    );
  });

  it.each(["jira", "linear"] as const)(
    "writes one %s backlink through the adapter and none on a rerun",
    async kind => {
      const { fake, tracker } = await allocated(kind);
      await vendorBacklink(tracker, 1, PR_URL);
      await vendorBacklink(tracker, 1, PR_URL);
      const comments = await tracker.comments(1);
      const backlinks = comments.filter(
        comment => comment.body === backlinkBody(PR_URL)
      );
      expect(backlinks).toHaveLength(1);
      if (kind === "jira") {
        const stored = (fake as ReturnType<typeof fakeJira>).issues[0]!
          .comments;
        // A plain paragraph, the form the Work-Item Traceability check reads.
        expect(JSON.stringify(stored.at(-1)!.body)).toContain('"paragraph"');
      } else {
        const stored = (fake as ReturnType<typeof fakeLinear>).issues[0]!
          .comments;
        expect(stored.at(-1)!.body).toBe(backlinkBody(PR_URL));
      }
    }
  );
});
