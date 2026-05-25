import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const DEFAULT_TIMEOUT_MS = 45_000;

const AUTH_MISSING_PATTERNS = [
  /auth(?:entication)? (?:required|failed|missing)/i,
  /not authenticated/i,
  /no saved session/i,
  /sign in/i,
  /log in/i,
  /login required/i,
  /missing api key/i,
  /api key .* required/i,
  /oauth/i,
];

const runtimeSpecs = {
  cursor: {
    id: "cursor",
    envVar: "LISA_CURSOR_CLI",
    defaultCommand: "cursor-agent",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    helpArgs: ["--help"],
    versionArgs: ["--version"],
    docsEvidence:
      "Cursor CLI docs: `-p/--print` is non-interactive; `--output-format` supports json; `--force` enables direct file changes, so omit it for read-only advisory runs.",
    safeInvocation: {
      mode: "print",
      args: ["--print", "--output-format", "json"],
      readOnlyReason:
        "Cursor print mode proposes changes without applying them unless `--force` is added.",
      verification: "documentation",
    },
  },
  codex: {
    id: "codex",
    envVar: "LISA_CODEX_CLI",
    defaultCommand: "codex",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    helpArgs: ["exec", "--help"],
    versionArgs: ["--version"],
    docsEvidence:
      "Local `codex exec --help` confirms non-interactive `exec`, `--sandbox`, `--json`, `--skip-git-repo-check`, and `--output-last-message`.",
    safeInvocation: {
      mode: "exec",
      args: [
        "exec",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--json",
      ],
      readOnlyReason:
        "Codex can be pinned to a read-only sandbox for advisory-only execution.",
      verification: "local-help",
    },
  },
  copilot: {
    id: "copilot",
    envVar: "LISA_COPILOT_CLI",
    defaultCommand: "copilot",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    helpArgs: ["help"],
    versionArgs: ["--version"],
    docsEvidence:
      "GitHub Copilot CLI docs: `-p/--prompt` runs programmatically, `-s` suppresses session metadata, `--no-ask-user` blocks clarifying prompts, and tool access can be restricted with `--available-tools` plus `--deny-tool`.",
    safeInvocation: {
      mode: "programmatic",
      args: [
        "-s",
        "--no-ask-user",
        "--available-tools=view,grep,glob",
        "--deny-tool=write",
        "--deny-tool=shell",
        "--deny-tool=web_fetch",
        "--deny-tool=web_search",
      ],
      readOnlyReason:
        "Restrict the model to read/search tools and explicitly deny write, shell, and web access.",
      verification: "documentation",
    },
  },
  antigravity: {
    id: "antigravity",
    envVar: "LISA_ANTIGRAVITY_CLI",
    defaultCommand: "agy",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    helpArgs: ["--help"],
    versionArgs: ["--version"],
    docsEvidence:
      "Antigravity CLI docs expose `--sandbox` as a launch override and warn that auth falls back to browser sign-in when no saved session exists.",
    safeInvocation: {
      mode: "tui",
      args: ["--sandbox", "read-only"],
      readOnlyReason:
        "Antigravity exposes sandbox overrides; use the read-only preset and never the documented dangerous permission-bypass flag.",
      verification: "documentation",
    },
  },
};

export const RUNTIME_ADAPTERS = Object.freeze(runtimeSpecs);

/**
 * Return a safe environment mapping without assuming a Node global exists.
 *
 * @returns {NodeJS.ProcessEnv} Process environment values when available.
 */
function defaultEnv() {
  return globalThis.process?.env ?? {};
}

/**
 * Return the canonical council runtime spec for a supported runtime id.
 *
 * @param {keyof typeof runtimeSpecs} runtimeId Supported council runtime id.
 * @returns {(typeof runtimeSpecs)[keyof typeof runtimeSpecs]} Normalized runtime spec.
 */
export function getRuntimeSpec(runtimeId) {
  const spec = runtimeSpecs[runtimeId];
  if (!spec) {
    throw new Error(`Unknown council runtime: ${runtimeId}`);
  }
  return spec;
}

/**
 * Resolve the executable name for one runtime, honoring its environment override.
 *
 * @param {keyof typeof runtimeSpecs} runtimeId Supported council runtime id.
 * @param {NodeJS.ProcessEnv} [env] Optional environment override map.
 * @returns {string} Executable name to invoke for this runtime.
 */
export function resolveRuntimeCommand(runtimeId, env = defaultEnv()) {
  const spec = getRuntimeSpec(runtimeId);
  const override = env[spec.envVar]?.trim();
  return override && override.length > 0 ? override : spec.defaultCommand;
}

