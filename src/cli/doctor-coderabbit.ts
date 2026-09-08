/** Doctor check for a CodeRabbit CLI required by the project's gate policy. */
import { execFile } from "node:child_process";
import { env as processEnvironment } from "node:process";
import { promisify } from "node:util";
import { readConfinedMergedConfig } from "./ui-confined-project-read.js";
import { isJsonObject, type JsonObject } from "../sync/json-path.js";
import type { DoctorCheck } from "./doctor.js";

const execFileAsync = promisify(execFile);
const CODERABBIT = "coderabbit";
const CODERABBIT_API_KEY = "CODERABBIT_API_KEY";

/** Outcome of one read-only CodeRabbit command. */
export interface CodeRabbitCommandResult {
  readonly ok: boolean;
  readonly stdout: string;
}

/** Injectable fixed-argv CodeRabbit runner. */
export type CodeRabbitCommandRunner = (
  args: readonly string[]
) => Promise<CodeRabbitCommandResult>;

/** Readiness outcome for an optional CodeRabbit CLI dependency. */
export interface CodeRabbitReadiness {
  readonly status: "ready" | "fail" | "disabled";
  readonly detail: string;
}

/** Dependencies used by the CodeRabbit doctor check. */
export interface CodeRabbitDoctorDependencies {
  readonly probeCodeRabbitReadiness: typeof probeCodeRabbitReadiness;
}

/**
 * Run a fixed-argv read-only CodeRabbit command without a shell.
 * @param args - Fixed CodeRabbit argument vector
 * @returns Whether the command exited zero
 */
export const runCodeRabbitCommand: CodeRabbitCommandRunner = async args => {
  try {
    const { stdout } = await execFileAsync(CODERABBIT, [...args], {
      timeout: 15_000,
    });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
};

/**
 * Read the explicit authentication boolean from CodeRabbit's NDJSON agent
 * output. Process success alone is not proof: current CLIs exit zero while
 * reporting `authenticated:false`.
 * @param output - Stdout from `coderabbit auth status --agent`
 * @returns The reported state, or null when no valid status record exists
 */
function parseAuthenticationStatus(output: string): boolean | null {
  return output
    .trim()
    .split(/\r?\n/u)
    .reduce<boolean | null>((authenticated, line) => {
      if (line.trim() === "") return authenticated;
      try {
        const status: unknown = JSON.parse(line);
        return isJsonObject(status) &&
          status.type === "status" &&
          typeof status.authenticated === "boolean"
          ? status.authenticated
          : authenticated;
      } catch {
        return authenticated;
      }
    }, null);
}

/**
 * Whether a headless Agentic key is available without reading its value.
 * @returns True when the standard CodeRabbit key variable is nonblank
 */
function hasHeadlessApiKey(): boolean {
  return (processEnvironment[CODERABBIT_API_KEY] ?? "").trim() !== "";
}

/**
 * Build actionable authentication guidance without ever embedding a secret.
 * @returns Headless-first remediation for the current environment
 */
function authenticationGuidance(): string {
  if (hasHeadlessApiKey()) {
    return 'CodeRabbit CLI is installed but not authenticated; headless credentials are available, so run `coderabbit auth login --api-key "$CODERABBIT_API_KEY"`';
  }
  return 'CodeRabbit CLI is installed but not authenticated; for headless use, create a CodeRabbit Agentic API key, expose it as `CODERABBIT_API_KEY`, then run `coderabbit auth login --api-key "$CODERABBIT_API_KEY"`; interactive fallback: run `coderabbit auth login`';
}

/**
 * Whether a gate declaration awaits CodeRabbit at any moment.
 * @param value - A value below the merged `gates` object
 * @returns True when an `await` declaration names CodeRabbit
 */
function awaitsCodeRabbit(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(entry => awaitsCodeRabbit(entry));
  }
  if (!isJsonObject(value)) return false;
  if (
    typeof value.await === "string" &&
    value.await.trim().toLowerCase() === CODERABBIT
  ) {
    return true;
  }
  return Object.values(value).some(entry => awaitsCodeRabbit(entry));
}

/**
 * Probe the local CodeRabbit prerequisite only when the effective gate policy
 * names it. Local project config overrides committed config through the same
 * bounded reader used by Lisa's console.
 * @param projectRoot - Project whose effective gate policy should be inspected
 * @param runner - Injectable CodeRabbit command runner
 * @param readConfig - Injectable effective-config reader
 * @returns Normalized CodeRabbit readiness
 */
export async function probeCodeRabbitReadiness(
  projectRoot: string,
  runner: CodeRabbitCommandRunner = runCodeRabbitCommand,
  readConfig: (root: string) => Promise<JsonObject> = readConfinedMergedConfig
): Promise<CodeRabbitReadiness> {
  const config = await readConfig(projectRoot);
  if (!awaitsCodeRabbit(config.gates)) {
    return {
      status: "disabled",
      detail: "No configured gate awaits CodeRabbit",
    };
  }

  if (!(await runner(["--version"])).ok) {
    return {
      status: "fail",
      detail:
        "CodeRabbit is configured, but its CLI is unavailable; install it from https://www.coderabbit.ai/cli",
    };
  }
  const authentication = await runner(["auth", "status", "--agent"]);
  if (!authentication.ok) {
    return {
      status: "fail",
      detail:
        "CodeRabbit CLI is installed, but Lisa could not verify authentication with `coderabbit auth status --agent`; update the CLI and retry",
    };
  }
  const authenticated = parseAuthenticationStatus(authentication.stdout);
  if (authenticated === null) {
    return {
      status: "fail",
      detail:
        "CodeRabbit CLI is installed, but Lisa could not verify authentication because `coderabbit auth status --agent` returned no valid status event; update the CLI and retry",
    };
  }
  if (!authenticated) {
    return { status: "fail", detail: authenticationGuidance() };
  }
  return {
    status: "ready",
    detail: "Configured CodeRabbit CLI is installed and authenticated",
  };
}

/**
 * Check the local CodeRabbit CLI when the effective gate policy requires it.
 * @param targetPath - Project path
 * @param deps - Injectable readiness probe
 * @returns Doctor check result
 */
export async function checkCodeRabbitProvider(
  targetPath: string,
  deps: CodeRabbitDoctorDependencies
): Promise<DoctorCheck> {
  try {
    const readiness = await deps.probeCodeRabbitReadiness(targetPath);
    return {
      name: "CodeRabbit CLI ready?",
      status: readiness.status === "fail" ? "fail" : "ok",
      detail: readiness.detail,
    };
  } catch (error) {
    return {
      name: "CodeRabbit CLI ready?",
      status: "fail",
      detail: `CodeRabbit gate config could not be evaluated: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
