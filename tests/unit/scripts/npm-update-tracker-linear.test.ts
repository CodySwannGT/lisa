/**
 * AC2 and AC5 of CodySwannGT/lisa#4859 against a mocked Linear GraphQL
 * endpoint: allocation creates exactly one build-ready issue and a re-run
 * creates none; the claim and the checkpoint are managed comments on that
 * issue and are read back to resume. A signed origin then reaches the plain
 * refusal for the not-yet-supported recovery (CodySwannGT/lisa#4873).
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allocateLeaf } from "../../../all/copy-overwrite/scripts/lib/npm-update-allocate.mjs";
import { prepareAuthorization } from "../../../all/copy-overwrite/scripts/lib/npm-update-authorization.mjs";
import {
  locateCheckpoint,
  persistCheckpoint,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-recovery.mjs";
import { createTracker } from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker.mjs";
import { CLAIM } from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import { publicFailure } from "../../../all/copy-overwrite/scripts/lib/npm-update-invariants.mjs";
import { withPrivateRoot } from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import { sha256 } from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";
import { fakeLinear } from "../../support/npm-update-linear-fake.js";
import {
  LINEAR_CONFIG,
  LINEAR_MAINTAINER,
  REGISTRY_METADATA,
  codeHost,
  committedHost,
  automation,
} from "../../support/npm-update-tracker-host.js";

const CONFIG = { ...LINEAR_CONFIG, automationProvenance: await automation() };
const FENCE = "````lisa\n";
const FOLLOWUP = /That support is tracked in CodySwannGT\/lisa#4873/;

/** A Linear-tracked allocation run over a committed host and the mocked team. */
async function linearRun(root: string, env: NodeJS.ProcessEnv) {
  const host = await committedHost(root, env, LINEAR_MAINTAINER);
  const linear = fakeLinear({ members: [LINEAR_MAINTAINER] });
  const api = {
    ...codeHost(host.parent),
    tracker: createTracker(
      CONFIG,
      { LINEAR_API_KEY: "lin_api_fixture" },
      linear.transport
    )!,
  };
  const allocate = () =>
    allocateLeaf({
      api,
      proposal: host.proposal,
      policy: host.policy,
      config: CONFIG,
      cwd: host.cwd,
    });
  return { ...host, linear, api, allocate };
}

