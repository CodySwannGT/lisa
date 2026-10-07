/** Synthetic lifecycle controls do not establish real provider or signing authority. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  prepareCancellation,
  finalizeCancellation,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-cancellation.mjs";
import { canonicalJson } from "../../../all/copy-overwrite/scripts/lisa-automation-provenance.mjs";
import { sha256 } from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";
import {
  decodeCheckpoint,
  checkpointComments,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-checkpoint.mjs";

const controlled = vi.hoisted(() => ({
  origin: vi.fn(),
  recorded: vi.fn(),
  discover: vi.fn(),
  absent: vi.fn(),
  verify: vi.fn(),
  historical: vi.fn(),
  config: vi.fn(),
  proposal: vi.fn(),
}));
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/npm-update-cancel-origin.mjs",
  async importOriginal => ({
    ...(await importOriginal<object>()),
    authenticateStaleOrigin: controlled.origin,
    committedCancellationConfig: controlled.config,
  })
);
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/npm-update-supersession.mjs",
  () => ({
    recordedCancellation: controlled.recorded,
    cancellationDestinationAbsent: controlled.absent,
  })
);
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/npm-update-allocate.mjs",
  () => ({ discoverPrior: controlled.discover })
);
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/npm-update-cancellation-proof.mjs",
  async importOriginal => ({
    ...(await importOriginal<object>()),
    verifyCancellationAttestation: controlled.verify,
    verifyRecordedCancellation: controlled.historical,
  })
);
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs",
  async importOriginal => ({
    ...(await importOriginal<object>()),
    validateProposal: controlled.proposal,
  })
);
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/npm-update-hosted-gate.mjs",
  () => ({ assertHostedGate: vi.fn() })
);

const hash = (digit: string, length = 64) => digit.repeat(length);
const authority = {
  repository: "acme/widgets",
  repositoryId: "12",
  ownerId: "34",
  claimActorId: "99",
  callerWorkflow: "acme/widgets/.github/workflows/npm.yml",
  signerWorkflow: "CodySwannGT/lisa/.github/workflows/npm-updater.yml",
  signerDigest: hash("a", 40),
  allowedTriggers: ["workflow_dispatch"],
};
const policy = { maintainer: "maintainer" };
const config = { npmUpdater: policy, automationProvenance: authority };
const proposal = {
  repository: authority.repository,
  parent: hash("2", 40),
  key: hash("b"),
  selectionKey: hash("c"),
  hashes: { "package.json": hash("a"), "package-lock.json": hash("b") },
  policySha256: hash("e"),
};
const request = { number: 42, proposalKey: hash("d"), parent: proposal.parent };
const origin = {
  proposal: { ...proposal, key: request.proposalKey, parent: hash("1", 40) },
  allocation: {
    workItem: "acme/widgets#42",
    claimCommentId: "77",
    claimSha256: hash("a"),
    draft: { body: "immutable old body" },
  },
  checkpoint: { digest: hash("e"), payload: { original: "preserved" } },
};
const original = {
  number: 42,
  state: "open",
  body: origin.allocation.draft.body,
  title: "unchanged",
  comments: [],
};
const cancellationBundleName = "cancellation-bundle.json";
const cancellationSubjectName = "cancellation.json";
const run = {
  id: 700,
  run_attempt: 1,
  path: ".github/workflows/npm.yml",
  event: "workflow_dispatch",
  status: "in_progress",
  run_started_at: new Date(Date.now() - 30_000).toISOString(),
  updated_at: new Date().toISOString(),
  head_sha: proposal.parent,
  head_branch: "main",
  head_repository: { id: 12 },
  triggering_actor: { id: 56, login: policy.maintainer, type: "User" },
  referenced_workflows: [
    { path: authority.signerWorkflow, sha: authority.signerDigest },
  ],
};
const permission = { permission: "write", user: run.triggering_actor };
let directory: string;
let issue: Record<string, unknown>;
let writes: {
  endpoint: string;
  method: string;
  body: Record<string, unknown>;
}[];

/** This in-memory provider deliberately records every mutation before returning its synthetic state. */
function provider() {
  return {
    policy: authority,
    main: vi.fn(async () => undefined),
    maybe: vi.fn(async () => null),
    issue: vi.fn(async () => structuredClone(issue)),
    list: vi.fn(async (endpoint: string) =>
      endpoint.includes("/pulls?") ? [] : structuredClone(issue.comments)
    ),
    request: vi.fn(
      async (
        endpoint: string,
        method = "GET",
        body?: Record<string, unknown>
      ) => {
        if (method === "GET") {
          if (endpoint.includes("/issues/comments/"))
            return (issue.comments as { id: number }[]).find(comment =>
              endpoint.endsWith(`/${comment.id}`)
            );
          return endpoint.includes("/collaborators/") ? permission : run;
        }
        writes.push({ endpoint, method, body: body! });
        if (endpoint.endsWith("/comments")) {
          const created = {
            id: 100 + writes.length,
            body: body!.body,
            issue_url: "https://api.github.com/repos/acme/widgets/issues/42",
          };
          (issue.comments as object[]).push(created);
          return created;
        } else {
          issue = { ...issue, ...body, closed_by: { id: 99, type: "Bot" } };
        }
        return structuredClone(issue);
      }
    ),
  };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "lisa-cancellation-unit-"));
  issue = structuredClone(original);
  writes = [];
  vi.stubEnv("GITHUB_RUN_ID", "700");
  vi.stubEnv("GITHUB_RUN_ATTEMPT", "1");
  const event = join(directory, "event.json");
  writeFileSync(
    event,
    JSON.stringify({
      ref: "main",
      repository: {
        full_name: authority.repository,
        id: 12,
        owner: { id: 34 },
      },
      sender: run.triggering_actor,
      inputs: {
        cancel_issue: "42",
        cancel_proposal_key: request.proposalKey,
        cancel_expected_main: request.parent,
      },
    }),
    { mode: 0o600 }
  );
  vi.stubEnv("GITHUB_EVENT_PATH", event);
  controlled.origin.mockResolvedValue(origin);
  controlled.recorded.mockResolvedValue(undefined);
  controlled.discover.mockResolvedValue({
    status: "stale-outstanding",
    issue: original,
  });
  controlled.absent.mockResolvedValue(undefined);
  controlled.verify.mockReturnValue({});
  controlled.historical.mockReturnValue({});
  controlled.config.mockResolvedValue(config);
  controlled.proposal.mockImplementation(value => value);
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("manual cancellation lifecycle", () => {
  it("prepares only a distinct signed subject without changing the original provider record", async () => {
    const api = provider();
    await prepareCancellation({
      api,
      cwd: directory,
      output: directory,
      proposal,
      config,
      request,
    });
    const record = JSON.parse(
      readFileSync(join(directory, cancellationSubjectName), "utf8")
    );
    expect(record.oldProposalKey).toBe(request.proposalKey);
    expect(record.operatorId).toBe("56");
    expect(record.originCheckpointSha256).toBe(
      sha256(canonicalJson(origin.checkpoint.payload))
    );
    expect(issue).toEqual(original);
    expect(writes).toEqual([]);
  });

  it.each(["hold", "destination", "main", "ambiguous"])(
    "refuses %s before any lifecycle write",
    async fault => {
      const api = provider();
      if (fault === "hold")
        controlled.origin.mockRejectedValueOnce(Error("hold"));
      if (fault === "destination")
        controlled.absent.mockRejectedValueOnce(Error("destination"));
      if (fault === "main") api.main.mockRejectedValueOnce(Error("main"));
      if (fault === "ambiguous")
        controlled.discover.mockRejectedValueOnce(Error("ambiguous"));
      await expect(
        prepareCancellation({
          api,
          cwd: directory,
          output: directory,
          proposal,
          config,
          request,
        })
      ).rejects.toThrow();
      expect(writes).toEqual([]);
    }
  );

  it("persists the authenticated cancellation then closes only not_planned, preserving all original bytes", async () => {
    const api = provider();
    await prepareCancellation({
      api,
      cwd: directory,
      output: directory,
      proposal,
      config,
      request,
    });
    writeFileSync(join(directory, cancellationBundleName), "{}", {
      mode: 0o600,
    });
    await finalizeCancellation({
      api,
      cwd: directory,
      output: directory,
      proposal,
      config,
      request,
    });
    expect(writes.at(-1)?.body).toEqual({
      state: "closed",
      state_reason: "not_planned",
    });
    expect(
      writes.slice(0, -1).every(write => write.endpoint.endsWith("/comments"))
    ).toBe(true);
    expect(issue.body).toBe(original.body);
    expect(issue.title).toBe(original.title);
    expect(controlled.verify).toHaveBeenCalled();
  });

  it("a fresh authority failure still prevents every mutation", async () => {
    const api = provider();
    await prepareCancellation({
      api,
      cwd: directory,
      output: directory,
      proposal,
      config,
      request,
    });
    writeFileSync(join(directory, cancellationBundleName), "{}", {
      mode: 0o600,
    });
    controlled.verify.mockImplementationOnce(() => {
      throw Error("signature");
    });
    await expect(
      finalizeCancellation({
        api,
        cwd: directory,
        output: directory,
        proposal,
        config,
        request,
      })
    ).rejects.toThrow();
    expect(writes).toEqual([]);
  });

  it("changed main immediately before closure preserves the open leaf and durable evidence", async () => {
    const api = provider();
    await prepareCancellation({
      api,
      cwd: directory,
      output: directory,
      proposal,
      config,
      request,
    });
    writeFileSync(join(directory, cancellationBundleName), "{}", {
      mode: 0o600,
    });
    controlled.origin.mockImplementation(async () => {
      if (writes.some(write => String(write.body.body).includes(" complete\n")))
        throw Error("main changed");
      return origin;
    });
    await expect(
      finalizeCancellation({
        api,
        cwd: directory,
        output: directory,
        proposal,
        config,
        request,
      })
    ).rejects.toThrow();
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every(write => write.method === "POST")).toBe(true);
    expect(issue.state).toBe("open");
  });

  it("resumes a completed authenticated record after interruption, then remains idempotent", async () => {
    const api = provider();
    const context = {
      api,
      cwd: directory,
      output: directory,
      proposal,
      config,
      request,
    };
    await prepareCancellation(context);
    writeFileSync(join(directory, cancellationBundleName), "{}", {
      mode: 0o600,
    });
    controlled.origin.mockImplementation(async () => {
      if (writes.some(write => String(write.body.body).includes(" complete\n")))
        throw Error("interrupted before close");
      return origin;
    });
    await expect(finalizeCancellation(context)).rejects.toThrow();
    const record = JSON.parse(
      readFileSync(join(directory, cancellationSubjectName), "utf8")
    );
    const digest = sha256(`${canonicalJson(record)}\n`);
    const payload = decodeCheckpoint(issue.comments, digest);
    expect(issue.state).toBe("open");
    controlled.origin.mockResolvedValue(origin);
    // The independently verified historical-record seam supplies already authenticated bytes.
    controlled.recorded.mockResolvedValue({ digest, payload });
    const next = join(directory, "resumed");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(next, { mode: 0o700 });
    const resumed = { ...context, output: next };
    expect(await prepareCancellation(resumed)).toEqual({ mode: "recorded" });
    const before = writes.length;
    const commentCount = (issue.comments as object[]).length;
    await finalizeCancellation(resumed);
    expect(writes.slice(before)).toEqual([
      {
        endpoint: "repos/acme/widgets/issues/42",
        method: "PATCH",
        body: { state: "closed", state_reason: "not_planned" },
      },
    ]);
    await finalizeCancellation(resumed);
    expect(writes.length).toBe(before + 1);
    expect(issue.comments).toHaveLength(commentCount);
    expect(issue.body).toBe(original.body);
  });

  it("rejects forwarded intent that differs from the native event before any write", async () => {
    const api = provider();
    await expect(
      prepareCancellation({
        api,
        cwd: directory,
        output: directory,
        proposal,
        config,
        request: { ...request, number: 43 },
      })
    ).rejects.toThrow(/dispatch intent/);
    expect(writes).toEqual([]);
  });

  it.each(["genuine", "foreign", "edited", "copied"])(
    "verifies recorded cancellation's actual %s checkpoint transport before granting closure authority",
    async fault => {
      const api = provider();
      const context = {
        api,
        cwd: directory,
        output: directory,
        proposal,
        config,
        request,
      };
      await prepareCancellation(context);
      const record = JSON.parse(
        readFileSync(join(directory, cancellationSubjectName), "utf8")
      );
      const digest = sha256(`${canonicalJson(record)}\n`);
      const payload = {
        version: 1,
        proposal,
        allocation: origin.allocation,
        preview: { cancellation: record },
        bundle: "{}",
      };
      const comments = checkpointComments(payload, digest).map(
        (body: string, index: number) => ({
          id: 200 + index,
          body,
          user: { type: "Bot", id: 99 },
          created_at: run.updated_at,
          updated_at: run.updated_at,
        })
      );
      const first = comments[0]!;
      if (fault === "foreign") first.user = { type: "User", id: 56 };
      if (fault === "edited")
        first.updated_at = new Date(
          Date.parse(run.updated_at) + 1000
        ).toISOString();
      if (fault === "copied")
        first.created_at = first.updated_at = new Date(
          Date.parse(run.updated_at) + 120_000
        ).toISOString();
      issue.comments = comments;
      // Only native transport is under test; origin/proposal/signature fixtures are deliberately synthetic.
      const actual = await vi.importActual<{
        recordedCancellation: (context: object) => Promise<unknown>;
      }>("../../../all/copy-overwrite/scripts/lib/npm-update-supersession.mjs");
      const result = actual.recordedCancellation({
        api,
        cwd: directory,
        issue,
        proposal,
        config,
        origin,
      });
      if (fault === "genuine")
        expect(await result).toHaveProperty("digest", digest);
      else
        await expect(result).rejects.toThrow(
          /checkpoint.*(edited|copied|foreign)/
        );
      expect(writes).toEqual([]);
    }
  );
});
