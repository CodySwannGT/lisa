/**
 * The credential shapes the control commands look for, and what each is
 * called.
 *
 * ## One list, written twice
 *
 * The repository already ships a list of credential shapes:
 * `SECRET_SHAPES` in `scripts/lib/phrase-tests/redact.mjs`. Private-key
 * blocks use the shared boundary reader in both redactors. It cannot be
 * imported here. This module is compiled from `src/` into `dist/`, a script
 * outside `src/` is not part of that build, and loading it at run time would
 * be an asynchronous import where every caller (a report rule, a register
 * rule, the evidence writer) is synchronous. So {@link CREDENTIAL_SHAPES}
 * restates that list, entry for entry, and
 * `tests/unit/controls/secret-shapes-parity.test.ts` holds the two equal: a
 * shape added to, changed in or removed from either one alone fails it.
 *
 * Change the two together, or not at all.
 *
 * ## Every shape is linear
 *
 * A check's whole output is scanned before any of it is kept, and a check
 * can print a megabyte with no blank in it. So no shape may take time that
 * grows faster than the text: each repeated part is either bounded or cannot
 * be started again inside itself. `tests/unit/controls/
 * secret-scan-time.test.ts` holds every shape to that on a megabyte.
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
 * `SECRET_SHAPES` in `scripts/lib/phrase-tests/redact.mjs`. Private-key
 * blocks use the shared boundary reader in both redactors.
 */
export const CREDENTIAL_SHAPES: readonly CredentialShape[] = Object.freeze([
  {
    kind: URL_CREDENTIALS_KIND,
    // The scheme is at most 64 characters. Without a bound, every word in a
    // long run of letters, digits, dots and signs is tried as the start of a
    // scheme and read to the end of the run, so the time grows with the
    // square of the run's length: a megabyte of `a.a.a.` took about a
    // hundred seconds. No scheme in use is that long.
    //
    // A scheme may start at any letter, not only at the start of a word.
    // Held to the start of a word, an address glued to 60 or more letters,
    // digits or underscores (a digest printed straight before it) was never
    // tried from a place near enough to reach its `://`, and its password
    // stayed. From any letter, the last 64 characters before `://` are
    // always tried, and each try reads at most 64 characters.
    re: /([a-z][a-z0-9+.-]{0,63}:\/\/)[^\s/:@]+:[^\s/@]+@/giu,
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
 * The last line of a private key.
 *
 * The shared boundary reader finds a key by the line that starts it. Output a
 * program printed can reach the scan with that line already gone, because
 * only the end of a long output is kept, and then the key's body and its
 * last line are all that is left. The scan finds those by this line; see
 * `./secret-scan.ts`.
 *
 * Text beginning part-way through a key is a captured-output case, covered
 * here in addition to complete blocks.
 */
export const PRIVATE_KEY_LAST_LINE = /-----END (?:[A-Z]+ )*PRIVATE KEY-----/gu;

/** A placeholder, wherever one stands in a piece of text. */
const PLACEHOLDER = /\[REDACTED:([A-Z_]+)\]/gu;

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

/**
 * Say what the placeholders in a piece of text stand for.
 *
 * Text that has already had its values taken out no longer shows a scan
 * what was there. Its placeholders still do.
 * @param text - Text a value may already have been taken out of
 * @returns Each kind a placeholder names, once, in the order found; only
 *   kinds a scan can report
 */
export function placeholderKinds(text: string): readonly string[] {
  return [
    ...new Set(
      [...text.matchAll(PLACEHOLDER)].flatMap(match => {
        const kind = match[1];
        return kind !== undefined && CREDENTIAL_KIND_NAMES[kind] !== undefined
          ? [kind]
          : [];
      })
    ),
  ];
}
