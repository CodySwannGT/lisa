/**
 * What counts as a credential-shaped value in a piece of text, and what is
 * left in its place.
 *
 * Every credential-shaped value in this suite is made up when the test runs.
 * None is written in this file (CodySwannGT/lisa#4999).
 */
import { describe, expect, it } from "vitest";

import {
  credentialKinds,
  itemContext,
  namesSecret,
  redactArguments,
  redactCredentials,
} from "../../../src/controls/secret-scan.js";
import { fakeCredential } from "../../helpers/audit-probes.js";
import {
  FAKE_CREDENTIALS,
  fakeGithubToken,
  fakeHex,
} from "../../helpers/fake-credentials.js";

const RANDOM = fakeCredential();
const HOST = "example.invalid";
const SECRET = "SECRET";
const AUTHORIZATION = "AUTHORIZATION";
const NAMED = "[REDACTED:SECRET]";
const TOKEN_FLAG = "--token";
const PASSWORD_FLAG = "--password";

describe("a value only a credential is shaped like", () => {
  it.each(FAKE_CREDENTIALS.map(fake => [fake.label, fake] as const))(
    "is found for %s, wherever it stands",
    (_label, fake) => {
      const value = fake.make();

      expect(credentialKinds(value)).toEqual([fake.kind]);
      expect(credentialKinds(`ran with ${value} and stopped`)).toEqual([
        fake.kind,
      ]);
    }
  );

  it.each(FAKE_CREDENTIALS.map(fake => [fake.label, fake] as const))(
    "is taken out for %s, leaving a placeholder that says what was there",
    (_label, fake) => {
      const value = fake.make();
      const redacted = redactCredentials(`before ${value} after`);

      expect(redacted.kinds).toEqual([fake.kind]);
      expect(redacted.text).toContain(`[REDACTED:${fake.kind}]`);
      expect(redacted.text).toContain("before ");
      expect(redacted.text).toContain(" after");
      expect(redacted.text).not.toContain(value);
    }
  );

  it("is found once per kind however many times it appears", () => {
    const token = fakeGithubToken();

    expect(credentialKinds(`${token} then ${token}`)).toEqual(["GITHUB_TOKEN"]);
  });

  it("keeps the host of a web address and takes out only what is before it", () => {
    const address = `https://deploy:${RANDOM}@${HOST}/example/widgets.git`;

    expect(redactCredentials(`git clone ${address}`).text).toBe(
      `git clone https://[REDACTED:URL_CREDENTIALS]@${HOST}/example/widgets.git`
    );
  });

  it("finds a token used as the user name of a web address", () => {
    expect(credentialKinds(`https://${RANDOM}@${HOST}/x.git`)).toEqual([
      "URL_CREDENTIALS",
    ]);
  });
});

describe("a long random-looking value", () => {
  it.each([
    ["an equals sign", (value: string) => `API_TOKEN=${value}`],
    ["a colon", (value: string) => `password: ${value}`],
    ["JSON", (value: string) => `{"client_secret": "${value}"}`],
    ["a query string", (value: string) => `GET /v1/items?api_key=${value}`],
    ["a flag and a space", (value: string) => `deploy --token ${value}`],
    [
      "a flag and an equals sign",
      (value: string) => `deploy --api-key=${value}`,
    ],
    ["an access key", (value: string) => `access_key = "${value}"`],
    ["a passphrase", (value: string) => `PASSPHRASE='${value}'`],
  ])(
    "is found beside a name that says it is a secret, written with %s",
    (_name, write) => {
      const redacted = redactCredentials(write(RANDOM));

      expect(redacted.kinds).toEqual([SECRET]);
      expect(redacted.text).toBe(write(NAMED));
    }
  );

  it.each([
    ["a header as curl takes it", `-H "Authorization: Bearer ${RANDOM}"`],
    ["a header in lower case", `authorization: token ${RANDOM}`],
    ["a header written with an equals sign", `Authorization=${RANDOM}`],
    ["a bearer token with no header name", `sent with Bearer ${RANDOM}`],
    ["a basic credential with no header name", `sent with Basic ${RANDOM}`],
  ])("is found as an authorization value in %s", (_name, text) => {
    const redacted = redactCredentials(text);

    expect(redacted.kinds).toEqual([AUTHORIZATION]);
    expect(redacted.text).not.toContain(RANDOM);
    expect(redacted.text).toContain("[REDACTED:AUTHORIZATION]");
  });

  it("is found when the name it sits under says it is a secret", () => {
    expect(credentialKinds(RANDOM, { name: "api_token" })).toEqual([SECRET]);
    expect(redactCredentials(RANDOM, { name: "api_token" }).text).toBe(NAMED);
    expect(credentialKinds(RANDOM, { name: "Authorization" })).toEqual([
      AUTHORIZATION,
    ]);
  });

  it("is found in lower-case hexadecimal too, beside such a name", () => {
    expect(credentialKinds(`token=${fakeHex()}`)).toEqual([SECRET]);
  });

  it("is left alone with no such name beside it", () => {
    expect(credentialKinds(RANDOM)).toEqual([]);
    expect(credentialKinds(`request ${RANDOM} failed`)).toEqual([]);
    expect(credentialKinds(RANDOM, { name: "detail" })).toEqual([]);
    expect(credentialKinds(`id=${RANDOM}`)).toEqual([]);
    expect(credentialKinds(`key=${RANDOM}`)).toEqual([]);
  });
});

