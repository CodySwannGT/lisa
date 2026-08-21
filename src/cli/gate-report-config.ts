/**
 * Read the settings file for the gate report.
 *
 * Deliberately a separate module so that a refusal is impossible to lose. The
 * registry REFUSES a runner that cannot run a task, and refuses a gates block
 * with an unknown moment key; both throw. Swallowed, either would produce a
 * report indistinguishable from a project that simply declared nothing — which
 * is precisely the reading this report exists to make impossible.
 * @module cli/gate-report-config
 */
import type { GateRegistryModule } from "./gate-report-registry.js";
import type { Finding } from "./gate-report-types.js";

/** The settings file, parsed, with every failure kept explicit. */
export interface ParsedConfig {
  readonly gates: Record<string, unknown>;
  readonly runner: string;
  readonly runnerFinding: Finding<string>;
  readonly runnerSource: "declared" | "default" | "unknown";
  readonly problems: string[];
}

/**
 * Read `.lisa.config.json`, degrading a refusal into a stated problem.
 * @param registry - The shipped registry
 * @param projectRoot - Project root
 * @returns The parsed config
 */
export function readConfig(
  registry: GateRegistryModule,
  projectRoot: string
): ParsedConfig {
  try {
    const { runner, gates } = registry.readGates(projectRoot);
    return {
      gates,
      runner,
      runnerFinding: { state: "verified", value: runner },
      runnerSource: runner === registry.DEFAULT_RUNNER ? "default" : "declared",
      problems: registry.validateGates(gates),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      gates: {},
      runner: registry.DEFAULT_RUNNER,
      runnerFinding: {
        state: "unknown",
        reason: "config-unreadable",
        message,
      },
      runnerSource: "unknown",
      problems: [message],
    };
  }
}
