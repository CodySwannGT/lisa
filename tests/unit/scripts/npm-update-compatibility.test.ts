/** Reaching compatibility controls use synthetic provider authority; only the Husky installer executes natively. */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as contract from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import * as authorization from "../../../all/copy-overwrite/scripts/lib/npm-update-authorization.mjs";
import * as publication from "../../../all/copy-overwrite/scripts/lib/npm-update-publication.mjs";
import * as gate from "../../../all/copy-overwrite/scripts/lib/npm-update-gate.mjs";
import * as transport from "../../../all/copy-overwrite/scripts/lib/npm-update-gate-hooks.mjs";
import * as native from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import {
  publishProposal,
  publishDestination,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-publish.mjs";

const REPOSITORY = "acme/widgets";
const CWD = "/unit/checkout";
const PARENT = "b".repeat(40);
const COMMIT = "c".repeat(40);
const KEY = "a".repeat(64);
const WORK_ITEM = `${REPOSITORY}#42`;
const DENIED = new Error("native transport refused: HTTP 403");
const proposal = {
  repository: REPOSITORY,
  parent: PARENT,
  key: KEY,
  bindingKey: KEY,
  hashes: {},
  updates: [],
};
const allocation = {
  workItem: WORK_ITEM,
  claimCommentId: "7",
  draft: { title: "Update dependency", body: "Dependency update" },
};
const descriptor = {
  version: 1,
  parent: PARENT,
  proposalKey: KEY,
  files: {},
  updates: [],
  workItem: WORK_ITEM,
  claimCommentId: "7",
  tree: "d".repeat(40),
  author: "fixture 1 +0000",
  committer: "fixture 1 +0000",
  messageSha256: KEY,
  policySha256: KEY,
  queue: REPOSITORY,
  claimSha256: KEY,
  runId: "1",
  runAttempt: "1",
};
const snapshot = {
  branch: `lisa/npm-${KEY}`,
  expectedBranchHead: COMMIT,
  prNumber: 12,
  expectedPrHead: COMMIT,
};
const pr = {
  number: 12,
  html_url: `https://github.com/${REPOSITORY}/pull/12`,
  base: { sha: PARENT },
  user: { type: "Bot", login: "github-actions[bot]" },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** These unit seams replace authority proof, not the publisher's equality/readback or native refusal decisions. */
function publisherAuthority() {
  vi.spyOn(contract, "validateProposal").mockImplementation(value => value);
  vi.spyOn(contract, "validateRawCommit").mockImplementation(() => ({
    sha: COMMIT,
    message: "unit message",
    author: {
      name: "Fixture",
      email: "fixture@example.invalid",
      date: "1970-01-01T00:00:01.000Z",
    },
    committer: {
      name: "Fixture",
      email: "fixture@example.invalid",
      date: "1970-01-01T00:00:01.000Z",
    },
  }));
  vi.spyOn(authorization, "authorizeAllocation").mockResolvedValue({});
  vi.spyOn(authorization, "destinationSnapshot").mockResolvedValue(snapshot);
  vi.spyOn(publication, "publicationProof").mockImplementation(() => undefined);
  vi.spyOn(transport, "assertGateTransport").mockImplementation(
    () => undefined
  );
  vi.spyOn(gate, "descriptorFor").mockResolvedValue({
    descriptor,
    message: "unit message",
    epoch: 1,
  });
  vi.spyOn(native, "runProcess").mockResolvedValue({
    stdout: Buffer.from(`${COMMIT}\n`),
    code: 0,
    stderr: Buffer.alloc(0),
  });
}

describe("default-token publication compatibility", () => {
  it("reaches exact object publication and both canonical backlinks without an administration-only read", async () => {
    publisherAuthority();
    const api = {
      request: vi.fn(async (endpoint: string) => {
        if (endpoint.endsWith("/actions/permissions/workflow")) throw DENIED;
        expect(endpoint).toBe(`repos/${REPOSITORY}/pulls/12`);
        return pr;
      }),
      gitCommit: vi.fn(async () => undefined),
      workItem: vi.fn(async () => undefined),
    };
    const result = await publishProposal({
      api,
      proposal,
      allocation,
      descriptor,
      policy: { repository: REPOSITORY },
      config: { automationProvenance: {} },
      proof: {},
      raw: Buffer.from("unit raw object"),
      cwd: CWD,
      receipt: {
        commit: COMMIT,
        tree: descriptor.tree,
        parent: PARENT,
        proposalKey: KEY,
        commitExit: 0,
        pushExit: 0,
        remote: `https://github.com/${REPOSITORY}.git`,
        refs: "exact-stream",
        destination: { refs: "exact-stream" },
        range: [COMMIT],
      },
    });
    expect(result.status).toBe("published-awaiting-review");
    expect(api.gitCommit).toHaveBeenCalledOnce();
    expect(api.workItem).toHaveBeenNthCalledWith(
      1,
      CWD,
      ["backlink", "--ref", WORK_ITEM, "--pr-url", pr.html_url],
      expect.objectContaining({
        proposal,
        allocation,
        commit: expect.objectContaining({ sha: COMMIT }),
        pr,
      })
    );
    expect(api.workItem).toHaveBeenNthCalledWith(
      2,
      CWD,
      [
        "validate-pr",
        "--base",
        PARENT,
        "--head",
        COMMIT,
        "--pr-number",
        "12",
        "--repo",
        REPOSITORY,
        "--pr-url",
        pr.html_url,
      ],
      expect.objectContaining({ proposal, allocation, pr })
    );
    expect(api.request).toHaveBeenCalledExactlyOnceWith(
      `repos/${REPOSITORY}/pulls/12`
    );
  });
  it("preserves an actual denied PR-create transport result and never runs a backlink", async () => {
    vi.spyOn(authorization, "destinationSnapshot").mockResolvedValue({
      ...snapshot,
      prNumber: null,
      expectedPrHead: null,
    });
    const api = {
      request: vi.fn(async () => {
        throw DENIED;
      }),
      workItem: vi.fn(),
    };
    await expect(
      publishDestination({
        api,
        proposal,
        allocation,
        commit: { sha: COMMIT },
        authorize: async () => undefined,
        cwd: CWD,
        controller: {},
      })
    ).rejects.toBe(DENIED);
    expect(api.request).toHaveBeenCalledExactlyOnceWith(
      `repos/${REPOSITORY}/pulls`,
      "POST",
      {
        title: allocation.draft.title,
        head: snapshot.branch,
        base: "main",
        body: publication.publicationBody(allocation),
      }
    );
    expect(api.workItem).not.toHaveBeenCalled();
  });
});
