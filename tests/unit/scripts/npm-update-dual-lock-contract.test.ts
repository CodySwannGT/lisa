/** Real Git baselines must refuse substituted optional lock paths before preparation. */
import {
  mkdirSync,
  linkSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import { baseline } from "../../../all/copy-overwrite/scripts/lib/npm-update-prepare.mjs";
import { qualifiedBun } from "../../../all/copy-overwrite/scripts/lib/npm-update-bun.mjs";
import {
  proposalFrom,
  validateProposal,
  proposalFileNames,
  validateRawCommit,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import { descriptorFor } from "../../../all/copy-overwrite/scripts/lib/npm-update-gate.mjs";
import { originalDescriptor } from "../../../all/copy-overwrite/scripts/lib/npm-update-cancel-origin.mjs";
import { GitHub } from "../../../all/copy-overwrite/scripts/lib/npm-update-github.mjs";
import { gitObjectId } from "../../../all/copy-overwrite/scripts/lib/npm-update-object.mjs";
import { sha256 } from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";
import { canonicalJson } from "../../../all/copy-overwrite/scripts/lib/automation-provenance-contract.mjs";
import {
  runProcess,
  withPrivateRoot,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";

useIoLatencyBudget();
const PACKAGE_FILE = "package.json";
const NPM_LOCK_FILE = "package-lock.json";
const GIT_NAME = "user.name=Fixture";
const GIT_EMAIL = "user.email=fixture@example.test";
const ORIGINAL_BUN = '{"lockfileVersion":1}\n';
const FOREIGN_LOCK = "foreign.lock";
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
const POLICY = {
  version: 1,
  repository: "fixture/host",
  directory: ".",
  target: "main",
  maintainer: "Fixture",
  lisaOwner: "absent",
  packages: [{ name: "is-number", version: "7.0.0" }],
};
const UPDATES = [
  { name: "is-number", section: "dependencies", from: "6.0.0", to: "7.0.0" },
];
const FILES = {
  [PACKAGE_FILE]: JSON.stringify(AFTER),
  [NPM_LOCK_FILE]: JSON.stringify(LOCK),
};

/** Actual canonical validation runs in a new process at the staged native Git root. */
function stagedReadback(
  cwd: string,
  env: NodeJS.ProcessEnv,
  descriptor: object,
  message: string,
  policy: object
) {
  const identity = {
    ...env,
    GIT_AUTHOR_NAME: "github-actions[bot]",
    GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
    GIT_AUTHOR_DATE: "1700000000 +0000",
    GIT_COMMITTER_NAME: "github-actions[bot]",
    GIT_COMMITTER_EMAIL:
      "41898282+github-actions[bot]@users.noreply.github.com",
    GIT_COMMITTER_DATE: "1700000000 +0000",
  };
  const module = new URL(
    "../../../all/copy-overwrite/scripts/lib/automation-provenance-local.mjs",
    import.meta.url
  ).href;
  return runProcess(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'import fs from "node:fs"; const {localDescriptor}=await import(process.argv[1]); const v=JSON.parse(fs.readFileSync(0,"utf8")); localDescriptor(v.descriptor,Buffer.from(v.message),{runId:"1",runAttempt:"1"},v.policy); console.log("actual-staged-cohort-accepted");',
      module,
    ],
    {
      cwd,
      env: identity,
      input: JSON.stringify({ descriptor, message, policy }),
      allowed: [0, 1],
    }
  );
}

/** The committed fixture is synthetic data; all file and Git observations are native. */
async function committed(root: string, env: NodeJS.ProcessEnv, bun: boolean) {
  const cwd = join(root, "host");
  mkdirSync(cwd, { mode: 0o700 });
  writeFileSync(join(cwd, PACKAGE_FILE), JSON.stringify(BEFORE));
  writeFileSync(join(cwd, NPM_LOCK_FILE), "{}\n");
  if (bun) writeFileSync(join(cwd, "bun.lock"), ORIGINAL_BUN);
  const git = (args: string[]) => runProcess("git", args, { cwd, env });
  await git(["init"]);
  await git(["add", "."]);
  await git([
    "-c",
    GIT_NAME,
    "-c",
    GIT_EMAIL,
    "commit",
    "-m",
    "Original lock identity",
  ]);
  return cwd;
}

describe("committed optional Bun baseline", () => {
  it.each([
    "changed",
    "removed",
    "symlink",
    "dangling",
    "hardlink",
    "unexpected",
  ])("refuses a %s lock through the actual baseline reader", async mutation => {
    await withPrivateRoot(async (root, env) => {
      const cwd = await committed(root, env, mutation !== "unexpected");
      const file = join(cwd, "bun.lock");
      if (["removed", "symlink", "dangling", "hardlink"].includes(mutation))
        unlinkSync(file);
      if (mutation === "dangling") {
        symlinkSync(join(root, "absent.lock"), file);
        await expect(baseline(cwd, env)).rejects.toThrow();
        return;
      }
      if (mutation === "hardlink") {
        const foreign = join(root, FOREIGN_LOCK);
        writeFileSync(foreign, ORIGINAL_BUN);
        linkSync(foreign, file);
        await expect(baseline(cwd, env)).rejects.toThrow();
        expect(readFileSync(foreign, "utf8")).toBe(ORIGINAL_BUN);
        return;
      }
      if (mutation === "symlink") {
        const foreign = join(root, FOREIGN_LOCK);
        writeFileSync(foreign, ORIGINAL_BUN);
        symlinkSync(foreign, file);
        await expect(baseline(cwd, env)).rejects.toThrow();
        expect(readFileSync(foreign, "utf8")).toBe(ORIGINAL_BUN);
      } else {
        if (mutation !== "removed") writeFileSync(file, '{"changed":true}\n');
        await expect(baseline(cwd, env)).rejects.toThrow();
      }
    });
  });

  it("refuses a native executable alias and an actual unsupported Node tool", async () => {
    await withPrivateRoot(async (root, env) => {
      const actual = await runProcess(
        "bun",
        ["--eval", "console.log(process.execPath)"],
        { env }
      );
      const alias = join(root, "bun-alias");
      symlinkSync(actual.stdout.toString().trim(), alias);
      await expect(qualifiedBun(env, { executable: alias })).rejects.toThrow(
        /aliased/
      );
      const node = await runProcess("node", ["-p", "process.execPath"], {
        env,
      });
      await expect(
        qualifiedBun(env, { executable: node.stdout.toString().trim() })
      ).rejects.toThrow(/Bun1.3.8/);
    });
  });
});

describe("signed optional lock scope protocol", () => {
  it.each(["regular", "dangling", "symlink"])(
    "refuses a late %s Bun path against the genuine npm-only staged tree",
    async mutation => {
      await withPrivateRoot(async (root, env) => {
        const cwd = await committed(root, env, false);
        const git = (args: string[]) => runProcess("git", args, { cwd, env });
        const parent = (await git(["rev-parse", "HEAD"])).stdout
          .toString()
          .trim();
        const proposal = proposalFrom(POLICY, parent, BEFORE, FILES, UPDATES);
        const automation = { enabled: true, version: 1 };
        const preview = await descriptorFor({
          cwd,
          proposal,
          policy: POLICY,
          automation,
          allocation: {
            workItem: "fixture/host#1",
            claimCommentId: "1",
            claimSha256: "a".repeat(64),
          },
          runId: "1",
          runAttempt: "1",
          epoch: 1_700_000_000,
        });
        for (const [file, bytes] of Object.entries(proposal.files)) {
          if (typeof bytes !== "string")
            throw new Error("non-text proposal file");
          writeFileSync(join(cwd, file), bytes);
        }
        await git(["add", "--", ...proposalFileNames(proposal)]);
        const valid = await stagedReadback(
          cwd,
          env,
          preview.descriptor,
          preview.message,
          automation
        );
        expect(valid.code, valid.stderr.toString()).toBe(0);
        const foreign = join(root, FOREIGN_LOCK);
        if (mutation === "regular")
          writeFileSync(join(cwd, "bun.lock"), "late lock");
        else {
          if (mutation === "symlink") writeFileSync(foreign, "foreign bytes");
          symlinkSync(foreign, join(cwd, "bun.lock"));
        }
        const refused = await stagedReadback(
          cwd,
          env,
          preview.descriptor,
          preview.message,
          automation
        );
        expect(refused.code).toBe(1);
        if (mutation === "symlink")
          expect(readFileSync(foreign, "utf8")).toBe("foreign bytes");
      });
    }
  );
  it("retains the exact npm-only keys and binds both original and updated Bun bytes", () => {
    const plain = proposalFrom(POLICY, "a".repeat(40), BEFORE, FILES, UPDATES);
    const dual = proposalFrom(
      POLICY,
      plain.parent,
      BEFORE,
      { ...FILES, "bun.lock": "prepared Bun bytes" },
      UPDATES,
      "b".repeat(64)
    );
    expect(Object.hasOwn(plain, "bunLockSha256")).toBe(false);
    expect(proposalFileNames(plain)).toEqual([NPM_LOCK_FILE, PACKAGE_FILE]);
    expect(proposalFileNames(dual)).toEqual([
      "bun.lock",
      NPM_LOCK_FILE,
      PACKAGE_FILE,
    ]);
    expect(validateProposal(dual, POLICY)).toEqual(dual);
    expect(dual.key).not.toBe(plain.key);
    expect(dual.bindingKey).not.toBe(plain.bindingKey);
    expect(dual.selectionKey).toBe(plain.selectionKey);
    for (const changed of [
      { ...dual, bunLockSha256: "c".repeat(64) },
      { ...dual, files: { ...dual.files, "bun.lock": "substituted" } },
      { ...dual, files: FILES },
      { ...plain, files: dual.files },
      { ...dual, files: { ...dual.files, [FOREIGN_LOCK]: "extra" } },
    ])
      expect(() => validateProposal(changed, POLICY)).toThrow();
  });

  it("validates the actual three-file staged tree and refuses a substituted original digest", async () => {
    await withPrivateRoot(async (root, env) => {
      const cwd = await committed(root, env, true);
      const git = (args: string[]) => runProcess("git", args, { cwd, env });
      const parent = (await git(["rev-parse", "HEAD"])).stdout
        .toString()
        .trim();
      const original = readFileSync(join(cwd, "bun.lock"));
      const proposal = proposalFrom(
        POLICY,
        parent,
        BEFORE,
        { ...FILES, "bun.lock": "prepared Bun bytes" },
        UPDATES,
        sha256(original)
      );
      const automation = { enabled: true, version: 1 };
      const allocation = {
        workItem: "fixture/host#1",
        claimCommentId: "1",
        claimSha256: "a".repeat(64),
      };
      await expect(
        descriptorFor({
          cwd,
          proposal: proposalFrom(POLICY, parent, BEFORE, FILES, UPDATES),
          policy: POLICY,
          automation,
          allocation,
          runId: "1",
          runAttempt: "1",
          epoch: 1_700_000_000,
        })
      ).rejects.toThrow(/original Bun lock bytes differ/);
      const preview = await descriptorFor({
        cwd,
        proposal,
        policy: POLICY,
        automation,
        allocation,
        runId: "1",
        runAttempt: "1",
        epoch: 1_700_000_000,
      });
      const checkpoint = {
        digest: sha256(`${canonicalJson(preview.descriptor)}\n`),
        payload: { preview },
      };
      expect(
        originalDescriptor(
          checkpoint,
          proposal,
          {
            workItem: preview.descriptor.workItem,
            claimCommentId: preview.descriptor.claimCommentId,
            claimSha256: preview.descriptor.claimSha256,
          },
          automation
        )
      ).toEqual(preview.descriptor);
      expect(() =>
        originalDescriptor(
          checkpoint,
          { ...proposal, bunLockSha256: "c".repeat(64) },
          {
            workItem: preview.descriptor.workItem,
            claimCommentId: preview.descriptor.claimCommentId,
            claimSha256: preview.descriptor.claimSha256,
          },
          automation
        )
      ).toThrow(/original descriptor differs/);
      const descriptor = preview.descriptor;
      const raw = Buffer.from(
        `tree ${descriptor.tree}\nparent ${descriptor.parent}\nauthor ${descriptor.author}\ncommitter ${descriptor.committer}\n\n${preview.message}`
      );
      const commit = validateRawCommit(raw, descriptor, cwd);
      let authorizations = 0;
      const written: string[] = [];
      const api = {
        policy: { repository: POLICY.repository },
        request: async (
          endpoint: string,
          method = "GET",
          body?: { content?: string; tree?: { path: string; mode: string }[] }
        ) => {
          if (method === "GET")
            return {
              tree: {
                sha: (await git(["rev-parse", "HEAD^{tree}"])).stdout
                  .toString()
                  .trim(),
              },
            };
          if (endpoint.endsWith("/blobs")) {
            expect(authorizations).toBe(written.length + 1);
            written.push("blob");
            return {
              sha: gitObjectId(
                cwd,
                "blob",
                Buffer.from(body?.content ?? "", "base64")
              ),
            };
          }
          if (endpoint.endsWith("/trees")) {
            expect(body?.tree?.map(entry => entry.path)).toEqual(
              proposalFileNames(proposal)
            );
            expect(body?.tree?.every(entry => entry.mode === "100644")).toBe(
              true
            );
            return { sha: descriptor.tree };
          }
          return { sha: commit.sha };
        },
      };
      const published = await GitHub.prototype.gitCommit.call(
        api,
        proposal,
        descriptor,
        commit,
        async () => {
          authorizations += 1;
        },
        cwd
      );
      expect(published.sha).toBe(commit.sha);
      expect(authorizations).toBe(5);
      expect(written).toEqual(["blob", "blob", "blob"]);
      for (const [file, bytes] of Object.entries(proposal.files)) {
        if (typeof bytes !== "string")
          throw new Error("non-text proposal file");
        writeFileSync(join(cwd, file), bytes);
      }
      await git(["add", "--", ...proposalFileNames(proposal)]);
      const validate = (descriptor: object) =>
        stagedReadback(cwd, env, descriptor, preview.message, automation);
      const valid = await validate(preview.descriptor);
      expect(valid.code, valid.stderr.toString()).toBe(0);
      expect(valid.stdout.toString()).toContain(
        "actual-staged-cohort-accepted"
      );
      const wrong = await validate({
        ...preview.descriptor,
        bunLockSha256: "b".repeat(64),
      });
      expect(wrong.code).toBe(1);
      expect(wrong.stderr.toString()).toContain(
        "original Bun lock digest differs"
      );
      const foreign = join(root, FOREIGN_LOCK);
      writeFileSync(foreign, proposal.files["bun.lock"]);
      unlinkSync(join(cwd, "bun.lock"));
      symlinkSync(foreign, join(cwd, "bun.lock"));
      const aliased = await validate(preview.descriptor);
      expect(aliased.code).toBe(1);
      expect(readFileSync(foreign, "utf8")).toBe(proposal.files["bun.lock"]);
    });
  });
});
