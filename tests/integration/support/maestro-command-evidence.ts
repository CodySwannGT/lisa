/** Current-attempt command evidence, shaped like Maestro's serialized wrappers. */
export type CommandEvidence =
  | "executed"
  | "pending"
  | "skipped"
  | "configuration"
  | "variables"
  | "empty"
  | "no-command"
  | "unknown-command"
  | "malformed"
  | "missing-timestamp"
  | "invalid-timestamp"
  | "zero-timestamp"
  | "none";

const commands: Partial<Record<CommandEvidence, object>> = {
  configuration: {
    applyConfigurationCommand: { config: { appId: "test.fixture" } },
  },
  variables: { defineVariablesCommand: { env: { FIXTURE: "true" } } },
  "unknown-command": { madeUpFixtureCommand: {} },
  "no-command": {},
};
const statuses: Partial<Record<CommandEvidence, string>> = {
  pending: "PENDING",
  skipped: "SKIPPED",
};
/**
 * Timestamp variants test positive, finite execution evidence.
 * @returns Timestamp metadata, or an absent timestamp.
 * @param evidence - Command evidence variant to serialize.
 */
function timestamp(evidence: CommandEvidence) {
  if (evidence === "missing-timestamp") return {};
  if (evidence === "invalid-timestamp") return { timestamp: "Infinity" };
  return { timestamp: evidence === "zero-timestamp" ? 0 : Date.now() };
}
/**
 * Serialize realistic Maestro command wrappers, including inconclusive forms.
 * @returns JSON artifact bytes.
 * @param evidence - Command evidence variant to serialize.
 */
export function commandEvidence(evidence: CommandEvidence): string {
  if (evidence === "malformed") return "[broken json";
  if (evidence === "empty" || evidence === "none") return "[]";
  const command = commands[evidence] ?? {
    assertConditionCommand: {
      condition: { visible: { textRegex: "Expected" } },
    },
  };
  return JSON.stringify([
    {
      command,
      metadata: {
        status: statuses[evidence] ?? "FAILED",
        ...timestamp(evidence),
        duration: 10,
        error: { message: "Assertion is false" },
      },
    },
  ]);
}
