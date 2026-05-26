/* eslint-disable max-lines -- Keep the public first-round council entrypoint in one Lisa-local module. */

import {
  describeRuntimePlan,
  probeRuntimeAdapter,
  RUNTIME_ADAPTERS,
} from "./runtime-adapters.mjs";
import {
  normalizeCouncilContext,
  resolveCouncilRuntimes,
  resolveCouncilExecutionPolicy,
} from "./council-shared.mjs";
import {
  buildSecondRoundInvocation,
  buildSecondRoundSynthesisInput,
} from "./second-round.mjs";

export { resolveCouncilRuntimes, buildSecondRoundSynthesisInput };

export const FIRST_ROUND_REQUIRED_SECTIONS = Object.freeze([
  "Supported native surfaces for this feature",
  "Unsupported or partial parity areas",
  "Recommended artifact locations and naming conventions",
  "Permission and safety implications",
  "Testing strategy",
  "Migration risks",
  "Documentation requirements",
  "Questions Claude should resolve before implementation",
]);

const ANSI_ESCAPE_PATTERN =
  // Strip common SGR color/style escape sequences without touching regular text.
  /\u001B\[[0-9;]*m/gu;

const SECRET_PATTERNS = Object.freeze([
  /github_pat_\w{20,}/gu,
  /\bgh[opusr]_\w{20,}\b/gu,
  /\bsk-[\w-]{20,}\b/gu,
  /\bBearer\s+[\w.-]{12,}\b/giu,
  /\b((?:api|access|auth|refresh|secret)[-_ ]?key|token|password)\b\s*[:=]\s*([^\s,;]+)/giu,
]);

const RISKY_SUGGESTION_PATTERNS = Object.freeze([
  /\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|dlx|x)\b/i,
  /\b(?:git|gh)\s+(?:commit|push|merge|checkout|switch|reset|clean|pr\s+create|issue\s+edit)\b/i,
  /\b(?:apply_patch|write|edit|modify|delete|create)\b.*\b(?:file|files|repo|repository|host project|downstream|template|plugin)\b/i,
  /\b(?:host project|downstream install|generated artifact|plugin bundle|template output)\b/i,
]);

const RISKY_SUGGESTION_PREFIX =
  "[unsafe-runtime-suggestion: maintainer review required] ";

const UNSAFE_READ_ONLY_ARGS = Object.freeze([
  /--force\b/u,
  /--danger(?:ously)?(?:-\w+)?\b/u,
  /--yolo\b/u,
  /--sandbox(?:=|\s+)(?:workspace-write|danger-full-access)\b/u,
  /--ask-for-approval(?:=|\s+)never\b/u,
]);

/**
 * Reject adapter invocations that would violate the council execution policy.
 *
 * @param {{
 *   runtime: string;
 *   safeInvocation: { args: string[] };
 * }} invocation Runtime invocation metadata.
 * @param {{
 *   mode: "read-only" | "guarded-write";
 * }} executionPolicy Resolved council policy for this run.
 */
export function assertInvocationMatchesCouncilPolicy(
  invocation,
  executionPolicy
) {
  if (executionPolicy.mode !== "read-only") {
    return;
  }

  const serializedArgs = invocation.safeInvocation.args.join(" ");
  const unsafePattern = UNSAFE_READ_ONLY_ARGS.find(pattern =>
    pattern.test(serializedArgs)
  );
  if (!unsafePattern) {
    return;
  }

  throw new Error(
    `Unsafe read-only invocation for ${invocation.runtime}: ${serializedArgs}`
  );
}

/**
 * Build the structured first-round advisory prompt for one runtime.
 *
 * @param {{
 *   topic: string;
 *   runtime: string;
 *   context?: {
 *     repository?: string;
 *     sourceArtifacts?: string[];
 *     targetEnvironment?: string;
 *   };
 * }} input Prompt inputs.
 * @returns {string} Runtime-specific first-round advisory prompt.
 */
