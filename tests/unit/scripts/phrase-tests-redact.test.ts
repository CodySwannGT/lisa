/**
 * Credential-shaped literals never leave the classifier (CodySwannGT/lisa#4867).
 * Every fake secret below is assembled at run time, so this file carries no
 * credential-shaped literal of its own for a scanner to flag.
 * @module tests/unit/scripts/phrase-tests-redact
 */
import { describe, expect, it } from "vitest";

import {
  redactDeep,
  redactText,
} from "../../../scripts/lib/phrase-tests/redact.mjs";

const join = (...parts: string[]): string => parts.join("");
const RUN = "abcdefghij0123456789ABCDEFGHIJ";
const API_KEY_PLACEHOLDER = "[REDACTED:API_KEY]";

const SECRETS: readonly (readonly [string, string])[] = [
  [join("sk", "_test_", RUN), "API_KEY"],
  [join("pk", "_live_", RUN), "API_KEY"],
  [join("rk", "_test_", RUN), "API_KEY"],
  [join("gh", "p_", RUN), "GITHUB_TOKEN"],
  [join("gh", "s_", RUN), "GITHUB_TOKEN"],
  [join("github", "_pat_", RUN), "GITHUB_TOKEN"],
  [join("AK", "IA", "ABCDEFGHIJKLMNOP"), "AWS_ACCESS_KEY"],
  [join("xo", "xb-", "1234567890-abcdef"), "SLACK_TOKEN"],
  [
    join("ey", "JhbGciOiJIUzI1NiJ9", ".", "ey", "JzdWIiOiIxIn0", ".", "sig"),
    "JWT",
  ],
  [
    join(
      "-----BEGIN ",
      "RSA PRIVATE",
      " KEY-----\nabc\n-----END RSA PRIVATE",
      " KEY-----"
    ),
    "PRIVATE_KEY",
  ],
  [join("-----BEGIN ", "PRIVATE", " KEY-----"), "PRIVATE_KEY"],
];

describe("redactText", () => {
  it.each(SECRETS)("replaces %j with [REDACTED:%s]", (secret, kind) => {
    const redacted = redactText(`expect(x).toContain("${secret}")`);
    expect(redacted).not.toContain(secret);
    expect(redacted).toBe(`expect(x).toContain("[REDACTED:${kind}]")`);
  });

  it("keeps the scheme and host of a URL but drops its credentials", () => {
    const url = join(
      "postgres://",
      "admin",
      ":",
      "hunter2hunter2",
      "@db.internal:5432/app"
    );
    expect(redactText(url)).toBe(
      "postgres://[REDACTED:URL_CREDENTIALS]@db.internal:5432/app"
    );
  });

  it("leaves ordinary text and placeholders alone", () => {
    for (const text of [
      API_KEY_PLACEHOLDER,
      "skill_test_runner",
      "https://example.com/path",
      "## Lisa Usage",
    ]) {
      expect(redactText(text)).toBe(text);
    }
  });
});

describe("redactDeep", () => {
  it("redacts every string in a report and keeps every other field", () => {
    const secret = SECRETS[0]![0];
    const report = {
      counts: { WORDING: 1 },
      verdicts: [
        {
          cls: "WORDING",
          line: 7,
          value: secret,
          subject: `note.replace("${secret}", "")`,
          pattern: { source: secret, flags: "u" },
        },
      ],
    };
    const redacted = redactDeep(report);
    expect(JSON.stringify(redacted)).not.toContain(secret);
    expect(redacted).toEqual({
      counts: { WORDING: 1 },
      verdicts: [
        {
          cls: "WORDING",
          line: 7,
          value: API_KEY_PLACEHOLDER,
          subject: `note.replace("${API_KEY_PLACEHOLDER}", "")`,
          pattern: { source: API_KEY_PLACEHOLDER, flags: "u" },
        },
      ],
    });
  });
});
