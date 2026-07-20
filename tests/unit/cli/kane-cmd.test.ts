import { describe, expect, it, vi } from "vitest";
import {
  runKaneCli,
  runKanePilotCli,
  runKaneProbeCli,
  type KaneCliDependencies,
} from "../../../src/cli/kane-cmd.js";

const OBJECTIVE = "Verify checkout";

/**
 * Create fully stubbed Kane command collaborators.
 * @returns Stubbed command dependencies
 */
function dependencies(): KaneCliDependencies {
  return {
    run: vi.fn(),
    probe: vi.fn(),
    write: vi.fn(),
    setExitCode: vi.fn(),
    executePilot: vi.fn(),
    readPilotReport: vi.fn(),
  };
}

describe("Kane CLI commands", () => {
  it("prints normalized JSON and maps a provider failure to exit 2", async () => {
    const deps = dependencies();
    vi.mocked(deps.run).mockResolvedValue({
      outcome: "tool_failed",
      exitCode: 2,
      progressCount: 0,
      parseWarnings: [],
      confirmedProductBug: false,
      stderr: "provider unavailable",
    });

    await runKaneCli(
      ".",
      {
        objective: OBJECTIVE,
        environment: "staging",
        mutation: "full",
        json: true,
      },
      deps
    );

    expect(deps.run).toHaveBeenCalledWith(
      expect.objectContaining({
        objective: OBJECTIVE,
        environment: "staging",
        mutation: "full",
      })
    );
    expect(deps.write).toHaveBeenCalledWith(
      expect.stringContaining('"outcome": "tool_failed"')
    );
    expect(deps.setExitCode).toHaveBeenCalledWith(2);
  });

  it("rejects an invalid max-step boundary before calling the adapter", async () => {
    const deps = dependencies();

    await expect(
      runKaneCli(
        ".",
        {
          objective: OBJECTIVE,
          environment: "staging",
          mutation: "full",
          maxSteps: "101",
        },
        deps
      )
    ).rejects.toThrow("integer from 1 to 100");
    expect(deps.run).not.toHaveBeenCalled();
  });

  it("maps a failed readiness probe to exit 1", async () => {
    const deps = dependencies();
    vi.mocked(deps.probe).mockResolvedValue({
      status: "fail",
      detail: "authentication failed",
    });

    await runKaneProbeCli(".", false, deps);

    expect(deps.write).toHaveBeenCalledWith("FAIL: authentication failed");
    expect(deps.setExitCode).toHaveBeenCalledWith(1);
  });

  it("uses the report-only path and fails only a rejected pilot", async () => {
    const deps = dependencies();
    vi.mocked(deps.readPilotReport).mockResolvedValue({
      verdict: "reject",
      reasons: ["policy incidents detected"],
      daysElapsed: 31,
      totalRuns: 50,
      evidenceCapturePercent: 100,
      providerFailurePercent: 0,
      inconsistentVerdictPercent: 0,
      timeReductionPercent: 50,
      evidenceCompletenessPercent: 100,
      policyIncidents: 1,
      averageCreditsPerRun: 2,
    });

    await runKanePilotCli("pilot.json", true, deps);

    expect(deps.readPilotReport).toHaveBeenCalledWith("pilot.json");
    expect(deps.executePilot).not.toHaveBeenCalled();
    expect(deps.setExitCode).toHaveBeenCalledWith(1);
  });
});
