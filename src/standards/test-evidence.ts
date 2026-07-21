/** Positive, private-output evidence that a managed test runner executed tests. */

export const TEST_EVIDENCE_FORMATS = [
  "vitest",
  "jest",
  "playwright",
  "rspec",
  "managed",
] as const;
/** Runner grammar used to prove that at least one test executed. */
export type TestEvidenceFormat = (typeof TEST_EVIDENCE_FORMATS)[number];

const MAX_EVIDENCE_OUTPUT_CHARACTERS = 1024 * 1024;
const MAX_EVIDENCE_LINES = 4096;
const MAX_EVIDENCE_LINE_CHARACTERS = 4096;

/**
 * Require affirmative runner output for at least one executed test. A clean
 * exit, an empty stream, or an all-skipped summary is never sufficient.
 * @param format - Runner-specific or managed-union evidence grammar
 * @param output - Bounded private stdout/stderr captured by the explicit CLI
 * @returns Whether at least one test was positively reported as executed
 */
export function hasPositiveTestEvidence(
  format: TestEvidenceFormat,
  output: string
): boolean {
  const lines = boundedTokenLines(output);
  const runnerEvidence = lines.some(tokens => {
    if (format === "vitest" || format === "jest") {
      return isTestsSummary(tokens);
    }
    if (format === "playwright") return isLeadingStatusSummary(tokens);
    if (format === "rspec") return isExamplesSummary(tokens);
    return (
      isTestsSummary(tokens) ||
      isLeadingStatusSummary(tokens) ||
      isExamplesSummary(tokens) ||
      isManagedTestSummary(tokens)
    );
  });
  return runnerEvidence || (format === "managed" && isTapSummary(lines));
}

/**
 * Split bounded output into bounded, punctuation-neutral token lines.
 * @param output - Private runner output
 * @returns Bounded token lines
 */
function boundedTokenLines(output: string): readonly (readonly string[])[] {
  return output
    .slice(0, MAX_EVIDENCE_OUTPUT_CHARACTERS)
    .split("\n", MAX_EVIDENCE_LINES)
    .map(line => tokenizeLine(line.slice(0, MAX_EVIDENCE_LINE_CHARACTERS)));
}

/**
 * Convert one bounded ASCII runner line to lowercase alphanumeric tokens.
 * @param line - One bounded runner line
 * @returns Lowercase alphanumeric tokens
 */
function tokenizeLine(line: string): readonly string[] {
  return Array.from(line, character =>
    isAsciiAlphanumeric(character) ? character.toLowerCase() : " "
  )
    .join("")
    .split(" ")
    .filter(Boolean);
}

/**
 * Return whether one character is an ASCII letter or digit.
 * @param character - Single input character
 * @returns Whether the character is token-safe
 */
