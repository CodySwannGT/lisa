/** The actual CLI catch and orchestration retain failure while emitting only source-selected closed facts. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { join, resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import * as invariants from "../../../all/copy-overwrite/scripts/lib/npm-update-invariants.mjs";
import * as controller from "../../../all/copy-overwrite/scripts/lib/npm-update-controller-factory.mjs";
import * as contract from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import * as proof from "../../../all/copy-overwrite/scripts/lib/npm-update-gate-proof.mjs";
import * as preparation from "../../../all/copy-overwrite/scripts/lib/npm-update-prepare.mjs";
import { gateProposal } from "../../../all/copy-overwrite/scripts/lib/npm-update-gate.mjs";
import {
  createHostedGate,
  prepareRailsApplication,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-hosted-gate.mjs";
import {
  runProcess,
  withPrivateRoot,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";

import * as railsTools from "../../../all/copy-overwrite/scripts/lib/npm-update-rails-tools.mjs";

const CANARY = "SENSITIVE_DIAGNOSTIC_CANARY";
const CONTEXT_PHASE = "canonical-context";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Platform projection exercises an orchestration throw, never hosted caller authority. */
async function projectedHost(action: () => Promise<void>) {
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

describe("closed updater failure diagnostics", () => {
  it("keeps the original synchronous provenance error and innermost fixed phase without reading hostile properties", () => {
    const error = Object.freeze(new Error(CANARY));
    expect(() =>
      invariants.withProvenancePhase("local-proof", () =>
        invariants.withProvenancePhase(CONTEXT_PHASE, () => {
          throw error;
        })
      )
    ).toThrow(error);
    expect(invariants.provenanceFailure(error)).toBe(
      "Invalid automation provenance: required proof, policy or provider evidence failed (phase=canonical-context)"
    );
    expect(invariants.provenanceFailure(new Error(CANARY))).toContain(
      "phase=unknown"
    );
  });

  it.each([
    [CONTEXT_PHASE, "", "", 1, true],
    ["gateway-context", "", "", 1, true],
    [CONTEXT_PHASE, CANARY, "", 1, false],
    [CONTEXT_PHASE, "", CANARY, 1, false],
    [CANARY, "", "", 1, false],
    [CONTEXT_PHASE, "", "", 23, false],
    [CONTEXT_PHASE, "", "", 10, false],
  ])(
    "uses only a complete native closed diagnostic with failing status: %s/%s/%s/%s",
    async (phase, prefix, suffix, status, accepted) => {
      const line = `${prefix}Invalid automation provenance: required proof, policy or provider evidence failed (phase=${phase})\n${suffix}`;
      await withPrivateRoot(async (root, env) => {
        const error = await runProcess(
          process.execPath,
          [
            "-e",
            `process.stderr.write(${JSON.stringify(line)});process.exitCode=${status};`,
          ],
          { cwd: root, env }
        ).catch(value => value);
        const retained = error;
        Object.defineProperty(error, "stderr", {
          get() {
            throw new Error(CANARY);
          },
        });
        invariants.inheritProvenanceFailure(error);
        expect(error).toBe(retained);
        const diagnostic = invariants.publicFailure(error);
        expect(diagnostic.includes(`provenance=${phase}`)).toBe(accepted);
        expect(diagnostic).toContain(`native=exit status=${status}`);
        expect(diagnostic).not.toContain(CANARY);
      });
    }
  );

  it("rejects a forged diagnostic property without inspecting it", () => {
    const error = new Error(CANARY);
    Object.defineProperty(error, "stderr", {
      get() {
        throw new Error(CANARY);
      },
    });
    invariants.inheritProvenanceFailure(error);
    expect(invariants.publicFailure(error)).not.toContain("provenance=");
  });

  it("propagates the actual canonical command failure through hosted authentication before application setup", async () => {
    const tools = vi.spyOn(railsTools, "prepareRailsTools");
    await withPrivateRoot(async (root, env) => {
      const bin = join(root, "bin");
      mkdirSync(bin);
      writeFileSync(
        join(bin, "node"),
        "#!/bin/sh\nprintf 'Invalid automation provenance: required proof, policy or provider evidence failed (phase=canonical-context)\\n' >&2\nexit 1\n",
        { mode: 0o700 }
      );
      const context = { cwd: root, deadline: Date.now() + 30_000 };
      const scope = { env: { ...env, HOME: root, PATH: `${bin}:${env.PATH}` } };
      const error = await prepareRailsApplication(
        context,
        root,
        env,
        scope,
        {}
      ).catch(value => value);
      expect(invariants.publicFailure(error)).toContain(
        "stage=gate-validate native=exit status=1 provenance=canonical-context"
      );
      expect(tools).not.toHaveBeenCalled();
    });
  });

  it("reaches the real gateway catch without exposing malformed context bytes", async () => {
    await withPrivateRoot(async (root, env) => {
      const file = join(root, "hosted-hooks.json");
      writeFileSync(file, `{${CANARY}`);
      const result = await runProcess(
        process.execPath,
        [
          resolve("all/copy-overwrite/scripts/lib/npm-update-hosted-hook.mjs"),
          "--context",
          file,
          "--",
        ],
        { cwd: root, env, allowed: [1] }
      );
      expect(result.stderr.toString()).toContain("phase=gateway-context");
      expect(result.stderr.toString()).not.toContain(CANARY);
      expect(result.stderr.toString()).not.toContain(root);
    });
  });

  it("reaches the actual script catch after malformed committed configuration without revealing its content", async () => {
    await withPrivateRoot(async (root, env) => {
      await runProcess("git", ["init", "--object-format=sha1"], {
        cwd: root,
        env,
      });
      writeFileSync(join(root, ".lisa.config.json"), `{${CANARY}`);
      await runProcess("git", ["add", ".lisa.config.json"], { cwd: root, env });
      await runProcess(
        "git",
        [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "commit",
          "-m",
          "Fixture policy",
        ],
        { cwd: root, env }
      );
      const result = await runProcess(
        process.execPath,
        [
          resolve("all/copy-overwrite/scripts/lisa-npm-updater.mjs"),
          "prepare",
          root,
          join(root, "phase"),
        ],
        { cwd: root, env, allowed: [1] }
      );
      expect(result.code).toBe(1);
      expect(result.stderr.toString()).toContain("stage=configuration");
      expect(result.stderr.toString()).not.toContain(CANARY);
      expect(result.stderr.toString()).not.toContain(root);
      expect(result.stdout.length).toBe(0);
    });
  });

  it("annotates an actual hosted orchestration throw while retaining original identity and cause", async () => {
    const cause = new Error(CANARY);
    const error = new Error(CANARY, { cause });
    vi.spyOn(controller, "controllerTools").mockImplementation(() => {
      throw error;
    });
    const parent = "b".repeat(40);
    const repository = "acme/widgets";
    for (const [name, value] of Object.entries({
      GITHUB_ACTIONS: "true",
      RUNNER_ENVIRONMENT: "github-hosted",
      GITHUB_REPOSITORY: repository,
      GITHUB_SHA: parent,
      GITHUB_REF: "refs/heads/main",
      GITHUB_EVENT_NAME: "workflow_dispatch",
    }))
      vi.stubEnv(name, value);
    await projectedHost(async () => {
      const outcome = await createHostedGate(
        {
          policy: { repository },
          proposal: { parent },
          config: {
            automationProvenance: { allowedTriggers: ["workflow_dispatch"] },
          },
        },
        "/unused",
        {}
      ).catch(value => value);
      expect(outcome).toBe(error);
      expect(outcome.cause).toBe(cause);
      expect(invariants.publicFailure(outcome)).toContain("stage=gate-tools");
      expect(invariants.publicFailure(outcome)).not.toContain(CANARY);
    });
  });

  it("retains the innermost stage and rejects forged native properties without reading their getters", async () => {
    const error = new Error(CANARY);
    for (const name of [
      "message",
      "stack",
      "code",
      "signal",
      "stdout",
      "stderr",
      "command",
      "nativeCompleted",
    ])
      Object.defineProperty(error, name, {
        get() {
          throw new Error(CANARY);
        },
      });
    const outcome = await invariants
      .withStage("gate-scratch", () =>
        invariants.withStage("gate-commit", () => {
          throw error;
        })
      )
      .catch(value => value);
    expect(outcome).toBe(error);
    expect(invariants.publicFailure(outcome)).toContain("stage=gate-commit");
    expect(invariants.publicFailure(outcome)).not.toContain(CANARY);
    expect(invariants.publicFailure(outcome)).not.toContain("status=");
  });

  it("retains the real staging baseline throw and checked scratch cleanup before any native/provider helper", async () => {
    const error = new Error(CANARY);
    vi.spyOn(contract, "validateProposal").mockImplementation(value => value);
    vi.spyOn(proof, "validateGateProof").mockImplementation(() => {});
    vi.spyOn(preparation, "baseline").mockRejectedValue(error);
    const parent = "b".repeat(40);
    const repository = "acme/widgets";
    for (const [name, value] of Object.entries({
      GITHUB_ACTIONS: "true",
      RUNNER_ENVIRONMENT: "github-hosted",
      GITHUB_REPOSITORY: repository,
      GITHUB_SHA: parent,
      GITHUB_REF: "refs/heads/main",
      GITHUB_EVENT_NAME: "workflow_dispatch",
    }))
      vi.stubEnv(name, value);
    await projectedHost(async () => {
      const outcome = await gateProposal({
        cwd: "/unused",
        policy: { repository },
        proposal: { parent },
        preview: { epoch: 1 },
        token: "unit-uninvoked-token",
        config: {
          automationProvenance: { allowedTriggers: ["workflow_dispatch"] },
        },
      }).catch(value => value);
      expect(outcome).toBe(error);
      expect(preparation.baseline).toHaveBeenCalledOnce();
      expect(invariants.publicFailure(outcome)).toContain(
        "stage=gate-baseline"
      );
      expect(invariants.publicFailure(outcome)).not.toContain(CANARY);
    });
  });

  it("records real nonzero native close status without disclosing child output or command", async () => {
    await withPrivateRoot(async (root, env) => {
      const error = await invariants
        .withStage("gate-install", () =>
          runProcess(
            process.execPath,
            [
              "-e",
              `process.stdout.write('${CANARY}');process.stderr.write('${CANARY}');process.exitCode=23;`,
            ],
            { cwd: root, env }
          )
        )
        .catch(value => value);
      expect(error.code).toBe(23);
      expect(error.nativeCompleted).toBe(true);
      expect(error.stdout.toString()).toBe(CANARY);
      expect(invariants.publicFailure(error)).toContain(
        "stage=gate-install native=exit status=23"
      );
      expect(invariants.publicFailure(error)).not.toContain(CANARY);
      expect(invariants.publicFailure(error)).not.toContain(process.execPath);
    });
  });

  it("does not manufacture native status from an unrelated exception or serialize a hostile stage", async () => {
    const error = Object.assign(new Error(CANARY), {
      code: 23,
      signal: CANARY,
      stdout: CANARY,
    });
    expect(invariants.publicFailure(error)).not.toContain("status=");
    expect(invariants.publicFailure(error)).not.toContain(CANARY);
    await expect(
      invariants.withStage(CANARY, () => {
        throw error;
      })
    ).rejects.toThrow("invalid updater diagnostic stage");
  });

  it.each([CANARY, null, undefined, 0])(
    "retains primitive thrown value without printing it: %s",
    async value => {
      const outcome = await invariants
        .withStage("gate-validate", () => {
          throw value;
        })
        .catch(error => error);
      expect(outcome).toBe(value);
      expect(invariants.publicFailure(outcome)).toContain("stage=unknown");
      expect(invariants.publicFailure(outcome)).not.toContain(CANARY);
    }
  );

  it("supports frozen errors and redacts hostile native enum/status inputs", async () => {
    const error = Object.freeze(new Error(CANARY));
    const outcome = await invariants
      .withStage("gate-proof", () => {
        throw error;
      })
      .catch(value => value);
    expect(outcome).toBe(error);
    invariants.recordNativeFailure(error, CANARY, CANARY, CANARY, CANARY);
    expect(invariants.publicFailure(error)).toContain(
      "stage=gate-proof native=unknown status=null"
    );
    expect(invariants.publicFailure(error)).not.toContain(CANARY);
    expect(
      invariants.publicFailure(new invariants.UpdaterError(CANARY))
    ).not.toContain(CANARY);
  });

  it("reports a genuinely cancelled native invocation without changing null status into arithmetic exit143", async () => {
    await withPrivateRoot(async (root, env) => {
      const abort = new AbortController();
      const execution = invariants
        .withStage("gate-push", () =>
          runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
            cwd: root,
            env,
            signal: abort.signal,
          })
        )
        .catch(error => error);
      abort.abort();
      const error = await execution;
      expect(error.nativeCompleted).toBe(false);
      expect(error.code).toBeNull();
      expect(invariants.publicFailure(error)).toContain(
        "native=cancelled status=null signal=SIGTERM"
      );
    });
  });
});
