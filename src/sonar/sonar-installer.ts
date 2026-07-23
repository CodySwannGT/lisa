/**
 * Detect the `sonar` CLI and run the vendor's per-agent integrate at apply time.
 *
 * This delegates to SonarSource's official `sonar integrate <agent>` — Lisa does
 * not reimplement the vendor's wiring. It is hard-gated so it never surprises a
 * project: it is a no-op unless the project has explicitly opted in
 * (`verification.sonar.enabled`) AND the `sonar` CLI is on `$PATH`. Per-agent
 * failures are swallowed so a partial or unauthenticated environment never breaks
 * `lisa apply`; `lisa doctor` surfaces the readiness gap instead.
 * @module sonar/sonar-installer
 */
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readProjectConfig } from "../core/project-config.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/** Result of the apply-time Sonar integrate pass. */
export interface SonarIntegrateResult {
  /** True when the project opted in via `verification.sonar.enabled`. */
  readonly enabled: boolean;
  /** True when opted in AND the `sonar` CLI was on PATH (integrate attempted). */
  readonly attempted: boolean;
  /** Vendor agent names whose `sonar integrate` exited zero. */
  readonly integrated: readonly string[];
  /** Vendor agent names whose `sonar integrate` failed. */
  readonly failed: readonly string[];
}

/**
 * Detect whether `sonar` is on PATH.
 * @returns True when sonar is callable.
 */
async function detectSonar(): Promise<boolean> {
  try {
    await execAsync("command -v sonar");
    return true;
  } catch {
    return false;
  }
}

/**
 * Run the vendor's non-interactive integrate for one agent.
 * @param agent - Vendor agent name (claude | codex | cursor | copilot | antigravity)
 * @returns True when integrate exited zero.
 */
async function integrateAgent(agent: string): Promise<boolean> {
  try {
    // execFile (no shell) so an agent token can never be interpreted.
    await execFileAsync("sonar", ["integrate", agent, "--non-interactive"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wire the official SonarQube MCP into each supported agent via `sonar integrate`.
 * @param projectRoot - Downstream project root (holds `.lisa.config.json`)
 * @param vendorAgents - Vendor agent names to integrate, derived from the harness
 * @returns Integrate result describing opt-in, attempt, and per-agent outcomes
 */
export async function installSonarIntegrations(
  projectRoot: string,
  vendorAgents: readonly string[]
): Promise<SonarIntegrateResult> {
  const config = (await readProjectConfig(projectRoot)).verification?.sonar;
  if (config?.enabled !== true) {
    return { enabled: false, attempted: false, integrated: [], failed: [] };
  }
  if (!(await detectSonar())) {
    return { enabled: true, attempted: false, integrated: [], failed: [] };
  }
  // Integrate agents one at a time (the vendor CLI mutates config), threading an
  // immutable accumulator so no array is mutated in place.
  const outcome = await vendorAgents.reduce<
    Promise<{
      readonly integrated: readonly string[];
      readonly failed: readonly string[];
    }>
  >(
    async (accP, agent) => {
      const acc = await accP;
      return (await integrateAgent(agent))
        ? { integrated: [...acc.integrated, agent], failed: acc.failed }
        : { integrated: acc.integrated, failed: [...acc.failed, agent] };
    },
    Promise.resolve({ integrated: [], failed: [] })
  );
  return { enabled: true, attempted: true, ...outcome };
}
