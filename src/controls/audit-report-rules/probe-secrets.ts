/**
 * Rule: nothing shaped like a credential is written into a probe.
 *
 * A probe records a request that was sent with a credential and an error that
 * came back from it. That is the one place in a report where a token is
 * likely to be copied by accident: a header pasted with its value, a web
 * address with a password in it, an error that repeats the address it failed
 * on. The report refers to a secret by its name and never holds its value, so
 * the obvious shapes are refused here, where the risk is introduced:
 *
 * - a web address with a user name or password in front of the host, in any
 *   field;
 * - the value of an authorization header, in any field;
 * - a long random-looking string, in the recorded request only. An error is
 *   quoted as it was received, and errors carry request ids that look the
 *   same, so the quote is not held to this one.
 *
 * This is a cheap guard, not a secret scanner: it will miss a credential of
 * an unusual shape, and it will sometimes refuse a long identifier that is no
 * secret. The answer to both is the same, which is why the message gives it:
 * write the name the value goes by.
 *
 * A message from this rule says which probe, by its position in the list, and
 * which field. It never repeats what it found.
 * @module controls/audit-report-rules/probe-secrets
 */
import type { AuditProbe } from "../audit-probe-types.js";
import type {
  AuditReportRule,
  AuditReportViolation,
} from "../audit-report-types.js";

/** The name this rule's violations carry. */
export const PROBE_SECRETS_RULE = "probe-secrets";

/** The probe fields that hold free text, in the order they are checked. */
const TEXT_FIELDS = [
  "system",
  "request",
  "observed_error",
  "reason",
  "access_needed",
] as const;

/** The one field held to the random-looking check. */
const REQUEST_FIELD = "request";

/** What each refused shape is called in a message. */
const SHAPE = {
  address: "a web address with a user name or password in it",
  header: "the value of an authorization header",
  random: "a long random-looking string",
} as const;

/** A web address with something before an `@` in front of the host. */
const ADDRESS_WITH_USER = /\b([a-z][a-z0-9+.-]*):\/\/([^\s/?#@]+)@/giu;

/** The schemes whose addresses never need a user name. */
const WEB_SCHEMES: readonly string[] = ["http", "https"];

/** An authorization header followed by anything at all. */
const AUTHORIZATION_HEADER = /\bauthorization\b\s*[:=]\s*\S/iu;

/** A credential scheme followed by a run long enough to be a credential. */
const SCHEME_AND_VALUE = /\b(?:bearer|basic)\s+([\w+/.~=-]{16,})/giu;

/** A run of the characters a token is made of. */
const TOKEN_RUN = /[A-Za-z0-9+=]{20,}/gu;

/** The least varied a run may be, in bits per character, and still count. */
const MINIMUM_ENTROPY = 3;

/** One change of character class in this many characters marks a token. */
const CLASS_CHANGE_SPAN = 3;

/**
 * Sort a character into the class a token mixes: digit, capital, small
 * letter, or anything else.
 * @param character - One character
 * @returns The class
 */
function characterClass(character: string): string {
  if (/\d/u.test(character)) return "digit";
  if (/[A-Z]/u.test(character)) return "capital";
  return /[a-z]/u.test(character) ? "small" : "other";
}

/**
 * Measure how varied a run of characters is.
 * @param run - The run
 * @returns Its Shannon entropy, in bits per character
 */
function entropy(run: string): number {
  const characters = [...run];
  const counts = characters.reduce<Readonly<Record<string, number>>>(
    (seen, character) => ({
      ...seen,
      [character]: (seen[character] ?? 0) + 1,
    }),
    {}
  );
  return Object.values(counts).reduce((bits, count) => {
    const share = count / characters.length;
    return bits - share * Math.log2(share);
  }, 0);
}

/**
 * Tell whether a run of token characters looks random rather than written.
 *
 * A word or a name, however long, stays in one class of character for most
 * of its length. A token changes class every few characters. So a run counts
 * as random-looking when it mixes letters with digits, is varied, and changes
 * class at least once in every {@link CLASS_CHANGE_SPAN} characters.
 * @param run - A run of at least twenty token characters
 * @returns Whether it looks like a credential
 */
function looksRandom(run: string): boolean {
  const classes = [...run].map(character => characterClass(character));
  const changes = classes.filter(
    (kind, index) => index > 0 && kind !== classes[index - 1]
  ).length;
  return (
    classes.includes("digit") &&
    (classes.includes("capital") || classes.includes("small")) &&
    entropy(run) >= MINIMUM_ENTROPY &&
    changes * CLASS_CHANGE_SPAN >= run.length
  );
}

/**
 * Tell whether text holds a web address that carries a user name or password.
 *
 * An `ssh` address names a user and no secret, so one is refused only when a
 * password follows the name. A web address needs neither.
 * @param text - Text from a probe
 * @returns Whether it does
 */
function hasAddressWithCredentials(text: string): boolean {
  return [...text.matchAll(ADDRESS_WITH_USER)].some(
    ([, scheme = "", userinfo = ""]) =>
      WEB_SCHEMES.includes(scheme.toLowerCase()) || userinfo.includes(":")
  );
}

/**
 * Tell whether text holds the value of an authorization header.
 *
 * Either the header itself with anything after it, or the word that
 * introduces a credential followed by a run that mixes digits or capitals
 * into small letters. A secret's name in capitals, such as
 * `Bearer GITHUB_TOKEN`, is a name and is left alone.
 * @param text - Text from a probe
 * @returns Whether it does
 */
function hasAuthorizationValue(text: string): boolean {
  return (
    AUTHORIZATION_HEADER.test(text) ||
    [...text.matchAll(SCHEME_AND_VALUE)].some(
      ([, value = ""]) =>
        /\d/u.test(value) || (/[a-z]/u.test(value) && /.[A-Z]/u.test(value))
    )
  );
}

/**
 * Name the credential shapes one field of a probe holds.
 * @param field - The field's name
 * @param text - The field's text
 * @returns What each shape found is called, in a fixed order
 */
function shapesIn(field: string, text: string): readonly string[] {
  return [
    ...(hasAddressWithCredentials(text) ? [SHAPE.address] : []),
    ...(hasAuthorizationValue(text) ? [SHAPE.header] : []),
    ...(field === REQUEST_FIELD &&
    (text.match(TOKEN_RUN) ?? []).some(run => looksRandom(run))
      ? [SHAPE.random]
      : []),
  ];
}

/**
 * Check one probe.
 * @param probe - The probe
 * @param index - Its position in the list, from 0
 * @returns One violation per shape per field
 */
function probeViolations(
  probe: AuditProbe,
  index: number
): readonly AuditReportViolation[] {
  return TEXT_FIELDS.flatMap(field =>
    shapesIn(field, probe[field] ?? "").map(shape => ({
      rule: PROBE_SECRETS_RULE,
      message: `Probe number ${index + 1} in the list holds something shaped like a credential in its "${field}": ${shape}. Take the value out and write the name it goes by instead. The value is not repeated here.`,
    }))
  );
}

/**
 * No probe holds a web address with credentials in it, an authorization
 * value, or, in its request, a long random-looking string.
 * @param report - The report
 * @returns The violations found
 */
export const probesHoldNoCredentials: AuditReportRule = report =>
  report.probes.flatMap((probe, index) => probeViolations(probe, index));
