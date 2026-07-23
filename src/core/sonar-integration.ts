/** Lisa readiness probe for the official SonarQube MCP provider. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readProjectConfig } from "./project-config.js";

const execFileAsync = promisify(execFile);

/** Outcome of a single read-only `sonar` CLI probe. */
export interface SonarProbeResult {
  /** True when the command exited zero. */
  readonly ok: boolean;
}

/** Injectable fixed-argv `sonar` CLI runner. */
export type SonarCommandRunner = (
  args: readonly string[]
) => Promise<SonarProbeResult>;

/** Readiness status for the optional Sonar provider. */
export interface SonarReadiness {
  readonly status: "ready" | "warn" | "fail" | "disabled";
  readonly detail: string;
}

/**
 * Run a fixed-argv read-only `sonar` command without a shell.
 * @param args - Fixed argument vector
 * @returns Whether the command exited zero
 */
export const runSonarCommand: SonarCommandRunner = async args => {
  try {
    await execFileAsync("sonar", [...args], { timeout: 15_000 });
    return { ok: true };
  } catch {
    return { ok: false };
  }
};

/**
 * Probe readiness of the official SonarQube MCP provider.
 *
 * Disabled (no `verification.sonar.enabled`) is healthy — the provider is
 * optional. When enabled, prove the `sonar` CLI is installed and authenticated
 * (`sonar auth status`, which honors either a login session or `SONARQUBE_CLI_TOKEN`).
 * @param projectRoot - Downstream project root
 * @param runner - Injectable process runner
 * @returns Readiness status for doctor and setup
 */
export async function probeSonarReadiness(
  projectRoot: string,
  runner: SonarCommandRunner = runSonarCommand
): Promise<SonarReadiness> {
  const config = (await readProjectConfig(projectRoot)).verification?.sonar;
  if (config?.enabled !== true) {
    return {
      status: "disabled",
      detail: "SonarQube MCP provider is not enabled",
    };
  }
  const version = await runner(["--version"]);
  if (!version.ok) {
    return {
      status: "fail",
      detail:
        "SonarQube CLI unavailable; run /lisa:setup:sonar to install and wire it",
    };
  }
  const auth = await runner(["auth", "status"]);
  if (!auth.ok) {
    return {
      status: "fail",
      detail:
        "SonarQube CLI not authenticated; run `sonar auth login` or set SONARQUBE_CLI_TOKEN (+ SONARQUBE_CLI_ORG for Cloud / SONARQUBE_CLI_SERVER for Server)",
    };
  }
  const target =
    config.projectKey ?? config.organization ?? "the configured project";
  return { status: "ready", detail: `SonarQube MCP ready for ${target}` };
}
