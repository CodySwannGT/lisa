import {
  RUNTIME_ADAPTERS,
  describeRuntimePlan,
  probeRuntimeAdapter,
} from "./runtime-adapters.mjs";

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

export const DEFAULT_COUNCIL_CONTEXT = Object.freeze({
  repository: "lisa",
  sourceArtifacts: [],
  targetEnvironment: "main",
});

const ANSI_ESCAPE_PATTERN =
  // Strip common SGR color/style escape sequences without touching regular text.
  /\u001B\[[0-9;]*m/gu;

/**
 * Normalize free-form context into a stable council input shape.
 *
 * @param {{
 *   repository?: string;
 *   sourceArtifacts?: string[];
 *   targetEnvironment?: string;
 * }} [context] Optional council context overrides.
 * @returns {{
 *   repository: string;
 *   sourceArtifacts: string[];
 *   targetEnvironment: string;
 * }} Normalized council context.
 */
export function normalizeCouncilContext(context = {}) {
  return {
    repository:
      context.repository?.trim() || DEFAULT_COUNCIL_CONTEXT.repository,
    sourceArtifacts: Array.isArray(context.sourceArtifacts)
      ? context.sourceArtifacts.map(value => `${value}`.trim()).filter(Boolean)
      : [...DEFAULT_COUNCIL_CONTEXT.sourceArtifacts],
    targetEnvironment:
      context.targetEnvironment?.trim() ||
      DEFAULT_COUNCIL_CONTEXT.targetEnvironment,
  };
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
 *     error?: { code?: string | null; message?: string } | null;
 *   };
 * }} input Runtime capture inputs.
 * @returns {{
 *   runtime: string;
 *   status: "responded" | "empty" | "failed" | "timed_out" | "unavailable";
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

  const outputText = normalizeCouncilOutput(result.stdout ?? "");
  const stderrText = normalizeCouncilOutput(result.stderr ?? "");
  const combinedText = [outputText, stderrText].filter(Boolean).join("\n\n");
  const timedOut = result.timedOut === true;
  const exitStatus =
    typeof result.exitStatus === "number" ? result.exitStatus : null;

  const status = timedOut
    ? "timed_out"
    : (exitStatus ?? 0) !== 0
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
    parsedOutput: parseCouncilOutput(outputText),
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
 *   env?: NodeJS.ProcessEnv;
 *   probeRuntime?: typeof probeRuntimeAdapter;
 *   executor?: (invocation: ReturnType<typeof buildFirstRoundInvocation>) => Promise<{
 *     exitStatus?: number | null;
 *     stdout?: string;
 *     stderr?: string;
 *     timedOut?: boolean;
 *     authMissing?: boolean | null;
 *     error?: { code?: string | null; message?: string } | null;
 *   } | {
 *     exitStatus?: number | null;
 *     stdout?: string;
 *     stderr?: string;
 *     timedOut?: boolean;
 *     authMissing?: boolean | null;
 *     error?: { code?: string | null; message?: string } | null;
 *   }>;
 * }} input Consultation inputs.
 * @returns {Promise<ReturnType<typeof buildFirstRoundSynthesisInput>>} Claude-facing synthesis inputs.
 */
export async function collectFirstRoundResponses({
  topic,
  context = {},
  runtimes = Object.keys(RUNTIME_ADAPTERS),
  env,
  probeRuntime = probeRuntimeAdapter,
  executor,
}) {
  const captures = [];

  for (const runtime of runtimes) {
    const invocation = buildFirstRoundInvocation({
      topic,
      runtime,
      context,
      env,
    });
    const probe = probeRuntime(runtime, env);
    const result =
      probe.available && typeof executor === "function"
        ? await executor(invocation)
        : undefined;

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
  const topic = process.argv.slice(2).join(" ").trim();
  if (!topic) {
    throw new Error("Usage: node first-round.mjs <topic>");
  }

  const synthesisInput = await collectFirstRoundResponses({ topic });
  process.stdout.write(`${JSON.stringify(synthesisInput, null, 2)}\n`);
}

const isEntrypoint = import.meta.url === `file://${process.argv[1]}`;

if (isEntrypoint) {
  await main();
}