describe("Linear allocation", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(REGISTRY_METADATA)
    );
    vi.stubEnv("GITHUB_RUN_ID", "700");
    vi.stubEnv("GITHUB_RUN_ATTEMPT", "1");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("creates exactly one build-ready issue in the configured team and none on re-run", async () => {
    await withPrivateRoot(async (root, env) => {
      const run = await linearRun(root, env);
      const first = await run.allocate();
      expect(run.linear.creates()).toBe(1);
      const create = run.linear.log.find(
        entry => entry.operation === "LisaNpmIssueCreate"
      )!;
      expect(create.variables).toMatchObject({
        input: {
          teamId: "team-1",
          stateId: "state-ready",
          priority: 3,
          assigneeId: LINEAR_MAINTAINER,
        },
      });
      expect(first.workItem).toBe("ENG-1");
      expect(first.number).toBe(1);
      const issue = run.linear.issues[0]!;
      expect(issue.description.startsWith(FENCE)).toBe(true);
      expect(issue.description.slice(FENCE.length, -5)).toBe(first.draft.body);
      expect(issue.stateId).toBe("state-progress");
      const claims = issue.comments.filter(
        comment => comment.body === `${FENCE}${CLAIM}\n\`\`\`\``
      );
      expect(claims).toHaveLength(1);
      expect(first.claimCommentId).toBe(claims[0]!.id);
      expect(first.claimSha256).toBe(sha256(CLAIM));

      const writes = run.linear.log.length;
      const second = await run.allocate();
      expect(run.linear.creates()).toBe(1);
      expect(second.workItem).toBe("ENG-1");
      expect(second.claimCommentId).toBe(first.claimCommentId);
      expect(issue.comments).toHaveLength(2);
      const mutations = run.linear.log
        .slice(writes)
        .filter(entry => /Create|Update/.test(entry.operation));
      expect(mutations).toEqual([]);
    });
  });

  it("writes the claim and checkpoint as managed comments and resumes from them", async () => {
    await withPrivateRoot(async (root, env) => {
      const run = await linearRun(root, env);
      const allocation = await run.allocate();
      const output = join(root, "allocate");
      mkdirSync(output, { mode: 0o700 });
      const prepared = await prepareAuthorization({
        api: run.api,
        cwd: run.cwd,
        output,
        proposal: run.proposal,
        allocation,
        policy: run.policy,
        config: CONFIG,
      });
      expect(prepared.mode).toBe("origin");
      const descriptor = JSON.parse(
        readFileSync(join(output, "descriptor.json"), "utf8")
      );
      expect(descriptor.workItem).toBe("ENG-1");
      expect(descriptor.claimCommentId).toBe(allocation.claimCommentId);
      const preview = JSON.parse(
        readFileSync(join(output, "preview.json"), "utf8")
      );
      expect(preview.message).toContain("\nWork-Item: ENG-1\n");

      const tracker = run.api.tracker;
      const comments = (await tracker.issue(1)).comments;
      const unsigned = locateCheckpoint(comments, run.proposal, run.policy);
      expect(unsigned).toMatchObject({ signed: false, complete: true });
      expect(
        run.linear.issues[0]!.comments.every(comment =>
          comment.body.startsWith(FENCE)
        )
      ).toBe(true);

      const resumed = await run.allocate();
      expect(run.linear.creates()).toBe(1);
      expect(resumed.claimCommentId).toBe(allocation.claimCommentId);

      const digest = sha256("signed origin descriptor bytes");
      const payload = {
        version: 1,
        proposal: run.proposal,
        allocation: prepared.allocation,
        preview,
        bundle: "{}",
      };
      await persistCheckpoint(run.api, 1, payload, digest, async () => {});
      const located = locateCheckpoint(
        (await tracker.issue(1)).comments,
        run.proposal,
        run.policy
      );
      expect(located).toMatchObject({ signed: true, complete: true, digest });
      expect(located!.payload.allocation).toEqual(prepared.allocation);

      const restored = await run.allocate();
      expect(run.linear.creates()).toBe(1);
      const retry = join(root, "retry");
      mkdirSync(retry, { mode: 0o700 });
      const refusal = await prepareAuthorization({
        api: run.api,
        cwd: run.cwd,
        output: retry,
        proposal: run.proposal,
        allocation: restored,
        policy: run.policy,
        config: CONFIG,
      }).then(
        () => undefined,
        (error: unknown) => error
      );
      expect(publicFailure(refusal)).toMatch(FOLLOWUP);
    });
  });

  it("proves the claim against the issue, the API-key viewer and the claim bytes", async () => {
    await withPrivateRoot(async (root, env) => {
      const run = await linearRun(root, env);
      const allocation = await run.allocate();
      const descriptor = {
        workItem: "ENG-1",
        claimCommentId: allocation.claimCommentId,
        claimSha256: allocation.claimSha256,
      };
      const tracker = run.api.tracker;
      await expect(tracker.proveClaim(descriptor)).resolves.toBeUndefined();
      await expect(
        tracker.proveClaim({ ...descriptor, workItem: "ENG-2" })
      ).rejects.toThrow(/claim/);
      await expect(
        tracker.proveClaim({ ...descriptor, claimSha256: sha256("other") })
      ).rejects.toThrow(/claim/);
    });
  });

  it("refuses an unassignable maintainer before creating anything", async () => {
    await withPrivateRoot(async (root, env) => {
      const host = await committedHost(root, env, LINEAR_MAINTAINER);
      const linear = fakeLinear({ members: [] });
      const api = {
        ...codeHost(host.parent),
        tracker: createTracker(
          CONFIG,
          { LINEAR_API_KEY: "lin_api_fixture" },
          linear.transport
        ),
      };
      await expect(
        allocateLeaf({
          api,
          proposal: host.proposal,
          policy: host.policy,
          config: CONFIG,
          cwd: host.cwd,
        })
      ).rejects.toThrow(/assignable/);
      expect(linear.creates()).toBe(0);
    });
  });
});