export function buildFirstRoundPrompt({ topic, runtime, context = {} }) {
  const trimmedTopic = topic?.trim();
  if (!trimmedTopic) {
    throw new Error("First-round council prompt requires a non-empty topic.");
  }

  const normalizedContext = normalizeCouncilContext(context);
  const artifactLines =
    normalizedContext.sourceArtifacts.length > 0
      ? normalizedContext.sourceArtifacts.map(artifact => `- ${artifact}`)
      : ["- None provided. Work only from the prompt and runtime knowledge."];

  return [
    `You are advising Claude on Lisa runtime parity for the \`${normalizedContext.repository}\` repository.`,
    `Runtime under consultation: ${runtime}.`,
    "",
    "Operate in read-only advisory mode.",
    "Do not edit files, install dependencies, commit, push, open PRs, or suggest destructive commands.",
    "Treat this as analysis only; Claude remains the final decision-maker.",
    "",
    "## Feature Topic",
    trimmedTopic,
    "",
    "## Repository Context",
    `- Repository: ${normalizedContext.repository}`,
    `- Target backend environment: ${normalizedContext.targetEnvironment}`,
    ...artifactLines,
    "",
    "## Required Response Sections",
    ...FIRST_ROUND_REQUIRED_SECTIONS.map((section, index) => {
      return `${index + 1}. ${section}`;
    }),
    "",
    "Use concise bullets under each section. Call out any uncertainty explicitly.",
  ].join("\n");
}

/**
 * Convert arbitrary CLI output into a stable text form for council synthesis.
 *
 * @param {string} value Raw CLI output.
 * @returns {string} Normalized text capture.
 */
export function normalizeCouncilOutput(value) {
  return `${value ?? ""}`
    .replaceAll("\r\n", "\n")
    .replace(ANSI_ESCAPE_PATTERN, "")
    .split("\n")
    .map(line => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/**
 * Redact obvious secret-like substrings from runtime output before synthesis.
 *
 * @param {string} value Normalized CLI output.
 * @returns {string} Output with token-like material replaced.
 */
export function redactSensitiveCouncilText(value) {
  return SECRET_PATTERNS.reduce((redacted, pattern) => {
    return redacted.replace(pattern, (...matches) => {
      if (matches.length >= 3 && typeof matches[1] === "string") {
        return `${matches[1]}=[REDACTED]`;
      }
      return "[REDACTED]";
    });
  }, value);
}

/**
 * Prefix risky or out-of-scope mutation suggestions so maintainers do not treat
 * them as safe instructions.
 *
 * @param {string} value Redacted runtime output.
 * @returns {string} Output with risky lines annotated.
 */
export function annotateRiskyCouncilText(value) {
  return value
    .split("\n")
    .map(line => {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        return line;
      }

      const isRisky = RISKY_SUGGESTION_PATTERNS.some(pattern =>
        pattern.test(trimmedLine)
      );
      if (!isRisky || trimmedLine.startsWith(RISKY_SUGGESTION_PREFIX)) {
        return line;
      }

      return `${RISKY_SUGGESTION_PREFIX}${line}`;
    })
    .join("\n");
}

/**
 * Sanitize normalized runtime output for maintainer-facing synthesis.
 *
 * @param {string} value Normalized CLI output.
 * @returns {string} Redacted and annotated output text.
 */
export function sanitizeCouncilText(value) {
  return annotateRiskyCouncilText(redactSensitiveCouncilText(value));
}

/**
 * Recursively sanitize structured runtime output values.
 *
 * @param {unknown} value Parsed runtime payload.
 * @returns {unknown} Payload with sensitive strings redacted and risky strings annotated.
 */
export function sanitizeCouncilData(value) {
  if (typeof value === "string") {
    return sanitizeCouncilText(value);
  }

  if (Array.isArray(value)) {
    return value.map(entry => sanitizeCouncilData(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sanitizeCouncilData(entry),
      ])
    );
  }

  return value;
}

/**
 * Parse JSON-like response text when possible; otherwise keep it as plain text.
 *
 * @param {string} value Normalized CLI output.
 * @returns {unknown | null} Parsed JSON value when available, else null.
 */
