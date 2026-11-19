import { councilEnvironment } from "./council-environment.mjs";
import { resolveCouncilRuntimes } from "./council-shared.mjs";
import { buildSecondRoundSynthesisInput } from "./second-round.mjs";
import { parseCouncilCliArgs } from "./first-round-cli.mjs";
import {
  buildCouncilDryRunPlan,
  resolveCouncilFirstRoundExecutionPolicy,
} from "./first-round-plan.mjs";
import { collectFirstRoundResponses } from "./first-round-collect.mjs";

export { resolveCouncilRuntimes, buildSecondRoundSynthesisInput };
export {
  annotateRiskyCouncilText,
  normalizeCouncilOutput,
  parseCouncilOutput,
  redactSensitiveCouncilText,
  sanitizeCouncilData,
  sanitizeCouncilText,
} from "./first-round-sanitize.mjs";
export { parseCouncilCliArgs } from "./first-round-cli.mjs";
export {
  assertInvocationMatchesCouncilPolicy,
  buildCouncilDryRunPlan,
  buildFirstRoundInvocation,
  buildFirstRoundPrompt,
  FIRST_ROUND_REQUIRED_SECTIONS,
  resolveCouncilFirstRoundExecutionPolicy,
} from "./first-round-plan.mjs";
export {
  buildFirstRoundSynthesisInput,
  collectFirstRoundResponses,
  normalizeFirstRoundCapture,
} from "./first-round-collect.mjs";

/**
 * CLI entrypoint for printing first-round council synthesis inputs.
 */
async function main() {
  const parsed = parseCouncilCliArgs(process.argv.slice(2));
  const executionPolicy = resolveCouncilFirstRoundExecutionPolicy({
    writeMode: parsed.writeMode,
    runtime: parsed.runtime,
    env: councilEnvironment(),
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
