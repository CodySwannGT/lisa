/**
 * CodySwannGT/lisa#4873: cancellation, supersession and signed-origin
 * recovery for Jira- and Linear-tracked hosts.
 *
 * - Who may cancel: a Jira/Linear maintainer is a tracker id, so the project
 *   names a GitHub `npmUpdater.cancelOperator` (operator decision on #4873).
 *   Absent, every cancel refuses with the key to set; GitHub hosts keep the
 *   maintainer's own login.
 * - The closure: Jira moves the ticket to the configured canceled status and
 *   Linear to the canceled state, and each proves through the changelog or
 *   history that the automation account made that move. A closure by anyone
 *   else is preserved, never adopted.
 * - Supersession and recovery no longer stop with the "not supported yet"
 *   refusal, and a Jira/Linear recovery reads no GitHub leaf or assignee.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  allocateLeaf,
  discoverPrior,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-allocate.mjs";
import {
  createTracker,
  assertManagedClosure,
  trackerPublishAuthority,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker.mjs";
import {
  cancelOperatorOf,
  validatePolicy,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-policy.mjs";
import { cancellationRecord } from "../../../all/copy-overwrite/scripts/lib/npm-update-cancellation-proof.mjs";
import { canceledName } from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker-cancel.mjs";
import { createGhRequests } from "../../../all/copy-overwrite/scripts/lib/npm-update-gh-requests.mjs";
import { publicFailure } from "../../../all/copy-overwrite/scripts/lib/npm-update-invariants.mjs";
import { withPrivateRoot } from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
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
  policyFor,
} from "../../support/npm-update-tracker-host.js";

const JIRA_ENV = { JIRA_API_TOKEN: "t", JIRA_LOGIN: "bot@example.test" };
const LINEAR_ENV = { LINEAR_API_KEY: "k" };
const OPERATOR = "release-captain";
const FOREIGN =
  "was closed by someone other than the npm updater's automation account";

/**
 * Text of a failure as the operator reads it.
 * @param promise - The operation.
 * @returns Its public failure, or undefined when it succeeded.
 */
async function failureOf(promise: Promise<unknown>) {
  return promise.then(
    () => undefined,
    (error: unknown) => publicFailure(error)
  );
}

describe("who may cancel a Jira/Linear-tracked update", () => {
  it("keeps the maintainer's own login for a GitHub host", () => {
    const config = { tracker: "github" };
    expect(cancelOperatorOf(config, { maintainer: "octocat" })).toBe("octocat");
  });

  it.each([
    ["jira", JIRA_CONFIG, JIRA_MAINTAINER],
    ["linear", LINEAR_CONFIG, LINEAR_MAINTAINER],
  ] as const)(
    "uses the declared GitHub cancelOperator for %s",
    (_tracker, config, maintainer) => {
      const policy = validatePolicy(
        { ...policyFor(maintainer), cancelOperator: OPERATOR },
        config
      );
      expect(cancelOperatorOf(config, policy)).toBe(OPERATOR);
    }
  );

  it.each([
    ["jira", JIRA_CONFIG, JIRA_MAINTAINER, "Jira"],
    ["linear", LINEAR_CONFIG, LINEAR_MAINTAINER, "Linear"],
  ] as const)(
    "refuses every %s cancel without a cancelOperator, naming the key",
    (_tracker, config, maintainer, vendor) => {
      const policy = validatePolicy(policyFor(maintainer), config);
      let failure = "";
      try {
        cancelOperatorOf(config, policy);
      } catch (error) {
        failure = publicFailure(error);
      }
      expect(failure).toContain("npmUpdater.cancelOperator is not set");
      expect(failure).toContain(`${vendor}-tracked npm update`);
      expect(failure).toContain("write or admin");
    }
  );

  it("refuses a cancelOperator that is not a GitHub login, or on a GitHub host", () => {
    expect(() =>
      validatePolicy(
        { ...policyFor(JIRA_MAINTAINER), cancelOperator: "557058:not-a-login" },
        JIRA_CONFIG
      )
    ).toThrow(/must be a GitHub login/);
    expect(() =>
      validatePolicy(
        { ...policyFor("octocat"), cancelOperator: OPERATOR },
        {
          tracker: "github",
          github: { org: "acme", repo: "widgets" },
          deploy: { branches: { production: "main" } },
        }
      )
    ).toThrow(/applies only to Jira and Linear/);
  });

  it("signs the cancelOperator, not the tracker maintainer, into the cancellation record", async () => {
    const config = {
      ...LINEAR_CONFIG,
      automationProvenance: await automation(),
      npmUpdater: { ...policyFor(LINEAR_MAINTAINER), cancelOperator: OPERATOR },
    };
    await withPrivateRoot(async (root, env) => {
      const host = await committedHost(root, env, LINEAR_MAINTAINER);
      const proposal = { ...host.proposal };
      const origin = {
        allocation: {
          workItem: "ENG-1",
          claimCommentId: "0f3c2a1b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
          claimSha256: "c".repeat(64),
          draft: { body: "draft" },
        },
        proposal: { key: "a".repeat(64), parent: "1".repeat(40) },
        checkpoint: { digest: "b".repeat(64), payload: {} },
      };
      const record = cancellationRecord(
        origin,
        proposal,
        config,
        { runId: "9", runAttempt: "1" },
        "77"
      );
      expect(record.maintainer).toBe(OPERATOR);
      expect(record.workItem).toBe("ENG-1");
    });
  });
});