export function parseCouncilOutput(value) {
  const trimmed = value.trim();
  if (!trimmed || !["{", "["].includes(trimmed[0])) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Build the runtime invocation payload for the first-round consultation loop.
 *
 * @param {{
 *   topic: string;
 *   runtime: keyof typeof RUNTIME_ADAPTERS;
 *   context?: {
 *     repository?: string;
 *     sourceArtifacts?: string[];
 *     targetEnvironment?: string;
 *   };
 *   env?: NodeJS.ProcessEnv;
 * }} input Invocation inputs.
 * @returns {{
 *   runtime: string;
 *   command: string;
 *   args: string[];
 *   timeoutMs: number;
 *   prompt: string;
 *   safeInvocation: { mode: string; args: string[]; readOnlyReason: string; verification: string };
 * }} Invocation payload.
 */
export function buildFirstRoundInvocation({
  topic,
  runtime,
  context = {},
  env,
}) {
  return {
    ...describeRuntimePlan(runtime, env),
    prompt: buildFirstRoundPrompt({ topic, runtime, context }),
  };
}

/**
 * Parse the documented council CLI flags into a normalized argument object.
 * @param {string[]} argv CLI args excluding `node` and script path.
 * @returns {{
 *   topic: string;
 *   runtime: string | null;
 *   secondRound: boolean;
 *   dryRun: boolean;
 *   writeMode: string | null;
 *   sanitizedSummary: string | null;
 * }} Parsed council args.
 */
export function parseCouncilCliArgs(argv) {
  const readFlagValue = (flag, values, index, description) => {
    const value = values[index + 1] ?? "";
    if (!value.trim() || value.trim().startsWith("--")) {
      throw new Error(`The ${flag} flag requires ${description}.`);
    }
    return value;
  };

  const parsed = argv.reduce(
    (state, current, index, values) => {
      if (state.skipIndices.has(index)) {
        return state;
      }

      if (current === "--runtime") {
        const nextValue = readFlagValue(
          "--runtime",
          values,
          index,
          "a runtime name"
        );
        state.skipIndices.add(index + 1);
        return { ...state, runtime: nextValue };
      }

      if (current === "--write-mode") {
        const nextValue = readFlagValue(
          "--write-mode",
          values,
          index,
          "a mode value"
        );
        state.skipIndices.add(index + 1);
        return { ...state, writeMode: nextValue };
      }

      if (current === "--summary") {
        const nextValue = readFlagValue(
          "--summary",
          values,
          index,
          "sanitized summary text"
        );
        state.skipIndices.add(index + 1);
        return { ...state, sanitizedSummary: nextValue };
      }

      if (current === "--second-round") {
        return { ...state, secondRound: true };
      }

      if (current === "--dry-run") {
        return { ...state, dryRun: true };
      }

      return {
        ...state,
        topicParts: [...state.topicParts, current],
      };
    },
    {
      topicParts: [],
      runtime: null,
      writeMode: null,
      sanitizedSummary: null,
      secondRound: false,
      dryRun: false,
      skipIndices: new Set(),
    }
  );

  const topic = parsed.topicParts.join(" ").trim();
  if (!topic) {
    throw new Error(
      "Usage: node first-round.mjs <topic> [--runtime <name>] [--second-round] [--dry-run] [--write-mode <mode>] [--summary <text>]"
    );
  }

  return {
    topic,
    runtime: parsed.runtime?.trim().toLowerCase() ?? null,
    secondRound: parsed.secondRound,
    dryRun: parsed.dryRun,
    writeMode: parsed.writeMode?.trim() ?? null,
    sanitizedSummary: parsed.sanitizedSummary?.trim() ?? null,
  };
}

/**
 * Resolve first-round council execution policy from the same normalized input
 * shape for dry-run planning, collection, and CLI execution.
 * @param {{
 *   writeMode?: string | null;
 *   runtime?: string | null;
 *   cwd?: string;
 *   env?: NodeJS.ProcessEnv;
 * }} [input] Execution policy inputs.
 * @returns {ReturnType<typeof resolveCouncilExecutionPolicy>} Normalized execution policy.
 */
export function resolveCouncilFirstRoundExecutionPolicy({
  writeMode = null,
  runtime = null,
  cwd = process.cwd(),
  env,
} = {}) {
  return resolveCouncilExecutionPolicy({ writeMode, runtime, cwd }, env);
}

/**
 * Build the non-mutating dry-run planning payload for a council invocation.
 *
 * @param {{
 *   topic: string;
 *   context?: {
 *     repository?: string;
 *     sourceArtifacts?: string[];
 *     targetEnvironment?: string;
 *   };
 *   runtime?: string | null;
 *   secondRound?: boolean;
 *   sanitizedSummary?: string | null;
 *   writeMode?: string | null;
 *   cwd?: string;
 *   env?: NodeJS.ProcessEnv;
 * }} input Planning inputs.
 * @returns {{
 *   mode: "dry-run";
 *   topic: string;
 *   runtimeFilter: string | null;
 *   writeMode: string | null;
 *   executionPolicy: ReturnType<typeof resolveCouncilExecutionPolicy>;
 *   firstRound: ReturnType<typeof buildFirstRoundInvocation>[];
 *   secondRound: null | {
 *     sanitizedSummary: string;
 *     invocations: ReturnType<typeof buildSecondRoundInvocation>[];
 *   };
 * }} Dry-run planning payload.
 */
export function buildCouncilDryRunPlan({
  topic,
  context = {},
  runtime = null,
  secondRound = false,
  sanitizedSummary = null,
  writeMode = null,
  cwd,
  env,
}) {
  const executionPolicy = resolveCouncilFirstRoundExecutionPolicy({
    writeMode,
    runtime,
    cwd,
    env,
  });
  const runtimes = resolveCouncilRuntimes(runtime);
  const firstRound = runtimes.map(selectedRuntime =>
    buildFirstRoundInvocation({
      topic,
      runtime: selectedRuntime,
      context,
      env,
    })
  );
  const secondRoundSummary =
    secondRound && sanitizedSummary
      ? sanitizedSummary
      : secondRound
        ? "TODO: Claude sanitized synthesis goes here before round two."
        : null;
  firstRound.forEach(invocation =>
    assertInvocationMatchesCouncilPolicy(invocation, executionPolicy)
  );

  return {
    mode: "dry-run",
    topic: topic.trim(),
    runtimeFilter: runtime,
    writeMode,
    executionPolicy,
    firstRound,
    secondRound: secondRound
      ? {
          sanitizedSummary: secondRoundSummary,
          invocations: runtimes.map(selectedRuntime =>
            buildSecondRoundInvocation({
              topic,
              runtime: selectedRuntime,
              sanitizedSummary: secondRoundSummary,
              context,
              env,
            })
          ),
        }
      : null,
  };
}

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

/**
 * CLI entrypoint for printing first-round council synthesis inputs.
 */
async function main() {
  const parsed = parseCouncilCliArgs(process.argv.slice(2));
  const executionPolicy = resolveCouncilFirstRoundExecutionPolicy({
    writeMode: parsed.writeMode,
    runtime: parsed.runtime,
    env: globalThis.process?.env ?? {},
  });

  if (parsed.dryRun) {
    const plan = buildCouncilDryRunPlan(parsed);
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  const runtimes = resolveCouncilRuntimes(parsed.runtime);
  const firstRound = await collectFirstRoundResponses({
    topic: parsed.topic,
    runtimes,
    runtime: parsed.runtime,
    writeMode: parsed.writeMode,
  });
  const payload = {
    mode: "first-round",
    executionPolicy,
    ...firstRound,
    secondRound: parsed.secondRound
      ? buildSecondRoundSynthesisInput({
          topic: parsed.topic,
          sanitizedSummary:
            parsed.sanitizedSummary ??
            "TODO: Claude sanitized synthesis goes here before round two.",
          runtimes: firstRound.availableRuntimes,
        })
      : null,
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

const isEntrypoint = import.meta.url === `file://${process.argv[1]}`;

if (isEntrypoint) {
  await main();
}
/* eslint-enable max-lines -- End of the first-round entrypoint exception. */
