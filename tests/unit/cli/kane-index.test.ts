import { describe, expect, it, vi } from "vitest";
import { createProgram } from "../../../src/cli/index.js";

const DESTINATION = "./sample-proj";

/**
 * Create an isolated Commander program with Kane actions stubbed.
 * @returns Program and injected spies
 */
function kaneProgram() {
  const runKaneCli = vi.fn(async () => undefined);
  const runKaneProbeCli = vi.fn(async () => undefined);
  const runKanePilotCli = vi.fn(async () => undefined);
  const runUpdateCheck = vi.fn(async () => ({
    current: "0.0.0",
    latest: null,
    isOutdated: false,
    reason: "skipped",
  }));
  const program = createProgram({
    runKaneCli,
    runKaneProbeCli,
    runKanePilotCli,
    runUpdateCheck,
    printUpdateWarning: vi.fn(),
  }).exitOverride();
  return {
    program,
    runKaneCli,
    runKaneProbeCli,
    runKanePilotCli,
    runUpdateCheck,
  };
}

describe("Kane provider command group", () => {
  it("registers probe, run, and pilot", () => {
    const { program } = kaneProgram();
    const kane = program.commands.find(command => command.name() === "kane");

    expect(kane?.commands.map(command => command.name())).toEqual([
      "probe",
      "run",
      "pilot",
    ]);
  });

  it("routes a guarded run with explicit policy context", async () => {
    const { program, runKaneCli, runUpdateCheck } = kaneProgram();

    await program.parseAsync(
      [
        "kane",
        "run",
        DESTINATION,
        "--objective",
        "Verify checkout",
        "--environment",
        "staging",
        "--mutation",
        "full",
        "--url",
        "https://staging.example.test",
      ],
      { from: "user" }
    );

    expect(runKaneCli).toHaveBeenCalledWith(
      DESTINATION,
      expect.objectContaining({
        objective: "Verify checkout",
        environment: "staging",
        mutation: "full",
        url: "https://staging.example.test",
      })
    );
    expect(runUpdateCheck).not.toHaveBeenCalled();
  });

  it("routes readiness and report-only pilot commands", async () => {
    const { program, runKaneProbeCli, runKanePilotCli } = kaneProgram();

    await program.parseAsync(["kane", "probe", DESTINATION, "--json"], {
      from: "user",
    });
    await program.parseAsync(
      ["kane", "pilot", "docs/kane-cli-pilot.example.json", "--report-only"],
      { from: "user" }
    );

    expect(runKaneProbeCli).toHaveBeenCalledWith(DESTINATION, true);
    expect(runKanePilotCli).toHaveBeenCalledWith(
      "docs/kane-cli-pilot.example.json",
      true
    );
  });
});
