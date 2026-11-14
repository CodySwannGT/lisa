/**
 * Redact credential-shaped literals from classifier output
 * (CodySwannGT/lisa#4867).
 *
 * The classifier copies assertion arguments verbatim into its reports, and
 * some test fixtures are fake secrets. A fake secret committed as evidence
 * still trips secret scanners, and a real one would leak, so every string in
 * a report passes through here before it is printed.
 *
 * The placeholders follow the `[REDACTED:<KIND>]` vocabulary of
 * `plugins/src/wiki/scripts/wiki-safety.mjs`. That module's patterns are
 * anchored on a key name (`api_key = …`), so they miss a bare token such as a
 * Stripe key standing alone in a string; these patterns match token shapes.
 * @module scripts/lib/phrase-tests/redact
 */

/** @typedef {{ kind: string, re: RegExp, replace?: string }} SecretShape */

/** @type {readonly SecretShape[]} */
export const SECRET_SHAPES = Object.freeze([
  {
    kind: "PRIVATE_KEY",
    re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----(?:[\s\S]*?-----END (?:[A-Z]+ )*PRIVATE KEY-----)?/gu,
  },
  {
    kind: "URL_CREDENTIALS",
    re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/giu,
    replace: "$1[REDACTED:URL_CREDENTIALS]@",
  },
  { kind: "API_KEY", re: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/gu },
  {
    kind: "GITHUB_TOKEN",
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,})/gu,
  },
  { kind: "AWS_ACCESS_KEY", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu },
  { kind: "SLACK_TOKEN", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/gu },
  {
    kind: "JWT",
    re: /\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2}/gu,
  },
]);

/**
 * Replace every credential-shaped run in a string.
 * @param {string} text - Any string.
 * @returns {string} The string with each secret replaced by its placeholder.
 */
export function redactText(text) {
  return SECRET_SHAPES.reduce(
    (current, shape) =>
      current.replace(shape.re, shape.replace ?? `[REDACTED:${shape.kind}]`),
    text
  );
}

/**
 * Redact every string inside a JSON-shaped value, keys included.
 * @template T
 * @param {T} value - A report, or any part of one.
 * @returns {T} A copy with every string redacted.
 */
export function redactDeep(value) {
  if (typeof value === "string") return /** @type {T} */ (redactText(value));
  if (Array.isArray(value)) {
    return /** @type {T} */ (value.map(item => redactDeep(item)));
  }
  if (value !== null && typeof value === "object") {
    return /** @type {T} */ (
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          redactText(key),
          redactDeep(item),
        ])
      )
    );
  }
  return value;
}
