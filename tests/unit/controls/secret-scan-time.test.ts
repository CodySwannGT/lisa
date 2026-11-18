/**
 * The credential scan takes time in proportion to the text it is given.
 *
 * A check's whole output goes through the scan before the end of it is kept
 * (`src/controls/proof-half-run.ts`), and a check can print anything. A
 * megabyte of output that holds no credential at all must not hold a run up:
 * with a shape whose cost grows with the square of the length, 100 KB of
 * `a.a.a.…` took over a second and a megabyte about a hundred.
 *
 * Each case is a megabyte with no blank in it, built from a piece that looks
 * like the start of something a shape finds and never completes it. The
 * limit is far above what a linear scan takes on a busy machine and far
 * below what a quadratic one does.
 *
 * Nothing shaped like a credential is written here: a key's first and last
 * line, and an address that carries a password, are assembled when the test
 * runs.
 */
import { describe, expect, it } from "vitest";

import { redactCredentials } from "../../../src/controls/secret-scan.js";
import { CREDENTIAL_SHAPES } from "../../../src/controls/secret-shapes.js";
import { fakeCredential } from "../../helpers/audit-probes.js";

/** One megabyte, in characters. */
const MEGABYTE = 1024 * 1024;

/** The most a scan of one megabyte may take, in milliseconds. */
const LIMIT_MS = 5000;

/** The five hyphens either side of a key's first and last line. */
const DASHES = "-".repeat(5);

/** The words on both of those lines, joined when the test runs. */
const KEY_WORDS = ["PRIVATE", "KEY"].join(" ");

/** The first line of a made-up private key. */
const FIRST_LINE = `${DASHES}BEGIN ${KEY_WORDS}${DASHES}`;

/** The last line of a made-up private key. */
const LAST_LINE = `${DASHES}END ${KEY_WORDS}${DASHES}`;

/** A made-up password, assembled when the test runs. */
const PASSWORD = fakeCredential(24, 5);

/**
 * A web address that carries the made-up password.
 * @param scheme - The address's scheme
 * @returns The address
 */
function withPassword(scheme: string): string {
  return [scheme, ":", "//deploy:", PASSWORD, "@host.invalid/x.git"].join("");
}

/**
 * Repeat a piece of text until it is one megabyte long.
 * @param piece - The piece
 * @returns Exactly one megabyte of it
 */
function megabyteOf(piece: string): string {
  return piece.repeat(Math.ceil(MEGABYTE / piece.length)).slice(0, MEGABYTE);
}

/**
 * Time one call.
 * @param work - The call
 * @returns How long it took, in milliseconds
 */
function millisecondsOf(work: () => unknown): number {
  const before = performance.now();
  work();
  return performance.now() - before;
}

/**
 * The two body lines of a made-up private key.
 * @param seed - Which made-up key
 * @returns The lines
 */
function bodyOf(seed: number): string {
  return [fakeCredential(64, seed), fakeCredential(64, seed + 2)].join("\n");
}

/** A name for each megabyte, and the piece it is made of. */
const PIECES: readonly (readonly [string, string])[] = [
  ["letters joined by dots", "a."],
  ["letters joined by plus and minus signs", "a+a-"],
  ["a dotted name that looks like a version", "release-1.2.3+build."],
  ["the start of a signed web token, over and over", "eyJ."],
  ["a header name written with hyphens", "x-api-key"],
  ["names that say secret, joined by dots", "token.secret.key."],
  ["the start of a web address, never finished", "a://a:"],
  ["a scheme with no address", "a://"],
  ["the first line of a private key, over and over", FIRST_LINE],
  ["the first line of a private key on lines of its own", `${FIRST_LINE}\n`],
  ["the last line of a private key, over and over", LAST_LINE],
  ["the start of a block's first line, over and over", `${DASHES}BEGIN A `],
  ["a name and an equals sign", "token="],
  ["a JSON key that says secret", '"secret":"'],
  ["one letter", "a"],
  ["hyphens", "-"],
];