describe("the names that say a value is a secret", () => {
  it.each([
    "token",
    "API_TOKEN",
    "client_secret",
    "password",
    "passwd",
    "passphrase",
    "credential",
    "Authorization",
    "api_key",
    "api-key",
    "apikey",
    "access_key",
    "private-key",
    "--token",
  ])("include %s", name => {
    expect(namesSecret(name)).toBe(true);
  });

  it.each(["key", "id", "value", "digest", "commit", "command", "detail"])(
    "do not include %s",
    name => {
      expect(namesSecret(name)).toBe(false);
    }
  );
});

describe("the arguments a command was started with", () => {
  it("lose the value that follows a flag naming a secret", () => {
    const redacted = redactArguments([
      "deploy",
      "--token",
      RANDOM,
      "--dry-run",
    ]);

    expect(redacted.argv).toEqual(["deploy", TOKEN_FLAG, NAMED, "--dry-run"]);
    expect(redacted.kinds).toEqual([SECRET]);
  });

  it("lose a header value and a credential-shaped argument", () => {
    const token = fakeGithubToken();
    const redacted = redactArguments([
      "curl",
      "-H",
      `Authorization: Bearer ${RANDOM}`,
      `https://${HOST}/?t=${token}`,
    ]);

    expect(redacted.argv).toEqual([
      "curl",
      "-H",
      "Authorization: Bearer [REDACTED:AUTHORIZATION]",
      `https://${HOST}/?t=[REDACTED:GITHUB_TOKEN]`,
    ]);
    expect(redacted.kinds).toEqual([AUTHORIZATION, "GITHUB_TOKEN"]);
  });

  it("stay as they are when they name things without showing them", () => {
    const argv = ["ruff", "check", ".", "--config", "ruff.toml", RANDOM];

    expect(redactArguments(argv)).toEqual({ argv, kinds: [] });
  });

  it("give an item the name of the list when no flag is in front of it", () => {
    expect(itemContext(["a", "b"], 1, "tokens")).toEqual({ name: "tokens" });
    expect(itemContext([PASSWORD_FLAG, "b"], 1, "tokens")).toEqual({
      name: PASSWORD_FLAG,
    });
    expect(itemContext(["a", "b"], 1)).toEqual({});
    expect(itemContext([PASSWORD_FLAG], 0)).toEqual({});
  });
});

describe("taking values out", () => {
  const SEEDED = [
    ...FAKE_CREDENTIALS.map(fake => `before ${fake.make()} after`),
    `API_TOKEN=${RANDOM}`,
    `deploy --token ${RANDOM}`,
    `Authorization: Bearer ${RANDOM}`,
    `https://${RANDOM}@${HOST}/x.git`,
    `one ${fakeGithubToken()} two password=${RANDOM} three`,
  ];

  it.each(SEEDED.map((text, index) => [index + 1, text] as const))(
    "finds nothing in its own output and leaves it unchanged (sample %i)",
    (_index, text) => {
      const once = redactCredentials(text);
      const twice = redactCredentials(once.text);

      expect(once.kinds.length).toBeGreaterThan(0);
      expect(twice).toEqual({ text: once.text, kinds: [] });
    }
  );

  it("returns clean text exactly as it was given", () => {
    const text = "Found 1 error.\nsrc/app.py:3:1: E501 line too long\n";

    expect(redactCredentials(text)).toEqual({ text, kinds: [] });
  });

  it("keeps the sentence around a value and its closing full stop", () => {
    expect(
      redactCredentials(`It read token=${RANDOM}. Then it stopped.`).text
    ).toBe(`It read token=${NAMED}. Then it stopped.`);
  });
});
