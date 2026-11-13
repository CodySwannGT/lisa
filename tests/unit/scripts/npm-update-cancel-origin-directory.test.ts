/**
 * Stale-origin authentication for a subdirectory proposal (CodySwannGT/lisa#4741).
 *
 * The old parent commits a two-entry npmUpdater list. Authentication must
 * select the `externals` entry (the root entry cannot validate an externals
 * proposal) and must compare the old proposal's manifest with the committed
 * `externals/package.json`, not the root one, which differs on purpose. The
 * original provider is a stub that only records it was reached: everything
 * before it, including git, the policy and the descriptor, is genuine.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import { proposalFrom } from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import { canonicalJson } from "../../../all/copy-overwrite/scripts/lib/automation-provenance-contract.mjs";
import { descriptorFor } from "../../../all/copy-overwrite/scripts/lib/npm-update-gate.mjs";
import { authenticateStaleOrigin } from "../../../all/copy-overwrite/scripts/lib/npm-update-cancel-origin.mjs";
import { checkpointComments } from "../../../all/copy-overwrite/scripts/lib/npm-update-checkpoint.mjs";
import { sha256 } from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";
import {
  runProcess,
  withPrivateRoot,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";

const REACHED = "reached the original provider";
const provider = vi.hoisted(() => ({ stale: vi.fn() }));
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/github-attestation-provider.mjs",
  async importOriginal => ({
    ...(await importOriginal<object>()),
    verifyStaleOriginProvider: provider.stale,
  })
);
// Leaf drafting and live claim inspection are covered elsewhere; here they
// only hand back the allocation the checkpoint already carries.
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/npm-update-leaf.mjs",
  async importOriginal => ({
    ...(await importOriginal<object>()),
    historicalFiling: () => ALLOCATION.evidence,
    buildDraft: () => ALLOCATION.draft,
    inspectLeaf: async () => ({
      claimed: true,
      unassigned: false,
      claims: [{ id: 77, body: "claim", user: { id: 99, type: "Bot" } }],
    }),
    qualityGates: () => undefined,
  })
);

useIoLatencyBudget();
const EXTERNALS = "externals";
const AUTHORITY = {
  enabled: true,
  version: 1,
  repository: "fixture/host",
  repositoryId: "12",
  ownerId: "34",
  claimActorId: "99",
  ghExecutable: "/usr/local/bin/gh",
  ghSha256: "f".repeat(64),
};
const ENTRY = {
  version: 1,
  repository: "fixture/host",
  target: "main",
  maintainer: "Fixture",
  lisaOwner: "absent",
  packages: [{ name: "is-number", version: "7.0.0" }],
};
const SUB = { ...ENTRY, directory: EXTERNALS };
const CONFIG = {
  tracker: "github",
  github: { org: "fixture", repo: "host" },
  automationProvenance: AUTHORITY,
  npmUpdater: [{ ...ENTRY, directory: "." }, SUB],
};
const BEFORE = {
  name: "fixture",
  version: "1.0.0",
  dependencies: { "is-number": "6.0.0" },
};
const AFTER = { ...BEFORE, dependencies: { "is-number": "7.0.0" } };
const LOCK = {
  ...AFTER,
  lockfileVersion: 3,
  packages: {
    "": AFTER,
    "node_modules/is-number": {
      version: "7.0.0",
      resolved: "https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz",
      integrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}`,
    },
  },
};
const FILES = {
  "externals/package.json": JSON.stringify(AFTER),
  "externals/package-lock.json": JSON.stringify(LOCK),
};
const UPDATES = [
  { name: "is-number", section: "dependencies", from: "6.0.0", to: "7.0.0" },
];
const ALLOCATION = {
  number: 42,
  workItem: "fixture/host#42",
  claimCommentId: "77",
  claimSha256: sha256("claim"),
  draft: { title: "Update selected npm dependencies in externals", body: "b" },
  evidence: { history: "preserved" },
  quality: {},
};

/**
 * Commit a root project whose manifest differs from the externals one.
 * @param root - Positively owned fixture root.
 * @param env - Sanitized fixture environment.
 * @returns The checkout and its committed parent.
 */
async function host(root: string, env: NodeJS.ProcessEnv) {
  const cwd = join(root, "host");
  const git = (args: string[]) => runProcess("git", args, { cwd, env });
  mkdirSync(join(cwd, EXTERNALS), { recursive: true, mode: 0o700 });
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ ...BEFORE, name: "root-project" })
  );
  writeFileSync(join(cwd, "package-lock.json"), "{}\n");
  writeFileSync(join(cwd, EXTERNALS, "package.json"), JSON.stringify(BEFORE));
  writeFileSync(join(cwd, EXTERNALS, "package-lock.json"), "{}\n");
  writeFileSync(join(cwd, ".lisa.config.json"), JSON.stringify(CONFIG));
  await git(["init"]);
  await git(["add", "."]);
  await git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-m",
    "Old parent with two npm projects",
  ]);
  const parent = (await git(["rev-parse", "HEAD"])).stdout.toString().trim();
  return { cwd, parent };
}

describe("subdirectory stale-origin authentication", () => {
  it("selects the externals entry and reads the externals manifest at the old parent", async () => {
    await withPrivateRoot(async (root, env) => {
      const { cwd, parent } = await host(root, env);
      const old = proposalFrom(SUB, parent, BEFORE, FILES, UPDATES);
      const current = proposalFrom(SUB, "b".repeat(40), BEFORE, FILES, UPDATES);
      const preview = await descriptorFor({
        cwd,
        proposal: old,
        policy: SUB,
        automation: AUTHORITY,
        allocation: ALLOCATION,
        runId: "1",
        runAttempt: "1",
        epoch: 1_700_000_000,
      });
      const digest = sha256(`${canonicalJson(preview.descriptor)}\n`);
      const payload = {
        version: 1,
        proposal: old,
        allocation: ALLOCATION,
        preview,
        bundle: "{}",
      };
      const issue = {
        number: 42,
        state: "open",
        title: ALLOCATION.draft.title,
        body: ALLOCATION.draft.body,
        comments: checkpointComments(payload, digest).map(
          (body: string, index: number) => ({ id: 500 + index, body })
        ),
      };
      provider.stale.mockImplementation(() => {
        throw new Error(REACHED);
      });
      await expect(
        authenticateStaleOrigin({
          api: { policy: AUTHORITY, main: async () => undefined },
          cwd,
          issue,
          proposal: current,
          config: CONFIG,
        })
      ).rejects.toThrow(REACHED);
      const [authority, descriptor, replacementParent] =
        provider.stale.mock.calls[0]!;
      expect(authority).toEqual(AUTHORITY);
      expect(descriptor.directory).toBe(EXTERNALS);
      expect(replacementParent).toBe(current.parent);
    });
  });
});