/**
 * Heuristically classify output as an authentication-missing failure.
 *
 * @param {string} output Combined stdout/stderr capture to inspect.
 * @returns {boolean} True when the output looks like a missing-auth failure.
 */
export function detectAuthMissing(output) {
  if (!output) {
    return false;
  }
  return AUTH_MISSING_PATTERNS.some(pattern => pattern.test(output));
}

/**
 * Build the normalized planning metadata for one runtime adapter.
 *
 * @param {keyof typeof runtimeSpecs} runtimeId Supported council runtime id.
 * @param {NodeJS.ProcessEnv} [env] Optional environment override map.
 * @returns {{
 *   runtime: string;
 *   envVar: string;
 *   command: string;
 *   timeoutMs: number;
 *   helpArgs: string[];
 *   versionArgs: string[];
 *   safeInvocation: { mode: string; args: string[]; readOnlyReason: string; verification: string };
 *   docsEvidence: string;
 * }} Runtime planning metadata.
 */
export function describeRuntimePlan(runtimeId, env = defaultEnv()) {
  const spec = getRuntimeSpec(runtimeId);
  return {
    runtime: runtimeId,
    envVar: spec.envVar,
    command: resolveRuntimeCommand(runtimeId, env),
    timeoutMs: spec.timeoutMs,
    helpArgs: [...spec.helpArgs],
    versionArgs: [...spec.versionArgs],
    safeInvocation: {
      ...spec.safeInvocation,
      args: [...spec.safeInvocation.args],
    },
    docsEvidence: spec.docsEvidence,
  };
}

/**
 * Execute one probe command and normalize the capture payload.
 *
 * @param {string} command Executable to run.
 * @param {string[]} args Arguments for the probe.
 * @param {number} timeoutMs Timeout budget in milliseconds.
 * @returns {{
 *   args: string[];
 *   exitStatus: number | null;
 *   stdout: string;
 *   stderr: string;
 *   timedOut: boolean;
 *   signal: NodeJS.Signals | null;
 *   commandMissing: boolean;
 *   authMissing: boolean;
 *   error: { code: string | null; message: string } | null;
 * }} Structured probe capture.
 */
function capture(command, args, timeoutMs) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: timeoutMs,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const combinedOutput = [stdout, stderr].filter(Boolean).join("\n");
  const commandMissing =
    result.error?.code === "ENOENT" ||
    /not found/i.test(stderr) ||
    /is not recognized/i.test(stderr);

  return {
    args,
    exitStatus: typeof result.status === "number" ? result.status : null,
    stdout,
    stderr,
    timedOut: result.error?.code === "ETIMEDOUT",
    signal: result.signal ?? null,
    commandMissing,
    authMissing: detectAuthMissing(combinedOutput),
    error: result.error
      ? {
          code: result.error.code ?? null,
          message: result.error.message,
        }
      : null,
  };
}

/**
 * Probe help/version surfaces for one runtime and return structured capture metadata.
 *
 * @param {keyof typeof runtimeSpecs} runtimeId Supported council runtime id.
 * @param {NodeJS.ProcessEnv} [env] Optional environment override map.
 * @returns {ReturnType<typeof describeRuntimePlan> & {
 *   available: boolean;
 *   authMissing: boolean | null;
 *   helpProbe: ReturnType<typeof capture>;
 *   versionProbe: ReturnType<typeof capture>;
 * }} Runtime probe result.
 */
export function probeRuntimeAdapter(runtimeId, env = defaultEnv()) {
  const plan = describeRuntimePlan(runtimeId, env);
  const helpProbe = capture(plan.command, plan.helpArgs, plan.timeoutMs);
  const versionProbe = capture(plan.command, plan.versionArgs, plan.timeoutMs);
  const available = !helpProbe.commandMissing && !versionProbe.commandMissing;

  return {
    ...plan,
    available,
    authMissing:
      helpProbe.authMissing || versionProbe.authMissing
        ? true
        : available
          ? false
          : null,
    helpProbe,
    versionProbe,
  };
}

/**
 * Probe every supported council runtime adapter.
 *
 * @param {NodeJS.ProcessEnv} [env] Optional environment override map.
 * @returns {ReturnType<typeof probeRuntimeAdapter>[]} Probe results for every runtime.
 */
export function probeAllRuntimeAdapters(env = defaultEnv()) {
  return Object.keys(runtimeSpecs).map(runtimeId =>
    probeRuntimeAdapter(runtimeId, env)
  );
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const runtimes = process.argv.slice(2);
  const selected =
    runtimes.length > 0
      ? runtimes.map(runtimeId => probeRuntimeAdapter(runtimeId))
      : probeAllRuntimeAdapters();

  process.stdout.write(`${JSON.stringify(selected, null, 2)}\n`);
}
