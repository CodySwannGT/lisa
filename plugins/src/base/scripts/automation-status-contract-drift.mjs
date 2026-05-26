#!/usr/bin/env node
/**
 * Shared automation-status contract drift helpers.
 *
 * Runtime adapters resolve the expected Lisa automation fleet, list the live
 * scheduler entries, then use this module to find the best observed match for
 * each expected automation and classify any contract drift.
 */

const DRIFT_LABELS = {
  name: "name",
  cadence: "cadence",
  command: "command",
  queue_arguments: "queue arguments",
};

/**
 * @typedef {{
 *   readonly automationId: string
 *   readonly expectedCadence?: string
 *   readonly expectedRRule?: string
 *   readonly expectedCommand: string
 * }} ExpectedAutomationContract
 *
 * @typedef {{
 *   readonly automationId: string
 *   readonly observedCadence?: string
 *   readonly observedRRule?: string
 *   readonly observedCommand?: string
 * }} ObservedAutomationContract
 *
 * @typedef {{
 *   readonly status: "HEALTHY" | "MISSING" | "DRIFTED"
 *   readonly summary: string
 *   readonly observed: string
 *   readonly remediation?: string
 *   readonly driftKinds: readonly ("name" | "cadence" | "command" | "queue_arguments")[]
 *   readonly observedAutomation: ObservedAutomationContract | null
 * }} AutomationContractComparison
 */

/**
 * Find the best observed scheduler entry for an expected automation contract.
 *
 * Match order is:
 * 1. Exact automation id
 * 2. Exact command shape and cadence
 * 3. Exact command shape
 * 4. Same command entrypoint
 *
 * @param {ExpectedAutomationContract} expected
 * @param {readonly ObservedAutomationContract[]} observedAutomations
 * @returns {ObservedAutomationContract | null}
 */
export function findObservedAutomationMatch(
  expected,
  observedAutomations = []
) {
  const exactId = observedAutomations.find(
    observed => observed.automationId === expected.automationId
  );
  if (exactId) {
    return exactId;
  }

  const expectedCommand = normalizeAutomationCommand(expected.expectedCommand);
  const expectedCadence = normalizeCadenceSignature({
    cadence: expected.expectedCadence,
    rrule: expected.expectedRRule,
  });

  const exactContract = observedAutomations.find(observed => {
    const observedCommand = normalizeAutomationCommand(
      observed.observedCommand
    );
    const observedCadence = normalizeCadenceSignature({
      cadence: observed.observedCadence,
      rrule: observed.observedRRule,
    });

    return (
      observedCommand.commandSignature === expectedCommand.commandSignature &&
      observedCadence === expectedCadence
    );
  });
  if (exactContract) {
    return exactContract;
  }

  const exactCommand = observedAutomations.find(observed => {
    const observedCommand = normalizeAutomationCommand(
      observed.observedCommand
    );
    return (
      observedCommand.commandSignature === expectedCommand.commandSignature
    );
  });
  if (exactCommand) {
    return exactCommand;
  }

  return (
    observedAutomations.find(observed => {
      const observedCommand = normalizeAutomationCommand(
        observed.observedCommand
      );
      return observedCommand.commandToken === expectedCommand.commandToken;
    }) ?? null
  );
}

/**
 * Compare one expected automation contract against an observed scheduler entry.
 *
 * @param {{
 *   readonly expected: ExpectedAutomationContract
 *   readonly observedAutomations?: readonly ObservedAutomationContract[]
 *   readonly observedAutomation?: ObservedAutomationContract | null
 * }} input
 * @returns {AutomationContractComparison}
 */
export function compareAutomationContract(input) {
  const expected = input.expected;
  const observed =
    input.observedAutomation ??
    findObservedAutomationMatch(expected, input.observedAutomations ?? []);

  if (!observed) {
    return {
      status: "MISSING",
      summary: "expected automation is missing",
      observed: "No live automation matched the expected Lisa contract.",
      remediation:
        "Re-run `/lisa:setup-automations` or recreate the missing scheduler entry.",
      driftKinds: [],
      observedAutomation: null,
    };
  }

  const driftKinds = detectDriftKinds(expected, observed);
  const observedSummary = describeObservedAutomation(observed);

  if (driftKinds.length === 0) {
    return {
      status: "HEALTHY",
      summary: "expected automation exists and matches the contract",
      observed: observedSummary,
      driftKinds,
      observedAutomation: observed,
    };
  }

  return {
    status: "DRIFTED",
    summary: formatDriftSummary(driftKinds),
    observed: observedSummary,
    remediation:
      "Re-run `/lisa:setup-automations` or update the scheduler entry to the expected command and cadence.",
    driftKinds,
    observedAutomation: observed,
  };
}

