/**
 * The credential shapes the control commands look for, and what each is
 * called.
 *
 * ## One list, written twice
 *
 * The repository already ships a list of credential shapes:
 * `SECRET_SHAPES` in `scripts/lib/phrase-tests/redact.mjs`. It cannot be
 * imported here. This module is compiled from `src/` into `dist/`, a script
 * outside `src/` is not part of that build, and loading it at run time would
 * be an asynchronous import where every caller (a report rule, a register
 * rule, the evidence writer) is synchronous. So {@link CREDENTIAL_SHAPES}
 * restates that list, entry for entry, and
 * `tests/unit/controls/secret-shapes-parity.test.ts` holds the two equal: a
 * shape added to, changed in or removed from either one alone fails it.
 *
 * Change the two together, or not at all.
 * @module controls/secret-shapes
 */

/** One credential shape: what it is called and what finds it. */
export interface CredentialShape {
  /** The word a placeholder carries, for example `GITHUB_TOKEN`. */
  readonly kind: string;
  /** Finds every run of that shape. Always global. */
  readonly re: RegExp;
  /**
   * What a run is replaced with, when part of it is kept. `$1` stands for
   * the first group. Left out, the whole run becomes the placeholder.
   */
  readonly replace?: string;
}

/** The kind of a web address that carries a user name or a password. */
export const URL_CREDENTIALS_KIND = "URL_CREDENTIALS";

/** The kind of a private key. */
export const PRIVATE_KEY_KIND = "PRIVATE_KEY";

/** The kind of the value of an authorization header. */
export const AUTHORIZATION_KIND = "AUTHORIZATION";

/** The kind of a random-looking value beside a name such as `token`. */
export const NAMED_SECRET_KIND = "SECRET";

/**
 * Every provider-specific shape, in the order they are applied. Equal to
 * `SECRET_SHAPES` in `scripts/lib/phrase-tests/redact.mjs`.
 */
export const CREDENTIAL_SHAPES: readonly CredentialShape[] = Object.freeze([
  {
    kind: PRIVATE_KEY_KIND,
    re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----(?:[\s\S]*?-----END (?:[A-Z]+ )*PRIVATE KEY-----)?/gu,
  },
  {
    kind: URL_CREDENTIALS_KIND,
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
  { kind: "OAUTH_TOKEN", re: /\bya29\.[\w.-]{10,}/gu },
  { kind: "GOOGLE_API_KEY", re: /\bAIza[\w-]{20,}/gu },
  { kind: "GITLAB_TOKEN", re: /\bglpat-[\w-]{16,}/gu },
  { kind: "NPM_TOKEN", re: /\bnpm_[A-Za-z0-9]{10,}/gu },
  { kind: "SHOPIFY_TOKEN", re: /\bshpat_[A-Za-z0-9]{16,}/gu },
  { kind: "SENDGRID_KEY", re: /\bSG\.[\w-]{10,}(?:\.[\w-]+)?/gu },
  { kind: "HUGGINGFACE_TOKEN", re: /\bhf_[A-Za-z0-9]{20,}/gu },
  { kind: "API_KEY", re: /\bsk-(?:ant|proj)-[\w-]{10,}/gu },
  { kind: "DIGITALOCEAN_TOKEN", re: /\bdop_v1_[A-Za-z0-9]{16,}/gu },
  { kind: "PYPI_TOKEN", re: /\bpypi-[\w-]{16,}/gu },
]);

/**
 * What each kind is called in a sentence an operator reads. Every kind a
 * scan can report is here; a suite fails when one is missing.
 */
export const CREDENTIAL_KIND_NAMES: Readonly<Record<string, string>> = {
  [PRIVATE_KEY_KIND]: "a private key",
  [URL_CREDENTIALS_KIND]: "a web address with a user name or password in it",
  [AUTHORIZATION_KIND]: "the value of an authorization header",
  [NAMED_SECRET_KIND]:
    "a long random-looking value beside a name such as token, secret or password",
  API_KEY: "an API key",
  GITHUB_TOKEN: "a GitHub token",
  AWS_ACCESS_KEY: "an AWS access key",
  SLACK_TOKEN: "a Slack token",
  JWT: "a signed web token",
  OAUTH_TOKEN: "an OAuth access token",
  GOOGLE_API_KEY: "a Google API key",
  GITLAB_TOKEN: "a GitLab token",
  NPM_TOKEN: "an npm token",
  SHOPIFY_TOKEN: "a Shopify token",
  SENDGRID_KEY: "a SendGrid key",
  HUGGINGFACE_TOKEN: "a Hugging Face token",
  DIGITALOCEAN_TOKEN: "a DigitalOcean token",
  PYPI_TOKEN: "a PyPI token",
};

/**
 * Say what a kind is, in words.
 * @param kind - The kind a scan reported
 * @returns For example `a GitHub token`
 */
export function describeCredentialKind(kind: string): string {
  return CREDENTIAL_KIND_NAMES[kind] ?? "a credential";
}

/**
 * The text that stands in for a value that was taken out.
 * @param kind - What the value was shaped like
 * @returns For example `[REDACTED:GITHUB_TOKEN]`
 */
export function credentialPlaceholder(kind: string): string {
  return `[REDACTED:${kind}]`;
}
