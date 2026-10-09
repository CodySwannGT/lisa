import { qualifiedUpdaterNode } from "../../support/qualified-updater-node.js";
/** Real owned Unix listeners/Git paths qualify scope cleanup, not hosted/provider authority. */
import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  openHostedReadScope,
  authenticateHostedRuntime,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-hosted-scope.mjs";
import { runProcess } from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import { binaryDigest } from "../../../all/copy-overwrite/scripts/lib/npm-update-isolation.mjs";
import { sha256 } from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";
import { createSupervisedUnixFixture } from "../../helpers/supervised-unix-fixture.js";
import { SCRATCH_SUPERVISION_LEASE_ENV } from "../../../src/configs/vitest/scratch-supervision.js";

const injected = vi.hoisted(() => ({ closeFailure: false }));
const SOCKET_NAME = "hook-reader.sock";
const GIT_PATH = "/usr/bin/git";
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/npm-update-hook-provider.mjs",
  async importOriginal => {
    const original =
      await importOriginal<
        typeof import("../../../all/copy-overwrite/scripts/lib/npm-update-hook-provider.mjs")
      >();
    return {
      ...original,
      startHookReadBroker: async (
        ...args: Parameters<typeof original.startHookReadBroker>
      ) => {
        const broker = await original.startHookReadBroker(...args);
        return {
          ...broker,
          close: async () => {
            await broker.close();
            if (injected.closeFailure)
              throw new Error("synthetic close-report failure");
          },
        };
      },
    };
  }
);

async function fixture(operation: (state: any) => Promise<void>) {
  const scratch = createSupervisedUnixFixture(
    SOCKET_NAME,
    process.env[SCRATCH_SUPERVISION_LEASE_ENV]
  );
  const root = scratch.root;
  const env = { PATH: "/usr/bin:/bin", HOME: root };
  const step = (
    context: any,
    environment: any,
    command: string,
    args: string[]
  ) =>
    runProcess(command, args, {
      cwd: context.cwd,
      env: environment,
      timeout: 5000,
      maximum: 65536,
    });
  const runtime = qualifiedUpdaterNode();
  const nativePath = runtime.path;
  const context = {
    cwd: root,
    deadline: Date.now() + 10000,
    token: "synthetic-read-only-token",
    policy: { repository: "acme/widgets", maintainer: "maintainer" },
    proposal: {
      repository: "acme/widgets",
      parent: "b".repeat(40),
      key: "a".repeat(64),
    },
    allocation: {
      number: 42,
      workItem: "acme/widgets#42",
      claimCommentId: "123",
    },
    preview: {
      descriptor: {
        parent: "b".repeat(40),
        workItem: "acme/widgets#42",
        claimCommentId: "123",
        runId: "10",
        runAttempt: "1",
      },
    },
    config: {
      tracker: "github",
      github: { org: "acme", repo: "widgets" },
      deploy: { branches: { production: "main" } },
      automationProvenance: {
        signerWorkflow: "acme/widgets/.github/workflows/npm-updater.yml",
        signerDigest: "c".repeat(40),
      },
    },
  };
  const native = {
    node: runtime,
    git: { path: GIT_PATH, sha256: binaryDigest(GIT_PATH) },
    gh: { path: nativePath, sha256: binaryDigest(nativePath) },
  };
  try {
    await step(context, env, GIT_PATH, ["init", "-q"]);
    await operation({ root, context, env, native, step });
  } finally {
    scratch.close();
  }
}