function isAsciiAlphanumeric(character: string): boolean {
  const code = character.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

/**
 * Return whether a token is a nonzero base-10 integer.
 * @param token - Candidate numeric token
 * @returns Whether the token is positive
 */
function isPositiveInteger(token: string | undefined): boolean {
  const value = nonnegativeIntegerValue(token);
  return value !== undefined && value > 0;
}

/**
 * Parse one bounded decimal token without accepting signs or fractions.
 * @param token - Candidate count token
 * @returns Safe nonnegative integer, when valid
 */
function nonnegativeIntegerValue(
  token: string | undefined
): number | undefined {
  if (token === undefined || token.length === 0) return undefined;
  const digitsOnly = Array.from(token).every(character => {
    const code = character.charCodeAt(0);
    return code >= 48 && code <= 57;
  });
  if (!digitsOnly) return undefined;
  const value = Number(token);
  return Number.isSafeInteger(value) ? value : undefined;
}

/**
 * Recognize Vitest/Jest `Tests: N passed|failed` summary fragments.
 * @param tokens - One bounded token line
 * @returns Whether the line proves test execution
 */
function isTestsSummary(tokens: readonly string[]): boolean {
  if (tokens[0] !== "tests") return false;
  return tokens.some(
    (token, index) => isOutcome(token) && isPositiveInteger(tokens[index - 1])
  );
}

/**
 * Recognize Playwright `N passed|failed` summary lines.
 * @param tokens - One bounded token line
 * @returns Whether the line proves test execution
 */
function isLeadingStatusSummary(tokens: readonly string[]): boolean {
  return isPositiveInteger(tokens[0]) && isOutcome(tokens[1]);
}

/**
 * Recognize RSpec `N examples` summary fragments.
 * @param tokens - One bounded token line
 * @returns Whether the line proves example execution
 */
function isExamplesSummary(tokens: readonly string[]): boolean {
  const examples = countBeforeLabel(tokens, ["example", "examples"]);
  const failures = countBeforeLabel(tokens, ["failure", "failures"]) ?? 0;
  const pending = countBeforeLabel(tokens, ["pending"]) ?? 0;
  return (
    examples !== undefined &&
    examples > 0 &&
    (failures > 0 || examples > pending)
  );
}

/**
 * Read the count immediately before a known summary label.
 * @param tokens - One bounded token line
 * @param labels - Accepted singular/plural labels
 * @returns Parsed count, when present
 */
function countBeforeLabel(
  tokens: readonly string[],
  labels: readonly string[]
): number | undefined {
  const index = tokens.findIndex(token => labels.includes(token));
  return index < 1 ? undefined : nonnegativeIntegerValue(tokens[index - 1]);
}

/**
 * Correlate bounded TAP aggregate lines and reject explicitly all-skipped runs.
 * @param lines - Bounded token lines
 * @returns Whether TAP proves at least one actual execution
 */
function isTapSummary(lines: readonly (readonly string[])[]): boolean {
  const tests = tapAggregate(lines, ["tests"]);
  if (tests === undefined || tests === 0) return false;
  const passed = tapAggregate(lines, ["pass", "passed"]);
  const failed = tapAggregate(lines, ["fail", "failed"]);
  const executed = (passed ?? 0) + (failed ?? 0);
  return executed > 0 && executed <= tests;
}

/**
 * Read one exact two-token TAP aggregate line.
 * @param lines - Bounded token lines
 * @param labels - Accepted aggregate labels
 * @returns Parsed aggregate count, when present
 */
function tapAggregate(
  lines: readonly (readonly string[])[],
  labels: readonly string[]
): number | undefined {
  const line = lines.find(
    tokens => tokens.length === 2 && labels.includes(tokens[0] ?? "")
  );
  return line === undefined ? undefined : nonnegativeIntegerValue(line[1]);
}

/**
 * Recognize generic managed-runner `N test(s) passed|failed` summaries.
 * @param tokens - One bounded token line
 * @returns Whether the line proves test execution
 */
function isManagedTestSummary(tokens: readonly string[]): boolean {
  return (
    isPositiveInteger(tokens[0]) &&
    (tokens[1] === "test" || tokens[1] === "tests") &&
    isOutcome(tokens[2])
  );
}

/**
 * Return whether a summary token represents an executed test outcome.
 * @param token - Candidate outcome token
 * @returns Whether it is a pass/fail outcome
 */
function isOutcome(token: string | undefined): boolean {
  return token === "passed" || token === "failed";
}

/**
 * Select the narrowest known parser from a managed package script.
 * @param script - Package-script text read from the confined manifest
 * @returns Positive-evidence grammar for its runner
 */
export function inferTestEvidenceFormat(script: string): TestEvidenceFormat {
  const normalized = script.toLowerCase();
  if (normalized.includes("vitest")) return "vitest";
  if (normalized.includes("playwright")) return "playwright";
  if (normalized.includes("jest")) return "jest";
  if (normalized.includes("rspec")) return "rspec";
  return "managed";
}