describe("the credential scan on a megabyte with no blank in it", () => {
  it.each(PIECES)("finishes in time on %s", (_name, piece) => {
    const text = megabyteOf(piece);

    expect(text).toHaveLength(MEGABYTE);
    expect(millisecondsOf(() => redactCredentials(text))).toBeLessThan(
      LIMIT_MS
    );
  });

  it.each(CREDENTIAL_SHAPES.map(shape => [shape.kind, shape] as const))(
    "the %s shape alone finishes in time on letters joined by dots",
    (_kind, shape) => {
      const text = megabyteOf("a.");

      expect(millisecondsOf(() => text.replace(shape.re, ""))).toBeLessThan(
        LIMIT_MS
      );
    }
  );
});

describe("a password in a web address, with the scheme's length bounded", () => {
  it("is taken out of an address at the end of a megabyte of dotted names", () => {
    const { text } = redactCredentials(
      `${megabyteOf("a.")} ${withPassword("https")}`
    );

    expect(
      text.endsWith(" https://[REDACTED:URL_CREDENTIALS]@host.invalid/x.git")
    ).toBe(true);
  });

  it("is taken out when the scheme has dots and signs in it", () => {
    const scheme = "git+ssh.v2-internal";

    expect(redactCredentials(`fetch ${withPassword(scheme)}`).text).toBe(
      `fetch ${scheme}://[REDACTED:URL_CREDENTIALS]@host.invalid/x.git`
    );
  });

  it("is taken out when a megabyte of dotted names runs straight into the scheme", () => {
    const { text, kinds } = redactCredentials(
      `${megabyteOf("a.")}${withPassword("https")}`
    );

    expect(kinds).toContain("URL_CREDENTIALS");
    expect(
      text.endsWith("://[REDACTED:URL_CREDENTIALS]@host.invalid/x.git")
    ).toBe(true);
    expect(text).not.toContain(PASSWORD);
  });

  it("is taken out after a scheme longer than any in use", () => {
    const scheme = `${"x".repeat(70)}-plus.https`;
    const { text } = redactCredentials(`fetch ${withPassword(scheme)}`);

    expect(text).not.toContain(PASSWORD);
    expect(text).toContain("[REDACTED:URL_CREDENTIALS]");
  });
});

describe("a private key in text that holds more than one first line", () => {
  it("is taken out whole, from its first line to its last", () => {
    const key = [FIRST_LINE, bodyOf(7), LAST_LINE].join("\n");

    expect(redactCredentials(`before\n${key}\nafter`).text).toBe(
      "before\n[REDACTED:PRIVATE_KEY]\nafter"
    );
  });

  it("leaves nothing of two keys printed one after the other", () => {
    const first = [FIRST_LINE, bodyOf(7), LAST_LINE].join("\n");
    const second = [FIRST_LINE, bodyOf(11), LAST_LINE].join("\n");

    expect(redactCredentials(`${first}\nbetween\n${second}`).text).toBe(
      "[REDACTED:PRIVATE_KEY]\nbetween\n[REDACTED:PRIVATE_KEY]"
    );
  });

  it("leaves nothing of a key that has no last line before the next key begins", () => {
    const cut = [FIRST_LINE, bodyOf(7)].join("\n");
    const whole = [FIRST_LINE, bodyOf(11), LAST_LINE].join("\n");
    const { text } = redactCredentials(`${cut}\n${whole}\nafter`);

    expect(text).not.toContain(fakeCredential(64, 7));
    expect(text).not.toContain(fakeCredential(64, 9));
    expect(text).not.toContain(fakeCredential(64, 11));
    expect(text.endsWith("\nafter")).toBe(true);
  });

  it("is still taken out when a megabyte of first lines comes before it", () => {
    const key = [FIRST_LINE, bodyOf(7), LAST_LINE].join("\n");
    const { text } = redactCredentials(`${megabyteOf(FIRST_LINE)}\n${key}`);

    expect(text).not.toContain(fakeCredential(64, 7));
    expect(text).not.toContain(KEY_WORDS);
  });
});
