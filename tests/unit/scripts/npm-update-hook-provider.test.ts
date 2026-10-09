import { qualifiedUpdaterNode } from "../../support/qualified-updater-node.js";
/** Native IPC/process controls use a synthetic GH executable, never authentic provider proof. */
import { describe, expect, it } from "vitest";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  startHookReadBroker,
  requestHookRead,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-hook-provider.mjs";
import { binaryDigest } from "../../../all/copy-overwrite/scripts/lib/npm-update-isolation.mjs";
import { sha256 } from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";
import {
  runProcess,
  writeJson,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import { hostedHookContext } from "../../../all/copy-overwrite/scripts/lib/npm-update-hosted-hook.mjs";
import { createSupervisedUnixFixture } from "../../helpers/supervised-unix-fixture.js";
import { SCRATCH_SUPERVISION_LEASE_ENV } from "../../../src/configs/vitest/scratch-supervision.js";

async function fixture(operation: (state: any) => Promise<void>) {
  const scratch = createSupervisedUnixFixture(
    "hook-reader.sock",
    process.env[SCRATCH_SUPERVISION_LEASE_ENV]
  );
  const root = scratch.root;
  const gh = join(root, "native-gh-fixture");
  writeFileSync(
    gh,
    "#!/bin/sh\nprintf 'native output\\n'\nprintf 'native error\\n' >&2\nexit 7\n",
    { mode: 0o700 }
  );
  mkdirSync(join(root, "gh-config"), { mode: 0o700 });
  const deadline = Date.now() + 10000;
  const subject = {
    phase: "hook-read",
    repository: "acme/widgets",
    tracker: "acme/widgets",
    issue: "42",
    branch: `lisa/npm-${"a".repeat(64)}`,
    parent: "b".repeat(40),
    origin: { runId: "10", runAttempt: "1" },
    claim: "123",
    recovery: null,
    maintainer: "maintainer",
    pr: null,
    proofs: [],
  };
  const profile = {
    version: 1,
    cwd: root,
    home: root,
    deadline,
    nativeGh: { path: gh, sha256: binaryDigest(gh) },
    subject,
    invocation: { entry: gh, args: [gh], cwd: root },
  };
  let broker;
  try {
    broker = await startHookReadBroker(
      profile,
      "synthetic-read-only-fixture-token"
    );
    await operation({
      root,
      broker,
      context: { root, path: broker.path, deadline },
      profile,
    });
  } finally {
    await broker?.close();
    scratch.close();
  }
}
const options = {
  encoding: "utf8",
  timeout: 30000,
  maxBuffer: 1048576,
  killSignal: "SIGKILL",
};
const SYSTEM_PATH = "/usr/bin:/bin";
const COMMIT_WORK_ITEM_SLOT = "commit-work-item";

function gatewayFixture(state: any, code: string, name = "lisa-work-item.mjs") {
  const entry = join(state.root, name);
  writeFileSync(entry, code);
  const runtime = qualifiedUpdaterNode();
  const node = runtime.path;
  const file = join(state.root, "hosted-hooks.json");
  writeJson(file, {
    version: 1,
    root: state.root,
    cwd: state.root,
    graph: { [entry]: sha256(code) },
    native: {
      node: runtime,
      git: { path: node, sha256: binaryDigest(node) },
      gh: state.profile.nativeGh,
    },
    reader: state.context,
  });
  return {
    node,
    entry,
    file,
    gateway: resolve(
      "all/copy-overwrite/scripts/lib/npm-update-hosted-hook.mjs"
    ),
  };
}

describe("hosted gate read-only provider transport", () => {
  it.each([
    { role: "commit", args: ["message"], code: 7 },
    { role: "audit", args: ["message"], code: 1 },
    { role: undefined, args: ["message"], code: 1 },
    { role: "commit", args: [], code: 1 },
    { role: "commit", args: ["message", "extra"], code: 1 },
    { role: "commit", args: ["--import=foreign"], code: 1 },
    { role: "commit", args: ["message"], code: 1, foreign: true },
  ])("routes only the real canonical commit CLI %#", async selection => {
    await fixture(async state => {
      const code =
        'import { spawnSync } from "node:child_process"; const result=spawnSync("gh",["--version"],{encoding:"utf8",timeout:5000,maxBuffer:65536}); process.stdout.write(JSON.stringify({token:process.env.GH_TOKEN??null,status:result.status})); process.exitCode=result.status??1;';
      const { node, gateway, file, entry } = gatewayFixture(
        state,
        code,
        selection.foreign ? "foreign.mjs" : "lisa-automation-provenance.mjs"
      );
      const result = await runProcess(
        node,
        [gateway, "--context", file, "--", entry, ...selection.args],
        {
          cwd: state.root,
          env: {
            PATH: SYSTEM_PATH,
            HOME: state.root,
            GH_TOKEN: "synthetic-must-be-removed",
            ...(selection.role ? { LISA_NPM_HOOK_ROLE: selection.role } : {}),
          },
          timeout: 8000,
          maximum: 65536,
          allowed: [1, 7],
        }
      );
      expect(result.code).toBe(selection.code);
      if (selection.code === 7)
        expect(JSON.parse(result.stdout.toString())).toEqual({
          token: null,
          status: 7,
        });
    });
  });
  it("reaches the actual token-free Node gateway/preload/client and preserves binary stdin and native refusal", async () => {
    await fixture(async state => {
      const code =
        'import { spawnSync } from "node:child_process"; import { readFileSync } from "node:fs"; const input=readFileSync(0); const result=spawnSync("gh",["--version"],{encoding:"utf8",timeout:5000,maxBuffer:65536}); process.stdout.write(JSON.stringify({input:input.toString("hex"),token:process.env.GH_TOKEN??null,...result})); process.exitCode=result.status??1;';
      const { node, file, gateway, entry } = gatewayFixture(state, code);
      const result = await runProcess(
        node,
        [gateway, "--context", file, "--", entry, "validate-commit", "message"],
        {
          cwd: state.root,
          env: {
            PATH: SYSTEM_PATH,
            HOME: state.root,
            GH_TOKEN: "synthetic-must-be-removed",
            LISA_NPM_HOOK_ROLE: "commit",
          },
          input: Buffer.from([65, 0, 10, 255]),
          timeout: 8000,
          allowed: [0, 7],
          maximum: 65536,
        }
      );
      expect(result.code).toBe(7);
      const observed = JSON.parse(result.stdout.toString());
      expect(observed.input).toBe("41000aff");
      expect(observed.token).toBe(null);
      expect(observed.status).toBe(7);
      expect(observed.stdout).toBe("native output\n");
      expect(observed.stderr).toBe("native error\n");
    });
  });
  it("preserves actual native failure/stdout/stderr and positively closes its owned listener", async () => {
    await fixture(async state => {
      const result = await requestHookRead(state.context, {
        slot: COMMIT_WORK_ITEM_SLOT,
        args: ["--version"],
        options,
      });
      expect(result.status).toBe(7);
      expect(Buffer.from(result.stdout, "base64").toString()).toBe(
        "native output\n"
      );
      expect(Buffer.from(result.stderr, "base64").toString()).toBe(
        "native error\n"
      );
      await state.broker.close();
      expect(existsSync(state.broker.path)).toBe(false);
    });
  });
  it("preserves native application subprocess overloads and callback results in an instrumented hook", async () => {
    await fixture(async state => {
      const code =
        'import { spawnSync, execFile, execFileSync } from "node:child_process"; const a=spawnSync("/bin/pwd",{encoding:"utf8"}); const b=execFileSync("/bin/pwd",{encoding:"utf8"}); const c=await new Promise((resolve,reject)=>execFile("/bin/pwd",{encoding:"utf8"},(error,stdout)=>error?reject(error):resolve(stdout))); process.stdout.write(JSON.stringify({a:a.stdout,b,c}));';
      const { node, gateway, file, entry } = gatewayFixture(state, code);
      const result = await runProcess(
        node,
        [gateway, "--context", file, "--", entry, "validate-commit", "message"],
        {
          cwd: state.root,
          env: { PATH: SYSTEM_PATH, HOME: state.root },
          timeout: 8000,
          maximum: 65536,
        }
      );
      expect(JSON.parse(result.stdout.toString())).toEqual({
        a: `${state.root}\n`,
        b: `${state.root}\n`,
        c: `${state.root}\n`,
      });
    });
  });
  it("refuses a changed graph, expired reader and canonical loader before granting a read route", async () => {
    await fixture(async state => {
      const { node, gateway, file, entry } = gatewayFixture(
        state,
        'process.stdout.write("unreached");'
      );
      const loader = await runProcess(
        node,
        [gateway, "--context", file, "--", entry, "--import=malicious"],
        {
          cwd: state.root,
          env: { PATH: SYSTEM_PATH, HOME: state.root },
          timeout: 8000,
          maximum: 65536,
          allowed: [1],
        }
      );
      expect(loader.stdout.length).toBe(0);
      writeFileSync(entry, 'process.stdout.write("changed");');
      expect(() => hostedHookContext(file)).toThrow(/changed/);
      rmSync(file);
      const expired = gatewayFixture(
        state,
        'process.stdout.write("unreached");'
      );
      const context = JSON.parse(readFileSync(expired.file, "utf8"));
      context.reader.deadline = Date.now() - 1;
      rmSync(expired.file);
      writeJson(expired.file, context);
      expect(() => hostedHookContext(expired.file)).toThrow(/context/);
    });
  });
  it("refuses writer, foreign subject, caller-selected native options and unknown slots", async () => {
    await fixture(async state => {
      for (const request of [
        {
          slot: COMMIT_WORK_ITEM_SLOT,
          args: ["api", "--method", "POST", "repos/acme/widgets/issues"],
          options,
        },
        {
          slot: COMMIT_WORK_ITEM_SLOT,
          args: ["issue", "view", "99", "--repo", "foreign/repo"],
          options,
        },
        {
          slot: COMMIT_WORK_ITEM_SLOT,
          args: ["--version"],
          options: { ...options, env: { GH_TOKEN: "chosen" } },
        },
        { slot: "arbitrary", args: ["--version"], options },
      ])
        await expect(requestHookRead(state.context, request)).rejects.toThrow(
          /refused/
        );
    });
  });
});
