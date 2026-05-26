import { describeRuntimePlan } from "./runtime-adapters.mjs";
import { normalizeCouncilContext } from "./council-shared.mjs";

export const SECOND_ROUND_REQUIRED_SECTIONS = Object.freeze([
  "Incorrect assumptions in Claude's summary",
  "Missing native feature surfaces or constraints",
  "Runtime-specific test gaps",
  "Packaging or artifact placement risks",
  "Documentation updates Claude should add",
  "Final caveats before implementation",
]);

/**
 * Build the critique prompt for the optional second-round consultation loop.
 * @param {{
 *   topic: string;
 *   runtime: string;
 *   sanitizedSummary: string;
 *   context?: {
 *     repository?: string;
 *     sourceArtifacts?: string[];
 *     targetEnvironment?: string;
 *   };
 * }} input Prompt inputs.
 * @returns {string} Runtime-specific second-round critique prompt.
 */
export function buildSecondRoundPrompt({
  topic,
  runtime,
  sanitizedSummary,
  context = {},
}) {
  const trimmedTopic = topic?.trim();
  if (!trimmedTopic) {
    throw new Error("Second-round council prompt requires a non-empty topic.");
  }

  const trimmedSummary = sanitizedSummary?.trim();
  if (!trimmedSummary) {
    throw new Error(
      "Second-round council prompt requires a non-empty sanitized summary."
    );
  }

  const normalizedContext = normalizeCouncilContext(context);
  const artifactLines =
    normalizedContext.sourceArtifacts.length > 0
      ? normalizedContext.sourceArtifacts.map(artifact => `- ${artifact}`)
      : ["- None provided. Work only from the prompt and runtime knowledge."];

  return [
    `You are reviewing Claude's Lisa runtime-parity synthesis for the \`${normalizedContext.repository}\` repository.`,
    `Runtime under consultation: ${runtime}.`,
    "",
    "Operate in read-only advisory mode.",
    "Do not edit files, install dependencies, commit, push, open PRs, or suggest destructive commands.",
    "Treat Claude's summary as sanitized evidence; identify mistakes, omissions, and runtime-specific caveats.",
    "",
    "## Feature Topic",
    trimmedTopic,
    "",
    "## Repository Context",
    `- Repository: ${normalizedContext.repository}`,
    `- Target backend environment: ${normalizedContext.targetEnvironment}`,
    ...artifactLines,
    "",
    "## Claude's Sanitized Summary",
    trimmedSummary,
    "",
    "## Required Response Sections",
    ...SECOND_ROUND_REQUIRED_SECTIONS.map((section, index) => {
      return `${index + 1}. ${section}`;
    }),
    "",
    "Use concise bullets under each section. Call out disagreements explicitly.",
  ].join("\n");
}

/**
 * Build the runtime invocation payload for the optional second-round critique loop.
 * @param {{
 *   topic: string;
 *   runtime: string;
 *   sanitizedSummary: string;
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
export function buildSecondRoundInvocation({
  topic,
  runtime,
  sanitizedSummary,
  context = {},
  env,
}) {
  return {
    ...describeRuntimePlan(runtime, env),
    prompt: buildSecondRoundPrompt({
      topic,
      runtime,
      sanitizedSummary,
      context,
    }),
  };
}

/**
 * Build the Claude-facing second-round critique scaffold.
 * @param {{
 *   topic: string;
 *   context?: {
 *     repository?: string;
 *     sourceArtifacts?: string[];
 *     targetEnvironment?: string;
 *   };
 *   sanitizedSummary: string;
 *   runtimes: string[];
 *   env?: NodeJS.ProcessEnv;
 * }} input Second-round planning inputs.
 * @returns {{
 *   sanitizedSummary: string;
 *   requiredSections: string[];
 *   availableRuntimes: string[];
 *   critiquePrompts: Array<{
 *     runtime: string;
 *     command: string;
 *     args: string[];
 *     timeoutMs: number;
 *     prompt: string;
 *   }>;
 * }} Second-round critique scaffold.
 */
export function buildSecondRoundSynthesisInput({
  topic,
  context = {},
  sanitizedSummary,
  runtimes,
  env,
}) {
  if (!sanitizedSummary?.trim()) {
    throw new Error(
      "Second-round synthesis input requires a non-empty sanitized summary."
    );
  }

  return {
    sanitizedSummary: sanitizedSummary.trim(),
    requiredSections: [...SECOND_ROUND_REQUIRED_SECTIONS],
    availableRuntimes: [...runtimes],
    critiquePrompts: runtimes.map(runtime =>
      buildSecondRoundInvocation({
        topic,
        runtime,
        sanitizedSummary,
        context,
        env,
      })
    ),
  };
}
