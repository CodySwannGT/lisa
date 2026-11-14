/**
 * CodySwannGT/lisa#4859 review fix N9: the checkpoint phase for a Linear host,
 * end to end through finalizeAuthorization — signed work-item check, live-run
 * proof plus the tracker's own claim proof, the signed checkpoint written as
 * managed comments, and the exact readback. Only the two GitHub-side proofs
 * that need a real Actions run (official attestation verification and the
 * live run read) are stubbed; every tracker call goes through the Linear fake.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allocateLeaf } from "../../../all/copy-overwrite/scripts/lib/npm-update-allocate.mjs";
import {
  prepareAuthorization,
  finalizeAuthorization,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-authorization.mjs";
import { locateCheckpoint } from "../../../all/copy-overwrite/scripts/lib/npm-update-recovery.mjs";
import { createTracker } from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker.mjs";
import {
  readBytes,
  readJson,
  withPrivateRoot,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import { sha256 } from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";
import { fakeLinear } from "../../support/npm-update-linear-fake.js";
import {
  LINEAR_CONFIG,
  LINEAR_MAINTAINER,
  REGISTRY_METADATA,
  automation,
  codeHost,
  committedHost,
} from "../../support/npm-update-tracker-host.js";

const proofs = vi.hoisted(() => ({ attestation: vi.fn(), run: vi.fn() }));
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs",
  async importOriginal => ({
    ...(await importOriginal<object>()),
    verifyDescriptorAttestation: proofs.attestation,
  })
);
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/github-attestation-provider.mjs",
  async importOriginal => ({
    ...(await importOriginal<object>()),
    verifyCurrentRun: proofs.run,
  })
);

const CONFIG = { ...LINEAR_CONFIG, automationProvenance: await automation() };

describe("Linear checkpoint phase through finalizeAuthorization", () => {
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

  it("verifies the signed ENG ref, proves run and claim, persists and reads back the signed checkpoint", async () => {
    await withPrivateRoot(async (root, env) => {
      const host = await committedHost(root, env, LINEAR_MAINTAINER);
      const linear = fakeLinear({ members: [LINEAR_MAINTAINER] });
      const api = {
        ...codeHost(host.parent),
        tracker: createTracker(
          CONFIG,
          { LINEAR_API_KEY: "k" },
          linear.transport
        )!,
      };
      const base = { api, policy: host.policy, config: CONFIG };
      const allocation = await allocateLeaf({
        ...base,
        proposal: host.proposal,
        cwd: host.cwd,
      });
      const output = join(root, "phase");
      mkdirSync(output, { mode: 0o700 });
      await prepareAuthorization({
        ...base,
        cwd: host.cwd,
        output,
        proposal: host.proposal,
        allocation,
      });
      writeFileSync(join(output, "bundle.json"), "{}", { mode: 0o600 });
      const signed = {
        ...base,
        output,
        proposal: host.proposal,
        allocation: readJson(join(output, "allocation.json")),
        preview: readJson(join(output, "preview.json")),
      };
      const comments = linear.issues[0]!.comments.length;

      await expect(
        finalizeAuthorization({
          ...signed,
          allocation: { ...signed.allocation, workItem: "acme/widgets#1" },
        })
      ).rejects.toThrow(/work item/);
      expect(linear.issues[0]!.comments).toHaveLength(comments);

      expect(await finalizeAuthorization(signed)).toEqual({
        mode: "origin",
        complete: true,
      });
      const digest = sha256(readBytes(join(output, "descriptor.json"), 65_536));
      expect(proofs.run).toHaveBeenCalledWith(
        api.policy,
        signed.preview.descriptor
      );
      const located = locateCheckpoint(
        (await api.tracker.issue(1)).comments,
        host.proposal,
        host.policy
      );
      expect(located).toMatchObject({ signed: true, complete: true, digest });
      expect(readJson(join(output, "checkpoint.json"))).toEqual({
        version: 1,
        originDescriptorSha256: digest,
        complete: true,
      });
    });
  });
});