/**
 * Allocate one work item against a fresh fake and return its adapter.
 * @param kind - Which tracker.
 * @returns The fake and its adapter.
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
    const api = { ...codeHost(host.parent), tracker };
    await allocateLeaf({ api, config, ...host });
    return { fake, tracker, api, config, host };
  });
}

describe("closing a superseded or cancelled Jira/Linear work item", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(REGISTRY_METADATA)
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("moves a Jira ticket to Won't Do and proves the automation made the move", async () => {
    const { tracker } = await allocated("jira");
    await tracker.cancel(1);
    const issue = await tracker.issue(1);
    expect(issue.state).toBe("closed");
    expect(issue.state_reason).toBe("not_planned");
    await expect(tracker.assertCancelled(1)).resolves.toBeUndefined();
  });

  it("moves a Linear issue to the team's canceled state and proves the automation made the move", async () => {
    const { tracker } = await allocated("linear");
    await tracker.cancel(1);
    const issue = await tracker.issue(1);
    expect(issue.state).toBe("closed");
    expect(issue.state_reason).toBe("not_planned");
    await expect(tracker.assertCancelled(1)).resolves.toBeUndefined();
  });

  it("refuses a Jira cancellation made by a person", async () => {
    const { fake, tracker } = await allocated("jira");
    (fake as ReturnType<typeof fakeJira>).move(1, "Won't Do", JIRA_MAINTAINER);
    expect((await tracker.issue(1)).state_reason).toBe("not_planned");
    expect(await failureOf(tracker.assertCancelled(1))).toContain(
      `PROJ-1 ${FOREIGN}`
    );
  });

  it("refuses a Linear cancellation made by a person", async () => {
    const { fake, tracker } = await allocated("linear");
    (fake as ReturnType<typeof fakeLinear>).move(
      1,
      "state-canceled",
      LINEAR_MAINTAINER
    );
    expect(await failureOf(tracker.assertCancelled(1))).toContain(
      `ENG-1 ${FOREIGN}`
    );
  });

  it("does not read a Done ticket as a cancellation", async () => {
    const { fake, tracker } = await allocated("jira");
    (fake as ReturnType<typeof fakeJira>).move(1, "Done", JIRA_MAINTAINER);
    expect((await tracker.issue(1)).state_reason).toBe("completed");
  });

  it("enters supersession for a closed earlier Linear item instead of refusing it as unsupported", async () => {
    const { tracker, api, config, host } = await allocated("linear");
    await tracker.cancel(1);
    const failure = await failureOf(
      discoverPrior(api, host.proposal, { cwd: host.cwd, config })
    );
    expect(failure).toBeDefined();
    // It reaches the supersession chain, which requires a signed cancellation record.
    await expect(
      discoverPrior(api, host.proposal, { cwd: host.cwd, config })
    ).rejects.toThrow(/closed leaf lacks authenticated cancellation/);
    expect(failure).not.toContain("CodySwannGT/lisa#4873");
    expect(failure).not.toContain("not supported");
  });
});

describe("a Jira/Linear recovery subject on the gate's GitHub catalogue", () => {
  it("reads the recovery run, branch and PRs but no GitHub issue or assignee", () => {
    const endpoints = createGhRequests({
      phase: "hook-read",
      repository: "acme/widgets",
      tracker: "acme/widgets",
      issue: "1",
      workItem: "ENG-1",
      branch: `lisa/npm-${"a".repeat(64)}`,
      parent: "b".repeat(40),
      origin: { runId: "91", runAttempt: "1" },
      claim: "0f3c2a1b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
      recovery: {
        runId: "92",
        runAttempt: "1",
        branch: `lisa/npm-${"a".repeat(64)}`,
      },
      maintainer: LINEAR_MAINTAINER,
      pr: null,
      proofs: [],
    }).records.map(record => record.args.join(" "));
    const text = endpoints.join("\n");
    expect(text).toContain("actions/runs/92/attempts/1");
    expect(text).toContain("git/matching-refs/heads/lisa/npm-");
    expect(text).not.toMatch(/issues|assignees/);
  });
});

describe("the shared closure and publish-authority guards (#4873 review)", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(REGISTRY_METADATA)
    );
  });
  afterEach(() => vi.restoreAllMocks());

  const REASON = "cancellation closure readback differs";

  it("accepts a Jira closure only when the automation account made it", async () => {
    const { fake, tracker, api } = await allocated("jira");
    await tracker.cancel(1);
    await expect(
      assertManagedClosure(api, await tracker.issue(1), REASON)
    ).resolves.toBeUndefined();
    (fake as ReturnType<typeof fakeJira>).move(1, "Won't Do", JIRA_MAINTAINER);
    expect(
      await failureOf(assertManagedClosure(api, await tracker.issue(1), REASON))
    ).toContain(`PROJ-1 ${FOREIGN}`);
  });

  it("keeps GitHub's own closed_by check exactly", async () => {
    const api = { policy: { claimActorId: "99" } };
    const closed = {
      number: 4,
      state: "closed",
      state_reason: "not_planned",
      closed_by: { id: 99, type: "Bot" },
    };
    await expect(
      assertManagedClosure(api, closed, REASON)
    ).resolves.toBeUndefined();
    await expect(
      assertManagedClosure(
        api,
        { ...closed, closed_by: { id: 7, type: "User" } },
        REASON
      )
    ).rejects.toThrow(REASON);
  });

  it("refuses publication when the Linear claim was written by a person", async () => {
    const { fake, tracker, api, host } = await allocated("linear");
    const issue = await tracker.issue(1);
    const forged = (fake as ReturnType<typeof fakeLinear>).comment(
      1,
      "[lisa-tracker-claim] forged",
      LINEAR_MAINTAINER
    );
    const descriptor = {
      workItem: "ENG-1",
      claimCommentId: forged.id,
      claimSha256: "0".repeat(64),
    };
    expect(
      await failureOf(
        trackerPublishAuthority(api, descriptor, host.policy, issue)
      )
    ).toContain("was not made by the npm updater's automation account");
    expect(
      await trackerPublishAuthority(
        { policy: {} },
        descriptor,
        host.policy,
        issue
      )
    ).toBeUndefined();
  });
});

describe("where a cancelled item is moved", () => {
  it("reads jira.workflow.canceled and linear.workflow.canceled, with their defaults", () => {
    expect(canceledName(JIRA_CONFIG)).toBe("Won't Do");
    expect(
      canceledName({
        ...JIRA_CONFIG,
        jira: { ...JIRA_CONFIG.jira, workflow: { canceled: " Cancelled " } },
      })
    ).toBe("Cancelled");
    expect(canceledName(LINEAR_CONFIG)).toBeNull();
    expect(
      canceledName({
        ...LINEAR_CONFIG,
        linear: { ...LINEAR_CONFIG.linear, workflow: { canceled: "Dropped" } },
      })
    ).toBe("Dropped");
  });
});
