/**
 * First-round council collection: run each probed runtime through an injected
 * executor, normalize every capture, and build Claude's synthesis input.
 */

import { probeRuntimeAdapter, RUNTIME_ADAPTERS } from "./runtime-adapters.mjs";
import { normalizeCouncilContext } from "./council-shared.mjs";
import {
  normalizeCouncilOutput,
  parseCouncilOutput,
  sanitizeCouncilData,
  sanitizeCouncilText,
} from "./first-round-sanitize.mjs";
import {
  assertInvocationMatchesCouncilPolicy,
  buildFirstRoundInvocation,
  FIRST_ROUND_REQUIRED_SECTIONS,
  resolveCouncilFirstRoundExecutionPolicy,
} from "./first-round-plan.mjs";

/**
 * Normalize one executor result into a stable council capture.
 *
 * @param {{
 *   invocation: ReturnType<typeof buildFirstRoundInvocation>;
 *   probe: ReturnType<typeof probeRuntimeAdapter>;
 *   result?: {
 *     exitStatus?: number | null;
 *     stdout?: string;
 *     stderr?: string;
 *     timedOut?: boolean;
 *     authMissing?: boolean | null;
 *     notExecuted?: boolean;
 *     error?: { code?: string | null; message?: string } | null;
 *   };
 * }} input Runtime capture inputs.
 * @returns {{
 *   runtime: string;
 *   status: "responded" | "not_executed" | "empty" | "failed" | "timed_out" | "unavailable";
 *   command: string;
 *   args: string[];
 *   timeoutMs: number;
 *   authMissing: boolean | null;
 *   outputText: string;
 *   parsedOutput: unknown | null;
 *   stderrText: string;
 *   exitStatus: number | null;
 *   timedOut: boolean;
 *   unavailableReason: string | null;
 *   readOnlyReason: string;
 *   docsEvidence: string;
 *   error: { code: string | null; message: string } | null;
 * }} Normalized council capture.
 */
export function normalizeFirstRoundCapture({ invocation, probe, result = {} }) {
  const unavailableReason = !probe.available
    ? probe.helpProbe.commandMissing || probe.versionProbe.commandMissing
      ? "command-missing"
      : probe.authMissing
        ? "auth-missing"
        : "probe-failed"
    : null;

  if (unavailableReason) {
    return {
      runtime: invocation.runtime,
      status: "unavailable",
      command: invocation.command,
      args: invocation.safeInvocation.args,
      timeoutMs: invocation.timeoutMs,
      authMissing: probe.authMissing,
      outputText: "",
      parsedOutput: null,
      stderrText: "",
      exitStatus: null,
      timedOut: false,
      unavailableReason,
      readOnlyReason: invocation.safeInvocation.readOnlyReason,
      docsEvidence: invocation.docsEvidence,
      error: probe.helpProbe.error ?? probe.versionProbe.error,
    };
  }

  const normalizedStdout = normalizeCouncilOutput(result.stdout ?? "");
  const normalizedStderr = normalizeCouncilOutput(result.stderr ?? "");
  const parsedStdout = parseCouncilOutput(normalizedStdout);
  const parsedOutput =
    parsedStdout === null ? null : sanitizeCouncilData(parsedStdout);
  const outputText =
    parsedOutput === null
      ? sanitizeCouncilText(normalizedStdout)
      : JSON.stringify(parsedOutput);
  const stderrText = sanitizeCouncilText(normalizedStderr);
  const combinedText = [outputText, stderrText].filter(Boolean).join("\n\n");
  const timedOut = result.timedOut === true;
  const exitStatus =
    typeof result.exitStatus === "number" ? result.exitStatus : null;
  const hasExecutionError = result.error != null;

  const status =
    result.notExecuted === true
      ? "not_executed"
      : timedOut
        ? "timed_out"
        : hasExecutionError || (exitStatus ?? 0) !== 0
          ? "failed"
          : !combinedText
            ? "empty"
            : "responded";

  return {
    runtime: invocation.runtime,
    status,
    command: invocation.command,
    args: invocation.safeInvocation.args,
    timeoutMs: invocation.timeoutMs,
    authMissing: result.authMissing ?? probe.authMissing ?? false,
    outputText: combinedText,
    parsedOutput,
    stderrText,
    exitStatus,
    timedOut,
    unavailableReason: null,
    readOnlyReason: invocation.safeInvocation.readOnlyReason,
    docsEvidence: invocation.docsEvidence,
    error: result.error
      ? {
          code: result.error.code ?? null,
          message: result.error.message,
        }
      : null,
  };
}