/**
 * @param {ExpectedAutomationContract} expected
 * @param {ObservedAutomationContract} observed
 * @returns {readonly ("name" | "cadence" | "command" | "queue_arguments")[]}
 */
function detectDriftKinds(expected, observed) {
  const driftKinds = [];

  if (observed.automationId !== expected.automationId) {
    driftKinds.push("name");
  }

  const expectedCadence = normalizeCadenceSignature({
    cadence: expected.expectedCadence,
    rrule: expected.expectedRRule,
  });
  const observedCadence = normalizeCadenceSignature({
    cadence: observed.observedCadence,
    rrule: observed.observedRRule,
  });

  if (expectedCadence !== observedCadence) {
    driftKinds.push("cadence");
  }

  const expectedCommand = normalizeAutomationCommand(expected.expectedCommand);
  const observedCommand = normalizeAutomationCommand(observed.observedCommand);

  if (expectedCommand.commandToken !== observedCommand.commandToken) {
    driftKinds.push("command");
  }

  if (expectedCommand.queueSignature !== observedCommand.queueSignature) {
    driftKinds.push("queue_arguments");
  }

  return driftKinds;
}

/**
 * @param {ObservedAutomationContract} observed
 * @returns {string}
 */
function describeObservedAutomation(observed) {
  const name = observed.automationId || "unnamed automation";
  const cadence =
    observed.observedCadence ?? observed.observedRRule ?? "cadence unavailable";
  const command = observed.observedCommand ?? "command unavailable";
  return `${name} runs ${cadence} -> ${command}`;
}

/**
 * @param {readonly ("name" | "cadence" | "command" | "queue_arguments")[]} driftKinds
 * @returns {string}
 */
function formatDriftKinds(driftKinds) {
  const labels = driftKinds.map(kind => DRIFT_LABELS[kind]);
  if (labels.length === 0) {
    return "contract details";
  }
  if (labels.length === 1) {
    return labels[0];
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

/**
 * @param {readonly ("name" | "cadence" | "command" | "queue_arguments")[]} driftKinds
 * @returns {string}
 */
function formatDriftSummary(driftKinds) {
  const subject = formatDriftKinds(driftKinds);
  return driftKinds.length === 1
    ? `${subject} no longer matches setup`
    : `${subject} no longer match setup`;
}

/**
 * @param {string | undefined} command
 * @returns {{ readonly commandToken: string, readonly commandSignature: string, readonly queueSignature: string }}
 */
function normalizeAutomationCommand(command) {
  const tokens = tokenizeCommand(command);
  const [commandToken = "", ...queueTokens] = tokens;

  return {
    commandToken,
    commandSignature: serializeCommandTokens(tokens),
    queueSignature: serializeQueueTokens(queueTokens),
  };
}

/**
 * @param {{ readonly cadence?: string, readonly rrule?: string }} input
 * @returns {string}
 */
function normalizeCadenceSignature(input) {
  if (typeof input.rrule === "string" && input.rrule.trim().length > 0) {
    return input.rrule.trim().toUpperCase();
  }

  if (typeof input.cadence === "string" && input.cadence.trim().length > 0) {
    return input.cadence.trim().toLowerCase().replace(/\s+/g, " ");
  }

  return "";
}

/**
 * @param {readonly string[]} tokens
 * @returns {string}
 */
function serializeCommandTokens(tokens) {
  return tokens.join("\u0000");
}

/**
 * Positional queue args stay ordered, while key=value arguments are sorted by
 * key so semantically-equivalent scheduler strings do not false-positive.
 *
 * @param {readonly string[]} queueTokens
 * @returns {string}
 */
function serializeQueueTokens(queueTokens) {
  const positional = [];
  const keyed = [];

  for (const token of queueTokens) {
    if (token.includes("=")) {
      const [key, ...valueParts] = token.split("=");
      keyed.push(`${key}=${valueParts.join("=")}`);
      continue;
    }
    positional.push(token);
  }

  keyed.sort((left, right) => left.localeCompare(right));
  return [...positional, ...keyed].join("\u0000");
}

/**
 * Tokenize simple scheduler commands while preserving quoted values.
 *
 * @param {string | undefined} command
 * @returns {readonly string[]}
 */
function tokenizeCommand(command) {
  if (typeof command !== "string" || command.trim().length === 0) {
    return [];
  }

  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let match = pattern.exec(command);

  while (match) {
    tokens.push(match[1] ?? match[2] ?? match[0]);
    match = pattern.exec(command);
  }

  return tokens;
}
