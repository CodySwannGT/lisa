/** Native Git verifies committed runtime authority; provider/signing replies are not simulated here. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import { proposalFrom } from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import { descriptorFor } from "../../../all/copy-overwrite/scripts/lib/npm-update-gate.mjs";
import { originalDescriptor } from "../../../all/copy-overwrite/scripts/lib/npm-update-cancel-origin.mjs";
import { canonicalJson } from "../../../all/copy-overwrite/scripts/lib/automation-provenance-contract.mjs";
import { sha256 } from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";
import {
  runProcess,
  withPrivateRoot,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";

useIoLatencyBudget();
const UNCOMMITTED_CONFIG = "uncommitted-config";
const RUNTIME = {
  profile: "rails-mysql",
  database: "lisa_runtime",
  browser: false,
  dockerFixtures: false,
};
const POLICY = {
  version: 1,
  repository: "fixture/host",
  directory: ".",
  target: "main",
  maintainer: "Fixture",
  lisaOwner: "absent",
  packages: [{ name: "is-number", version: "7.0.0" }],
};
const BEFORE = {
  name: "fixture",
  version: "1.0.0",
  dependencies: { "is-number": "6.0.0" },
};
const AFTER = { ...BEFORE, dependencies: { "is-number": "7.0.0" } };
const FILES = {
  "package.json": JSON.stringify(AFTER),
  "package-lock.json": JSON.stringify({
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
  }),
};
const UPDATES = [
  { name: "is-number", section: "dependencies", from: "6.0.0", to: "7.0.0" },
];
const ALLOCATION = {
  workItem: "fixture/host#1",
  claimCommentId: "1",
  claimSha256: "b".repeat(64),
};

/** Fresh committed configuration and actual Git objects bind each protocol control. */
async function fixture(root: string, env: NodeJS.ProcessEnv, runtime: boolean) {
  const cwd = join(root, "host");
  mkdirSync(cwd, { mode: 0o700 });
  const policy = runtime ? { ...POLICY, runtime: RUNTIME } : POLICY;
  writeFileSync(
    join(cwd, ".lisa.config.json"),
    JSON.stringify({ npmUpdater: policy })
  );
  writeFileSync(join(cwd, "package.json"), JSON.stringify(BEFORE));
  writeFileSync(join(cwd, "package-lock.json"), "{}\n");
  const git = (args: string[]) => runProcess("git", args, { cwd, env });
  await git(["init"]);
  await git(["add", "."]);
  await git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-m",
    "Committed runtime policy",
  ]);
  const parent = (await git(["rev-parse", "HEAD"])).stdout.toString().trim();
  const proposal = proposalFrom(policy, parent, BEFORE, FILES, UPDATES);
  const preview = await descriptorFor({
    cwd,
    proposal,
    policy,
    automation: {},
    allocation: ALLOCATION,
    runId: "1",
    runAttempt: "1",
    epoch: 1700000000,
  });
  for (const [file, bytes] of Object.entries(FILES))
    writeFileSync(join(cwd, file), bytes);
  await git(["add", "package.json", "package-lock.json"]);
  return { cwd, proposal, preview };
}

/** The actual canonical local verifier runs in the native fixture cwd with fixed original identities. */
function readback(
  cwd: string,
  env: NodeJS.ProcessEnv,
  descriptor: object,
  message: string
) {
  const module = new URL(
    "../../../all/copy-overwrite/scripts/lib/automation-provenance-local.mjs",
    import.meta.url
  ).href;
  return runProcess(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'import fs from "node:fs";const {localDescriptor}=await import(process.argv[1]);const v=JSON.parse(fs.readFileSync(0,"utf8"));localDescriptor(v.descriptor,Buffer.from(v.message),{runId:"1",runAttempt:"1"},{});console.log("accepted");',
      module,
    ],
    {
      cwd,
      env: {
        ...env,
        GIT_AUTHOR_NAME: "github-actions[bot]",
        GIT_COMMITTER_NAME: "github-actions[bot]",
        GIT_AUTHOR_EMAIL:
          "41898282+github-actions[bot]@users.noreply.github.com",
        GIT_COMMITTER_EMAIL:
          "41898282+github-actions[bot]@users.noreply.github.com",
        GIT_AUTHOR_DATE: "1700000000 +0000",
        GIT_COMMITTER_DATE: "1700000000 +0000",
      },
      input: JSON.stringify({ descriptor, message }),
      allowed: [0, 1],
    }
  );
}

describe("committed signed runtime descriptor", () => {
  it("carries the complete profile digest through the genuine descriptor constructor", async () => {
    await withPrivateRoot(async (root, env) => {
      const { proposal, preview } = await fixture(root, env, true);
      expect(preview.descriptor.runtimeSha256).toBe(proposal.runtimeSha256);
    });
  });

  it.each(["omitted", "substituted", "valid", UNCOMMITTED_CONFIG])(
    "checks %s digest against actual HEAD policy",
    async control => {
      await withPrivateRoot(async (root, env) => {
        const { cwd, proposal, preview } = await fixture(root, env, true);
        const runtimeSha256 = proposal.runtimeSha256;
        if (typeof runtimeSha256 !== "string")
          throw new Error("fixture runtime digest is absent");
        const descriptor: Omit<typeof preview.descriptor, "runtimeSha256"> & {
          runtimeSha256?: string;
        } = {
          ...preview.descriptor,
          runtimeSha256,
        };
        if (control === "omitted") delete descriptor.runtimeSha256;
        if (control === "substituted")
          descriptor.runtimeSha256 = "f".repeat(64);
        if (control === UNCOMMITTED_CONFIG)
          writeFileSync(
            join(cwd, ".lisa.config.json"),
            JSON.stringify({ npmUpdater: POLICY })
          );
        const result = await readback(cwd, env, descriptor, preview.message);
        expect(result.code).toBe(
          ["valid", UNCOMMITTED_CONFIG].includes(control) ? 0 : 1
        );
        if (["valid", UNCOMMITTED_CONFIG].includes(control))
          expect(result.stdout.toString()).toBe("accepted\n");
      });
    }
  );

  it("refuses an unsigned extra runtime on a genuine npm-only HEAD", async () => {
    await withPrivateRoot(async (root, env) => {
      const { cwd, preview } = await fixture(root, env, false);
      expect(
        (await readback(cwd, env, preview.descriptor, preview.message)).code
      ).toBe(0);
      expect(
        (
          await readback(
            cwd,
            env,
            {
              ...preview.descriptor,
              runtimeSha256: sha256(canonicalJson(RUNTIME)),
            },
            preview.message
          )
        ).code
      ).toBe(1);
    });
  });

  it("retains historical cancellation digest equality and refuses omission", async () => {
    await withPrivateRoot(async (root, env) => {
      const { proposal, preview } = await fixture(root, env, true);
      const descriptor = {
        ...preview.descriptor,
        runtimeSha256: proposal.runtimeSha256,
      };
      const checkpoint = {
        digest: sha256(`${canonicalJson(descriptor)}\n`),
        payload: { preview: { ...preview, descriptor } },
      };
      expect(originalDescriptor(checkpoint, proposal, ALLOCATION, {})).toEqual(
        descriptor
      );
      const { runtimeSha256: _digest, ...omitted } = descriptor;
      const altered = {
        digest: sha256(`${canonicalJson(omitted)}\n`),
        payload: { preview: { ...preview, descriptor: omitted } },
      };
      expect(() =>
        originalDescriptor(altered, proposal, ALLOCATION, {})
      ).toThrow();
    });
  });
});
