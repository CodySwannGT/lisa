/**
 * A secret written in base64, or as a UUID, beside the name that says it is
 * one.
 *
 * Base64 uses `/` and `+`, and many secrets are written in it: a cloud
 * provider's secret access key, a storage account's key. A value like that
 * has to be taken out whole, wherever the `/` falls, and a file path beside
 * the same kind of name has to be left alone.
 *
 * Every credential-shaped value in this suite is made up when the test runs.
 * None is written in this file.
 */
import { describe, expect, it } from "vitest";

import {
  credentialKinds,
  namesSecret,
  redactCredentials,
} from "../../../src/controls/secret-scan.js";
import { fakeCredential } from "../../helpers/audit-probes.js";
import { fakeHex } from "../../helpers/fake-credentials.js";

const SECRET = "SECRET";
const NAMED = "[REDACTED:SECRET]";
const SLASH = "/";

/** Base64 whose `/` comes six characters in, and no piece is 16 long. */
const SLASH_EARLY = [
  fakeCredential(6, 3),
  fakeCredential(12, 5),
  fakeCredential(14, 7),
].join(SLASH);

/** Base64 whose first `/` comes after twenty characters. */
const SLASH_LATE = [fakeCredential(20, 9), fakeCredential(19, 13)].join(SLASH);

/** Base64 as a storage account writes its key: `+`, `/` and padding. */
const PADDED = `${fakeCredential(40, 15)}+${fakeCredential(22, 17)}${SLASH}${fakeCredential(23, 19)}==`;

/** A made-up UUID, the form an older registry token takes. */
const UUID = [8, 4, 4, 4, 12]
  .map((length, index) => fakeHex(index + 3, length))
  .join("-");

/** The name a cloud provider's tools print beside the secret half of a key. */
const KEY_NAME = ["Secret", "Access", "Key"].join("");

describe("a base64 secret beside a name that says it is one", () => {
  it.each([
    ["a slash in its first sixteen characters", SLASH_EARLY],
    ["a slash later in the value", SLASH_LATE],
    ["a plus sign, a slash and padding", PADDED],
  ])("is taken out whole when it has %s", (_name, value) => {
    const redacted = redactCredentials(`aws_secret_access_key = ${value}`);

    expect(redacted.kinds).toEqual([SECRET]);
    expect(redacted.text).toBe(`aws_secret_access_key = ${NAMED}`);
  });

  it.each([
    ["a slash in its first sixteen characters", SLASH_EARLY],
    ["a slash later in the value", SLASH_LATE],
  ])("is taken out whole from JSON when it has %s", (_name, value) => {
    const redacted = redactCredentials(`{"${KEY_NAME}":"${value}"}`);

    expect(redacted.kinds).toEqual([SECRET]);
    expect(redacted.text).toBe(`{"${KEY_NAME}":"${NAMED}"}`);
  });

  it("is taken out after a flag that names a secret", () => {
    expect(redactCredentials(`deploy --secret-key ${SLASH_EARLY}`).text).toBe(
      `deploy --secret-key ${NAMED}`
    );
  });

  it("is found when the name it sits under says it is a secret", () => {
    expect(credentialKinds(SLASH_EARLY, { name: KEY_NAME })).toEqual([SECRET]);
    expect(redactCredentials(PADDED, { name: "account_key" }).text).toBe(NAMED);
  });

  it("leaves nothing of the value behind, whichever piece is looked for", () => {
    const text = redactCredentials(
      `export SECRET_ACCESS_KEY=${SLASH_EARLY}\nexport OTHER_SECRET="${SLASH_LATE}"`
    ).text;

    expect(
      [...SLASH_EARLY.split(SLASH), ...SLASH_LATE.split(SLASH)].filter(piece =>
        text.includes(piece)
      )
    ).toEqual([]);
  });
});

describe("a storage account's key and a registry's token", () => {
  it("counts the account key of a connection string", () => {
    const redacted = redactCredentials(
      `DefaultEndpointsProtocol=https;AccountName=example;AccountKey=${PADDED};EndpointSuffix=example.invalid`
    );

    expect(redacted.kinds).toEqual([SECRET]);
    expect(redacted.text).toBe(
      `DefaultEndpointsProtocol=https;AccountName=example;AccountKey=${NAMED};EndpointSuffix=example.invalid`
    );
  });

  it.each(["AccountKey", "account_key", "account-key", "_authToken"])(
    "takes %s for a name that says its value is a secret",
    name => {
      expect(namesSecret(name)).toBe(true);
    }
  );

  it("counts a UUID that a registry setting gives as its token", () => {
    const redacted = redactCredentials(
      `//registry.example.invalid/:_authToken=${UUID}`
    );

    expect(redacted.kinds).toEqual([SECRET]);
    expect(redacted.text).toBe(
      `//registry.example.invalid/:_authToken=${NAMED}`
    );
  });

  it("counts a UUID under a key that says it is a secret", () => {
    expect(credentialKinds(UUID, { name: "client_secret" })).toEqual([SECRET]);
  });
});

describe("a path or an id beside a name that says secret", () => {
  it.each([
    ["a mounted secret file", "SECRET_KEY_FILE=/run/secrets/app2/key"],
    [
      "a service account's token path",
      "token_path: /var/run/secrets/tokens/service-account",
    ],
    ["a password file", "password_file=/etc/app/conf.d/db/passwords.txt"],
    [
      "a credentials file in a build folder",
      "credentials_file=/home/runner/work/app1/app1/creds.json",
    ],
    [
      "a dated release folder",
      "token_cache=/opt/app/releases/20240115093000/cache",
    ],
    ["a token endpoint", "token_url: https://example.invalid/oauth2/v2/token"],
    ["a UUID with no such name", `request id: ${UUID}`],
    ["a UUID named as an id", `trace=${UUID}`],
  ])("is left alone: %s", (_name, text) => {
    expect(redactCredentials(text)).toEqual({ text, kinds: [] });
  });
});