/**
 * Convert an executor throw into the same shape as a failed runtime result.
 * @param {unknown} error Thrown executor error.
 * @returns {{
 *   exitStatus: number;
 *   stdout: string;
 *   stderr: string;
 *   timedOut: boolean;
 *   authMissing: null;
 *   error: { code: string; message: string };
 * }} Failed executor result.
 */
function normalizeExecutorException(error) {
  if (error instanceof Error) {
    return {
      exitStatus: 1,
      stdout: "",
      stderr: "",
      timedOut: false,
      authMissing: null,
      error: {
        code: "EXECUTOR_EXCEPTION",
        message: error.message,
      },
    };
  }

  return {
    exitStatus: 1,
    stdout: "",
    stderr: "",
    timedOut: false,
    authMissing: null,
    error: {
      code: "EXECUTOR_EXCEPTION",
      message: String(error),
    },
  };
}

/**
 * Execute a probed runtime and preserve loop progress when the executor throws.
 * @param {ReturnType<typeof buildFirstRoundInvocation>} invocation Runtime invocation payload.
 * @param {ReturnType<typeof probeRuntimeAdapter>} probe Runtime availability probe.
 * @param {NonNullable<Parameters<typeof collectFirstRoundResponses>[0]["executor"]> | undefined} executor Optional runtime executor.
 * @returns {Promise<Parameters<typeof normalizeFirstRoundCapture>[0]["result"] | undefined>} Executor result.
 */
async function executeFirstRoundInvocation(invocation, probe, executor) {
  if (!probe.available) {
    return undefined;
  }

  if (typeof executor !== "function") {
    return {
      exitStatus: 0,
      stdout:
        "No executor was provided for this non-dry first-round council run; runtime consultation was not executed.",
      stderr: "",
      timedOut: false,
      authMissing: probe.authMissing ?? false,
      notExecuted: true,
      error: null,
    };
  }

  try {
    return await executor(invocation);
  } catch (error) {
    return normalizeExecutorException(error);
  }
}

/**
 * Run the first-round consultation loop with an injected executor.
 *
 * @param {{
 *   topic: string;
 *   context?: {
 *     repository?: string;
 *     sourceArtifacts?: string[];
 *     targetEnvironment?: string;
 *   };
 *   runtimes?: (keyof typeof RUNTIME_ADAPTERS)[];
 *   runtime?: string | null;
 *   writeMode?: string | null;
 *   cwd?: string;
 *   env?: NodeJS.ProcessEnv;
 *   probeRuntime?: typeof probeRuntimeAdapter;
 *   executor?: (invocation: ReturnType<typeof buildFirstRoundInvocation>) => Promise<{
 *     exitStatus?: number | null;
 *     stdout?: string;
 *     stderr?: string;
 *     timedOut?: boolean;
 *     authMissing?: boolean | null;
 *     notExecuted?: boolean;
 *     error?: { code?: string | null; message?: string } | null;
 *   } | {
 *     exitStatus?: number | null;
 *     stdout?: string;
 *     stderr?: string;
 *     timedOut?: boolean;
 *     authMissing?: boolean | null;
 *     notExecuted?: boolean;
 *     error?: { code?: string | null; message?: string } | null;
 *   }>;
 * }} input Consultation inputs.
 * @returns {Promise<ReturnType<typeof buildFirstRoundSynthesisInput>>} Claude-facing synthesis inputs.
 */
