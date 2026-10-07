/** The real installed Husky 8 package runs natively; hosted/provider authority is explicitly a unit fixture. */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  symlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import * as native from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import * as helper from "../../../all/copy-overwrite/scripts/lib/npm-update-helper.mjs";
import * as controller from "../../../all/copy-overwrite/scripts/lib/npm-update-controller-factory.mjs";
import * as broker from "../../../all/copy-overwrite/scripts/lib/npm-update-hook-provider.mjs";
import { createHostedGate } from "../../../all/copy-overwrite/scripts/lib/npm-update-hosted-gate.mjs";
const REPOSITORY = "acme/widgets";
const PARENT = "b".repeat(40);
const DECLARED_BIN = "lib/bin.js";
const BIN_PATH = `node_modules/husky/${DECLARED_BIN}`;
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
/** A disposable real Git checkout contains the actual installed Husky package, never a fake bin.js alias. */
async function huskyCheckout(root: string, env: NodeJS.ProcessEnv) {
  const cwd = join(root, "host");
  mkdirSync(join(cwd, ".husky"), { recursive: true });
  cpSync(resolve("node_modules/husky"), join(cwd, "node_modules/husky"), {
    recursive: true,
    dereference: true,
  });
  for (const name of [
    "pre-commit",
    "prepare-commit-msg",
    "commit-msg",
    "pre-push",
  ])
    writeFileSync(
      join(cwd, ".husky", name),
      '#!/bin/sh\n. "$(dirname "$0")/_/husky.sh"\nexit 0\n',
      { mode: 0o755 }
    );
  for (const name of ["package.json", "package-lock.json"])
    writeFileSync(join(cwd, name), "{}\n");
  await native.runProcess("git", ["init", "--object-format=sha1"], {
    cwd,
    env,
  });
  await native.runProcess(
    "git",
    ["add", ".husky", "package.json", "package-lock.json"],
    { cwd, env }
  );
  await native.runProcess(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "Fixture hooks",
    ],
    { cwd, env }
  );
  return cwd;
}

/** Only unrelated graph/provider authority is stubbed; original installation and committed wrapper reads execute. */
function hostedAuthority(cwd: string) {
  const nativeRun = native.runProcess;
  vi.spyOn(native, "runProcess").mockImplementation((command, args, options) =>
    command === "npm"
      ? Promise.resolve({
          code: 0,
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
        })
      : nativeRun(command, args, options)
  );
  vi.spyOn(helper, "qualifiedControllerGraph").mockResolvedValue({});
  vi.spyOn(controller, "controllerTools").mockReturnValue({
    node: {
      path: process.execPath,
      version: process.versions.node,
      sha256: "0".repeat(64),
    },
    git: { path: "/usr/bin/git", sha256: "0".repeat(64) },
    gh: { path: "/unit/uninvoked-gh", sha256: "0".repeat(64) },
  } as ReturnType<typeof controller.controllerTools>);
  vi.spyOn(controller, "controllerSubject").mockReturnValue({
    phase: "hook-read",
    repository: REPOSITORY,
    tracker: REPOSITORY,
    issue: "42",
    branch: "unit",
    parent: PARENT,
    origin: { runId: "1", runAttempt: "1" },
    claim: "7",
    recovery: null,
    maintainer: "fixture",
    pr: null,
    proofs: [],
  });
  vi.spyOn(broker, "startHookReadBroker").mockRejectedValue(
    new Error("unit provider seam reached after original installation")
  );
  for (const [name, value] of Object.entries({
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_SHA: PARENT,
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "workflow_dispatch",
  }))
    vi.stubEnv(name, value);
  return {
    cwd,
    deadline: Date.now() + 120_000,
    policy: { repository: REPOSITORY },
    proposal: { parent: PARENT },
    config: {
      automationProvenance: { allowedTriggers: ["workflow_dispatch"] },
    },
  };
}

describe("declared Husky installer compatibility", () => {
  it("executes the real Husky 8 bin install and retains original committed/executable hook readback", async () => {
    await native.withPrivateRoot(async (root, env) => {
      const cwd = await huskyCheckout(root, env);
      const context = hostedAuthority(cwd);
      await hostedPlatform(async () => {
        await expect(createHostedGate(context, root, env)).rejects.toThrow(
          "unit provider seam reached after original installation"
        );
        expect(
          JSON.parse(
            readFileSync(join(cwd, "node_modules/husky/package.json"), "utf8")
          ).bin
        ).toBe(DECLARED_BIN);
        expect(native.runProcess).toHaveBeenCalledWith(
          process.execPath,
          [join(cwd, BIN_PATH), "install"],
          expect.objectContaining({ cwd, timeout: expect.any(Number) })
        );
      });
    });
  });
  it.each([
    { name: "foreign" },
    { version: "9.0.0" },
    { bin: "../foreign.js" },
    { bin: "/foreign.js" },
    { bin: "lib/bin.js\n" },
    { bin: { foreign: DECLARED_BIN } },
    { bin: null },
  ])(
    "refuses an unsupported declaration before native installer/provider use: %j",
    async change => {
      await native.withPrivateRoot(async (root, env) => {
        const cwd = await huskyCheckout(root, env);
        const file = join(cwd, "node_modules/husky/package.json");
        const metadata = JSON.parse(readFileSync(file, "utf8"));
        writeFileSync(file, JSON.stringify({ ...metadata, ...change }));
        const context = hostedAuthority(cwd);
        await hostedPlatform(async () => {
          await expect(createHostedGate(context, root, env)).rejects.toThrow(
            /declaration is unsupported/
          );
        });
        expect(broker.startHookReadBroker).not.toHaveBeenCalled();
        expect(
          vi
            .mocked(native.runProcess)
            .mock.calls.some(call => call[0] === process.execPath)
        ).toBe(false);
      });
    }
  );
  it("refuses an aliased declared installer before executing it", async () => {
    await native.withPrivateRoot(async (root, env) => {
      const cwd = await huskyCheckout(root, env);
      const bin = join(cwd, BIN_PATH);
      unlinkSync(bin);
      symlinkSync(resolve(BIN_PATH), bin);
      const context = hostedAuthority(cwd);
      await hostedPlatform(async () => {
        await expect(createHostedGate(context, root, env)).rejects.toThrow(
          /aliased/
        );
      });
      expect(broker.startHookReadBroker).not.toHaveBeenCalled();
    });
  });
});

/** This diagnostic projection exercises the local installer; it does not qualify an actual Linux Actions caller. */
async function hostedPlatform(action: () => Promise<void>) {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  const arch = Object.getOwnPropertyDescriptor(process, "arch")!;
  Object.defineProperty(process, "platform", { value: "linux" });
  Object.defineProperty(process, "arch", { value: "x64" });
  try {
    await action();
  } finally {
    Object.defineProperty(process, "platform", platform);
    Object.defineProperty(process, "arch", arch);
  }
}
