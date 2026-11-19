/**
 * First-round council planning: prompts, invocations, execution policy and
 * the non-mutating dry-run plan.
 */

import { describeRuntimePlan } from "./runtime-adapters.mjs";
import {
  normalizeCouncilContext,
  resolveCouncilRuntimes,
  resolveCouncilExecutionPolicy,
} from "./council-shared.mjs";
import { buildSecondRoundInvocation } from "./second-round.mjs";

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
