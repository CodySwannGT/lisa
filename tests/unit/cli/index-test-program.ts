/** Shared dependency-injected CLI program fixture. */
import type { Server } from "node:http";
import { vi } from "vitest";
import { createProgram } from "../../../src/cli/index.js";
import type { UpdateCheckResult } from "../../../src/cli/update-check.js";

const SKIPPED_RESULT: UpdateCheckResult = {
  current: "0.0.0",
  latest: null,
  isOutdated: false,
  reason: "skipped",
};

/** Dependency spies returned with one configured CLI program. */
export interface TestProgram {
  readonly program: ReturnType<typeof createProgram>;
  readonly runApply: ReturnType<typeof vi.fn>;
  readonly runSetupProject: ReturnType<typeof vi.fn>;
  readonly runSetupWiki: ReturnType<typeof vi.fn>;
  readonly runVersion: ReturnType<typeof vi.fn>;
  readonly runUpdate: ReturnType<typeof vi.fn>;
  readonly runDoctor: ReturnType<typeof vi.fn>;
  readonly runHealthCli: ReturnType<typeof vi.fn>;
  readonly runStandardsProofCli: ReturnType<typeof vi.fn>;
  readonly runSync: ReturnType<typeof vi.fn>;
  readonly runUi: ReturnType<typeof vi.fn>;
  readonly runCheckLearningsBudget: ReturnType<typeof vi.fn>;
  readonly runFileUpstream: ReturnType<typeof vi.fn>;
  readonly runUpdateCheck: ReturnType<typeof vi.fn>;
  readonly printUpdateWarning: ReturnType<typeof vi.fn>;
}

/**
 * Build a program with dependency spies for routing assertions.
 * @returns Configured program and its injected spies
 */
export function createTestProgram(): TestProgram {
  const runApply = vi.fn(async () => undefined);
  const runSetupProject = vi.fn(async () => undefined);
  const runSetupWiki = vi.fn(async () => undefined);
  const runVersion = vi.fn(async () => undefined);
  const runUpdate = vi.fn(async () => 0);
  const runDoctor = vi.fn(async () => ({ checks: [] }));
  const runHealthCli = vi.fn(async () => undefined);
  const runStandardsProofCli = vi.fn(async () => undefined);
  const runSync = vi.fn(async () => 0);
  const runUi = vi.fn(async () => ({}) as Server);
  const runCheckLearningsBudget = vi.fn(async () => 0);
  const runFileUpstream = vi.fn(async () => 0);
  const runUpdateCheck = vi.fn(async () => SKIPPED_RESULT);
  const printUpdateWarning = vi.fn();
  const program = createProgram({
    runApply,
    runSetupProject,
    runSetupWiki,
    runVersion,
    runUpdate,
    runDoctor,
    runHealthCli,
    runStandardsProofCli,
    runSync,
    runUi,
    runCheckLearningsBudget,
    runFileUpstream,
    runUpdateCheck,
    printUpdateWarning,
  }).exitOverride();
  return {
    program,
    runApply,
    runSetupProject,
    runSetupWiki,
    runVersion,
    runUpdate,
    runDoctor,
    runHealthCli,
    runStandardsProofCli,
    runSync,
    runUi,
    runCheckLearningsBudget,
    runFileUpstream,
    runUpdateCheck,
    printUpdateWarning,
  };
}
