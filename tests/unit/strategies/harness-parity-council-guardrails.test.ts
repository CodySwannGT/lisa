import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const sharedModuleUrl = pathToFileURL(
  path.resolve(".agents/skills/harness-parity-council/council-shared.mjs")
).href;
const firstRoundModuleUrl = pathToFileURL(
  path.resolve(".agents/skills/harness-parity-council/first-round.mjs")
).href;

const shared = await import(sharedModuleUrl);
const firstRound = await import(firstRoundModuleUrl);
const WORKSPACE_WRITE_MODE = "workspace-write";
const GUARDED_WORKSPACE_ENV = "LISA_COUNCIL_GUARDED_WORKSPACE";
const WRITE_ACK_ENV = "LISA_COUNCIL_ALLOW_WRITE";
const REGULAR_WORKSPACE_CWD = "/Users/dev/workspace/lisa";

describe("harness parity council guardrails", () => {
  it("defaults to explicit read-only policy even inside a worktree", () => {
    expect(
      shared.resolveCouncilExecutionPolicy(
        {
          cwd: "/Users/dev/.codex/worktrees/lisa",
        },
        {}
      )
    ).toEqual({
      mode: "read-only",
      writeMode: null,
      mutationAllowed: false,
      guardedWorkspace: true,
      guardedWorkspaceReason: "codex-worktree",
      requiresExplicitWriteAck: false,
      writeAck: false,
    });
  });

  it("rejects write mode outside a guarded workspace", () => {
    expect(() =>
      shared.resolveCouncilExecutionPolicy(
        {
          writeMode: WORKSPACE_WRITE_MODE,
          cwd: REGULAR_WORKSPACE_CWD,
        },
        {}
      )
    ).toThrow(
      /requires an isolated worktree or LISA_COUNCIL_GUARDED_WORKSPACE=1/
    );
  });

  it("rejects write mode without an explicit mutation acknowledgement", () => {
    expect(() =>
      shared.resolveCouncilExecutionPolicy(
        {
          writeMode: WORKSPACE_WRITE_MODE,
          cwd: "/Users/dev/.codex/worktrees/lisa",
        },
        {}
      )
    ).toThrow(/requires LISA_COUNCIL_ALLOW_WRITE=1/);
  });

  it("allows guarded write mode only after workspace and ack checks pass", () => {
    expect(
      shared.resolveCouncilExecutionPolicy(
        {
          writeMode: WORKSPACE_WRITE_MODE,
          cwd: REGULAR_WORKSPACE_CWD,
        },
        {
          [GUARDED_WORKSPACE_ENV]: "1",
          [WRITE_ACK_ENV]: "true",
        }
      )
    ).toEqual({
      mode: "guarded-write",
      writeMode: WORKSPACE_WRITE_MODE,
      mutationAllowed: true,
      guardedWorkspace: true,
      guardedWorkspaceReason: "env-override",
      requiresExplicitWriteAck: true,
      writeAck: true,
    });
  });

  it("records the resolved execution policy in dry-run planning output", () => {
    const plan = firstRound.buildCouncilDryRunPlan({
      topic: "Review Codex parity for install-time hooks",
      runtime: "codex",
      env: {},
      cwd: REGULAR_WORKSPACE_CWD,
    });

    expect(plan.executionPolicy).toEqual({
      mode: "read-only",
      writeMode: null,
      mutationAllowed: false,
      guardedWorkspace: true,
      guardedWorkspaceReason: "codex-worktree",
      requiresExplicitWriteAck: false,
      writeAck: false,
    });
  });

  it("uses one execution policy input shape for dry-run and real collection", async () => {
    const policyInput = {
      topic: "Review council policy parity",
      runtime: "codex",
      writeMode: WORKSPACE_WRITE_MODE,
      cwd: REGULAR_WORKSPACE_CWD,
      env: {
        [GUARDED_WORKSPACE_ENV]: "1",
        [WRITE_ACK_ENV]: "true",
      },
    };
    const dryRun = firstRound.buildCouncilDryRunPlan(policyInput);

    expect(
      firstRound.resolveCouncilFirstRoundExecutionPolicy(policyInput)
    ).toEqual(dryRun.executionPolicy);

    await expect(
      firstRound.collectFirstRoundResponses({
        topic: policyInput.topic,
        runtimes: ["codex"],
        runtime: policyInput.runtime,
        writeMode: policyInput.writeMode,
        cwd: policyInput.cwd,
        env: policyInput.env,
        probeRuntime: runtime => ({
          runtime,
          available: false,
          authMissing: false,
          helpProbe: {},
          versionProbe: {},
        }),
      })
    ).resolves.toMatchObject({
      unavailableRuntimes: [{ runtime: "codex" }],
    });
  });

  it("blocks adapter arguments that would violate the read-only policy", () => {
    expect(() =>
      firstRound.assertInvocationMatchesCouncilPolicy(
        {
          runtime: "codex",
          safeInvocation: {
            args: ["exec", "--sandbox", "danger-full-access", "--json"],
          },
        },
        {
          mode: "read-only",
        }
      )
    ).toThrow(/Unsafe read-only invocation for codex/);
  });
});
