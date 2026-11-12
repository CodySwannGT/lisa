/** Doctor check for a CodeRabbit CLI required by the project's gate policy. */
import { execFile } from "node:child_process";
import { env as processEnvironment } from "node:process";
import { promisify } from "node:util";
import { importGateRegistry } from "./gate-registry-source.js";
import type { GateRegistryModule } from "./gate-report-registry.js";
import { readConfinedMergedConfig } from "./confined-project-read.js";
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
  readonly status: "ready" | "warn" | "fail" | "disabled";
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
 * Match the provider name without inspecting a project's shell commands.
 * @param value - Declared signal or tool name
 * @returns Whether this names CodeRabbit
 */
function namesCodeRabbit(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === CODERABBIT;
}

/**
 * Whether a project explicitly declares the CLI as its prover's tool.
 * @param gate - Project gate declaration
 * @returns Whether gate-level needs.tools names CodeRabbit
 */
function needsCodeRabbit(gate: unknown): boolean {
  const needs = isJsonObject(gate) ? gate.needs : undefined;
  const tools = isJsonObject(needs) ? needs.tools : undefined;
  return Array.isArray(tools) && tools.some(namesCodeRabbit);
}

/** Effective hosted and project-local CodeRabbit usage. */
interface CodeRabbitPolicy {
  readonly local: readonly {
    readonly name: string;
    readonly required: boolean;
  }[];
  readonly hosted: readonly string[];
}

/**
 * Explain which configured work determines CLI readiness.
 * @param policy - Effective active gate moments
 * @returns Operator-readable context for every probe outcome
 */
function policyContext(policy: CodeRabbitPolicy): string {
  if (policy.local.length === 0) {
    return `${policy.hosted.join(", ")} is proven by CodeRabbit's hosted check run; the local CLI is optional. `;
  }
  const required = policy.local.filter(use => use.required);
  const decisive = required.length > 0 ? required : policy.local;
  const level = required.length > 0 ? "required" : "optional";
  return `CodeRabbit CLI ${level} for ${decisive.map(use => use.name).join(", ")}. `;
}

/**
 * Resolve active hosted signals and project-supplied CLI tasks using Lisa's
 * shipped registry. Lisa ships no CodeRabbit review runner: local use is a
 * project's run task with an explicit gate-level needs.tools declaration.
 * Every agent uses this same CLI policy; no vendor plugin requirement changes.
 * @param config - Confined committed-plus-local project configuration
 * @returns Named gate moments for each proof mode
 */
async function codeRabbitPolicy(config: JsonObject): Promise<CodeRabbitPolicy> {
  if (config.gates !== undefined && !isJsonObject(config.gates)) {
    throw new Error("gates must be an object");
  }
  const gates = Object.fromEntries(
    Object.entries(config.gates ?? {}).filter(
      ([id, gate]) =>
        id !== "runner" &&
        id !== "unproven" &&
        isJsonObject(gate) &&
        (needsCodeRabbit(gate) ||
          Object.values(gate).some(
            entry => isJsonObject(entry) && namesCodeRabbit(entry.await)
          ))
    )
  );
  if (Object.keys(gates).length === 0) return { local: [], hosted: [] };
  const registry =
    await importGateRegistry<
      Pick<GateRegistryModule, "validateGates" | "isMoment" | "resolveMoment">
    >();
  if (registry === null) throw new Error("Lisa's gate registry is unavailable");
  const problems = registry.validateGates(gates);
  if (problems.length > 0) throw new Error(problems.join("; "));
  const moments = [
    ...new Set(
      Object.values(gates).flatMap(gate =>
        isJsonObject(gate) ? Object.keys(gate).filter(registry.isMoment) : []
      )
    ),
  ].sort((left, right) => left.localeCompare(right));
  const uses = moments.flatMap(moment =>
    registry.resolveMoment({ gates, moment }).map(gate => {
      return {
        name: `${gate.id} at ${moment}`,
        required: gate.level === "required",
        local: gate.mode === "run" && needsCodeRabbit(gates[gate.id]),
        hosted: gate.mode === "await" && namesCodeRabbit(gate.awaits),
      };
    })
  );
  return {
    local: uses
      .filter(use => use.local)
      .map(use => ({ name: use.name, required: use.required })),
    hosted: uses.filter(use => use.hosted).map(use => use.name),
  };
}

/**
 * Read optional authentication state without logging in or exposing a key.
 * @param runner - Fixed-argv CodeRabbit command runner
 * @returns Remediation when authentication is unverified, otherwise null
 */
async function authenticationProblem(
  runner: CodeRabbitCommandRunner
): Promise<string | null> {
  const authentication = await runner(["auth", "status", "--agent"]);
  if (!authentication.ok) {
    return "CodeRabbit CLI is installed, but Lisa could not verify authentication with `coderabbit auth status --agent`; update the CLI and retry";
  }
  const authenticated = parseAuthenticationStatus(authentication.stdout);
  if (authenticated === null) {
    return "CodeRabbit CLI is installed, but Lisa could not verify authentication because `coderabbit auth status --agent` returned no valid status event; update the CLI and retry";
  }
  return authenticated ? null : authenticationGuidance();
}

/**
 * Probe a required local CLI or an optional CLI alongside hosted review.
 * Local project config overrides committed config through the same
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
  const policy = await codeRabbitPolicy(config);
  if (policy.local.length === 0 && policy.hosted.length === 0) {
    return {
      status: "disabled",
      detail: "No active gate uses CodeRabbit",
    };
  }
  const required = policy.local.some(use => use.required);
  const failureStatus = required ? "fail" : "warn";
  const context = policyContext(policy);

  if (!(await runner(["--version"])).ok) {
    return {
      status: policy.local.length > 0 ? failureStatus : "disabled",
      detail:
        policy.local.length > 0
          ? `${context}Its CLI is unavailable; install it from https://www.coderabbit.ai/cli`
          : `${context}The optional CLI is unavailable`,
    };
  }
  const problem = await authenticationProblem(runner);
  if (problem !== null) {
    return {
      status: failureStatus,
      detail: `${context}${problem}`,
    };
  }
  return {
    status: "ready",
    detail: `${context}CodeRabbit CLI is installed and authenticated`,
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
      status:
        readiness.status === "disabled" || readiness.status === "ready"
          ? "ok"
          : readiness.status,
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