export async function collectFirstRoundResponses({
  topic,
  context = {},
  runtimes = Object.keys(RUNTIME_ADAPTERS),
  runtime = null,
  writeMode = null,
  cwd,
  env,
  probeRuntime = probeRuntimeAdapter,
  executor,
}) {
  const executionPolicy = resolveCouncilFirstRoundExecutionPolicy({
    writeMode,
    runtime,
    cwd,
    env,
  });
  const captures = [];

  for (const runtime of runtimes) {
    const invocation = buildFirstRoundInvocation({
      topic,
      runtime,
      context,
      env,
    });
    assertInvocationMatchesCouncilPolicy(invocation, executionPolicy);
    const probe = probeRuntime(runtime, env);
    const result = await executeFirstRoundInvocation(
      invocation,
      probe,
      executor
    );

    captures.push(normalizeFirstRoundCapture({ invocation, probe, result }));
  }

  return buildFirstRoundSynthesisInput({ topic, context, captures });
}

/**
 * Convert normalized runtime captures into Claude-facing synthesis inputs.
 *
 * @param {{
 *   topic: string;
 *   context?: {
 *     repository?: string;
 *     sourceArtifacts?: string[];
 *     targetEnvironment?: string;
 *   };
 *   captures: ReturnType<typeof normalizeFirstRoundCapture>[];
 * }} input Synthesis inputs.
 * @returns {{
 *   topic: string;
 *   context: ReturnType<typeof normalizeCouncilContext>;
 *   requiredSections: string[];
 *   availableRuntimes: string[];
 *   unavailableRuntimes: Array<{ runtime: string; reason: string | null; authMissing: boolean | null }>;
 *   responseEvidence: Array<{
 *     runtime: string;
 *     status: string;
 *     outputText: string;
 *     parsedOutput: unknown | null;
 *     readOnlyReason: string;
 *     docsEvidence: string;
 *     error: { code: string | null; message: string } | null;
 *   }>;
 *   claudeSynthesisTemplate: {
 *     agreements: string[];
 *     disagreements: string[];
 *     runtimeSpecificRisks: string[];
 *     testsToAdd: string[];
 *     docsToUpdate: string[];
 *     openQuestions: string[];
 *   };
 * }} Claude-facing synthesis payload.
 */
export function buildFirstRoundSynthesisInput({
  topic,
  context = {},
  captures,
}) {
  const normalizedContext = normalizeCouncilContext(context);
  const availableRuntimes = captures
    .filter(capture => capture.status !== "unavailable")
    .map(capture => capture.runtime);
  const unavailableRuntimes = captures
    .filter(capture => capture.status === "unavailable")
    .map(capture => {
      return {
        runtime: capture.runtime,
        reason: capture.unavailableReason,
        authMissing: capture.authMissing,
      };
    });

  return {
    topic: topic.trim(),
    context: normalizedContext,
    requiredSections: [...FIRST_ROUND_REQUIRED_SECTIONS],
    availableRuntimes,
    unavailableRuntimes,
    responseEvidence: captures.map(capture => {
      return {
        runtime: capture.runtime,
        status: capture.status,
        outputText: capture.outputText,
        parsedOutput: capture.parsedOutput,
        readOnlyReason: capture.readOnlyReason,
        docsEvidence: capture.docsEvidence,
        error: capture.error,
      };
    }),
    claudeSynthesisTemplate: {
      agreements: [],
      disagreements: [],
      runtimeSpecificRisks: [],
      testsToAdd: [],
      docsToUpdate: [],
      openQuestions: captures
        .filter(capture => capture.status !== "responded")
        .map(capture => {
          return `${capture.runtime}: explain ${capture.status.replaceAll("_", " ")}`;
        }),
    },
  };
}
