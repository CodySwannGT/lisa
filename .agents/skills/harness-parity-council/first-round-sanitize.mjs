/**
 * Output hygiene for the harness parity council: normalize, redact, annotate
 * and parse what a consulted runtime printed before Claude synthesizes it.
 */
import { stripVTControlCharacters } from "node:util";

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

/**
 * Convert arbitrary CLI output into a stable text form for council synthesis.
 *
 * @param {string} value Raw CLI output.
 * @returns {string} Normalized text capture.
 */
export function normalizeCouncilOutput(value) {
  // Terminal colour and style sequences carry no content for synthesis.
  return stripVTControlCharacters(`${value ?? ""}`)
    .replaceAll("\r\n", "\n")
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
