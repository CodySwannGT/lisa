/**
 * CodySwannGT/lisa#4859: at the checkpoint phase a Jira- or Linear-tracked
 * host proves the live GitHub run with `verifyCurrentRun` and the claim with
 * its own tracker adapter. The run half keeps every repository and run check
 * of the GitHub path and never reads a GitHub issue comment.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyCurrentRun } from "../../../all/copy-overwrite/scripts/lib/github-attestation-provider.mjs";
import { withPrivateRoot } from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import { sha256 } from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";

const REPOSITORY = "acme/widgets";
const TRANSPORT = "synthetic provider transport";

/**
 * Synthetic gh replies keyed by endpoint; they are transport fixtures, not provider proof.
 * @param replies - Reply bodies by endpoint.
 * @param reads - Every endpoint requested, in order.
 * @returns A bounded-spawn-shaped executor.
 */
function executor(replies: Map<string, object>, reads: string[]) {
  return (_command: string, args: readonly string[] = []) => {
    const endpoint = args.at(-1)!;
    const stdout = JSON.stringify(replies.get(endpoint));
    reads.push(endpoint);
    return {
      pid: 0,
      status: 0,
      signal: null,
      stdout,
      stderr: "",
      output: [null, stdout, ""] as [null, string, string],
    };
  };
}

describe("checkpoint run proof for Jira and Linear hosts", () => {
  it("proves repository, main and the in-progress run without reading a claim comment", async () => {
    await withPrivateRoot(async root => {
      const executable = join(root, "synthetic-provider");
      writeFileSync(executable, TRANSPORT, { mode: 0o700 });
      const parent = "1".repeat(40);
      const policy = {
        repository: REPOSITORY,
        repositoryId: "12",
        ownerId: "34",
        claimActorId: "99",
        allowedTriggers: ["workflow_dispatch"],
        signerWorkflow: "acme/automation/.github/workflows/npm-updater.yml",
        signerDigest: parent,
        ghExecutable: executable,
        ghSha256: sha256(TRANSPORT),
      };
      const descriptor = {
        parent,
        queue: REPOSITORY,
        workItem: "ENG-1",
        runId: "700",
        runAttempt: "1",
        claimCommentId: "comment-2-1",
        claimSha256: sha256("claim"),
      };
      const run = {
        id: 700,
        run_attempt: 1,
        head_sha: parent,
        head_branch: "main",
        status: "in_progress",
        head_repository: { id: 12 },
        event: "workflow_dispatch",
        referenced_workflows: [{ path: policy.signerWorkflow, sha: parent }],
      };
      const replies = new Map<string, object>([
        [
          `repos/${REPOSITORY}`,
          {
            id: 12,
            owner: { id: 34 },
            full_name: REPOSITORY,
            default_branch: "main",
          },
        ],
        [
          `repos/${REPOSITORY}/git/ref/heads/main`,
          { ref: "refs/heads/main", object: { sha: parent } },
        ],
        [`repos/${REPOSITORY}/actions/runs/700/attempts/1`, run],
      ]);
      const reads: string[] = [];
      expect(
        verifyCurrentRun(policy, descriptor, executor(replies, reads))
      ).toEqual(run);
      expect(reads.some(endpoint => endpoint.includes("comments"))).toBe(false);
      run.status = "completed";
      expect(() =>
        verifyCurrentRun(policy, descriptor, executor(replies, []))
      ).toThrow(/stale\/cancelled/);
    });
  });
});