describe("owned hosted read scope", () => {
  it("preserves the real post-install environment through the native gateway", async () => {
    await fixture(async state => {
      const entry = join(state.root, "environment.mjs");
      writeFileSync(
        entry,
        "process.stdout.write(JSON.stringify({path:process.env.PATH,bundle:process.env.BUNDLE_PATH,app:process.env.BUNDLE_APP_CONFIG,gem:process.env.GEM_PATH,home:process.env.HOME,ci:process.env.CI}));",
        { flag: "wx", mode: 0o600 }
      );
      const scope = await openHostedReadScope(
        state.context,
        state.root,
        state.env,
        state.native,
        {},
        state.step
      );
      try {
        const installed = {
          ...state.env,
          PATH: `${dirname(state.native.node.path)}:/usr/bin:/bin`,
          BUNDLE_PATH: join(state.root, "installed-bundle"),
          BUNDLE_APP_CONFIG: join(state.root, "bundle-config"),
          GEM_PATH: join(state.root, "qualified-gems"),
        };
        const env = scope.environment(installed);
        const result = await state.step(state.context, env, "node", [entry]);
        expect(JSON.parse(result.stdout.toString())).toEqual({
          path: `${join(state.root, "hook-bin")}:${installed.PATH}`,
          bundle: installed.BUNDLE_PATH,
          app: installed.BUNDLE_APP_CONFIG,
          gem: installed.GEM_PATH,
          home: state.root,
          ci: "true",
        });
      } finally {
        await scope.close();
      }
    });
  });

  it("retains native publication EEXIST when an injected close-report failure occurs after real listener cleanup", async () => {
    await fixture(async state => {
      const target = join(state.root, "hosted-hooks.json");
      writeFileSync(target, "retained context", { flag: "wx", mode: 0o600 });
      injected.closeFailure = true;
      try {
        await expect(
          openHostedReadScope(
            state.context,
            state.root,
            state.env,
            state.native,
            {},
            state.step
          )
        ).rejects.toMatchObject({
          name: "AggregateError",
          cause: { code: "EEXIST" },
          errors: [
            expect.objectContaining({ code: "EEXIST" }),
            expect.objectContaining({
              message: "synthetic close-report failure",
            }),
          ],
        });
      } finally {
        injected.closeFailure = false;
      }
      expect(readFileSync(target, "utf8")).toBe("retained context");
      expect(existsSync(join(state.root, SOCKET_NAME))).toBe(false);
    });
  });
  it.each([0, 10, 17])(
    "requires native zero from the canonical gateway (synthetic verifier exit %s)",
    async status => {
      await fixture(async state => {
        mkdirSync(join(state.root, "scripts"), { mode: 0o700 });
        const entry = join(
          state.root,
          "scripts/lisa-automation-provenance.mjs"
        );
        const code = `process.exitCode=${status};`;
        writeFileSync(entry, code, { flag: "wx", mode: 0o600 });
        writeFileSync(join(state.root, "message"), "synthetic", {
          flag: "wx",
          mode: 0o600,
        });
        const scope = await openHostedReadScope(
          state.context,
          state.root,
          state.env,
          state.native,
          { [entry]: sha256(code) },
          state.step
        );
        try {
          const result = authenticateHostedRuntime(
            state.context,
            state.root,
            scope,
            state.step
          );
          if (status === 0) await expect(result).resolves.toBeUndefined();
          else await expect(result).rejects.toThrow();
        } finally {
          await scope.close();
        }
        expect(existsSync(join(state.root, SOCKET_NAME))).toBe(false);
      });
    }
  );
  it("returns a token-free native gateway and positively closes its listener", async () => {
    await fixture(async state => {
      const scope = await openHostedReadScope(
        state.context,
        state.root,
        state.env,
        state.native,
        {},
        state.step
      );
      try {
        expect(scope.env.GH_TOKEN).toBeUndefined();
        expect(scope.env.GITHUB_TOKEN).toBeUndefined();
        expect(scope.env.PATH).toContain(join(state.root, "hook-bin"));
        expect(existsSync(join(state.root, SOCKET_NAME))).toBe(true);
      } finally {
        await scope.close();
      }
      expect(existsSync(join(state.root, SOCKET_NAME))).toBe(false);
    });
  });

  it("preserves an exclusive context collision and closes the already allocated native listener", async () => {
    await fixture(async state => {
      const target = join(state.root, "hosted-hooks.json");
      writeFileSync(target, "retained foreign context", {
        flag: "wx",
        mode: 0o600,
      });
      await expect(
        openHostedReadScope(
          state.context,
          state.root,
          state.env,
          state.native,
          {},
          state.step
        )
      ).rejects.toMatchObject({ code: "EEXIST" });
      expect(readFileSync(target, "utf8")).toBe("retained foreign context");
      expect(existsSync(join(state.root, SOCKET_NAME))).toBe(false);
    });
  });
});
