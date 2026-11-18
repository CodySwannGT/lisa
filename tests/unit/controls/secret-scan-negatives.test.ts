/**
 * What the credential scan must leave alone.
 *
 * A refusal stops the operator, so a string that is not a secret must never
 * be taken for one. The register, the evidence and the verdict are full of
 * long random-looking strings that are nothing of the kind: commit hashes,
 * digests, identifiers, file paths. Each case here is one of them
 * (CodySwannGT/lisa#4999).
 */
import { describe, expect, it } from "vitest";

import { evidenceRecordId } from "../../../src/controls/evidence-types.js";
import { findingRecordId } from "../../../src/controls/evidence-types.js";
import {
  redactJsonCredentials,
  scanJsonForCredentials,
} from "../../../src/controls/secret-scan-json.js";
import {
  credentialKinds,
  redactCredentials,
} from "../../../src/controls/secret-scan.js";
import { fakeCredential } from "../../helpers/audit-probes.js";
import { fakeHex } from "../../helpers/fake-credentials.js";

const COMMIT = fakeHex();
const SHA256 = fakeHex(9, 64);
const UUID = [8, 4, 4, 4, 12]
  .map((length, index) => fakeHex(index + 3, length))
  .join("-");
/** The start of an encoded image, made from bytes when the test runs. */
const IMAGE = `data:image/png;base64,${Buffer.from(
  Array.from({ length: 180 }, (_unused, index) => (index * 37 + 11) % 256)
).toString("base64")}`;

const HARMLESS: readonly (readonly [string, string])[] = [
  ["a commit hash", COMMIT],
  ["a commit hash in a sentence", `Checked at commit ${COMMIT}.`],
  ["a SHA-256 digest", SHA256],
  ["a digest with its algorithm", `sha256:${SHA256}`],
  ["a UUID", UUID],
  ["a UUID beside the word id", `request id: ${UUID}`],
  [
    "a long file path",
    "services/api-gateway/src/handlers/v2/requiredStatusChecksPolicyVersion2.ts",
  ],
  ["a path into a home folder", "the key is at ~/.ssh/id_ed25519.pub"],
  ["an encoded image", IMAGE],
  [
    "an evidence record id",
    evidenceRecordId({
      entry_id: "code-style@api",
      moment: "commit",
      rung: "exercised",
      half: "violation",
      criterion: "SI7",
    }),
  ],
  ["an audit finding's record id", findingRecordId("AC1.7", ".")],
  ["a control gap marker", `[lisa-control-gap] key=${fakeHex(4, 12)}`],
  ["the name of a secret", "the token named SENTRY_AUTH_TOKEN"],
  ["a secret's name after Bearer", "Authorization: Bearer GITHUB_TOKEN"],
  ["a pipeline secret reference", "token: ${{ secrets.DEPLOY_TOKEN }}"],
  ["an environment reference", "--token $DEPLOY_TOKEN"],
  ["a placeholder", "https://example.invalid/api?token=<token>"],
  ["an ssh address", "ssh://git@example.invalid/example/widgets.git"],
  ["the short ssh form", "git@example.invalid:example/widgets.git"],
  ["an email address", "ask platform@example.invalid"],
  ["a scoped package address", "https://registry.example.invalid/@scope/pkg"],
  ["a package index by name", "uv publish --index pypi-internal-mirror-01"],
  ["a gate named after a package index", "x-pypi-publish-attestation-check"],
  ["a project key by name", "sk-proj-my-project-name"],
  ["an npm setting", "npm_config_registry"],
  ["a version beside the word token", "tokens-version: 2024.11.17-build.4821"],
  ["a file beside the word token", "token_file=config/secrets/tokenStore.json"],
  ["a sentence about signing in", "Basic authentication is not supported."],
  ["a sentence about a password", "The password: it is kept in the vault."],
  ["a long word with a number in it", "requiredStatusChecksPolicyVersion2Now"],
  [
    "a random-looking request id",
    `HTTP 500 (request ${fakeCredential(32, 5)})`,
  ],
  ["an integrity value", `sha512-${fakeCredential(86, 3)}==`],
];

describe("text that is not a secret", () => {
  it.each(HARMLESS)("is left alone: %s", (_name, text) => {
    expect(credentialKinds(text)).toEqual([]);
    expect(redactCredentials(text)).toEqual({ text, kinds: [] });
  });
});

describe("a document that holds no secret", () => {
  const DOCUMENT = {
    digest: {
      algorithm: "sha256",
      evidence: SHA256,
      register: SHA256,
      value: SHA256,
    },
    records: [
      {
        id: "code-style@api/commit/violation/SI7",
        commit: COMMIT,
        command: ["ruff", "check", ".", "--config", "ruff.toml"],
        detail: "The check turned this change away.",
        output_excerpt: `Found 1 error.\n${IMAGE}\n`,
      },
    ],
    parameters: {
      "minimum-coverage": { value: 80, direction: "floor" },
      "tokens-version": { value: "2024.11.17-build.4821" },
      "token-budget": { value: 4096 },
      "lockfile-digest": { value: SHA256 },
    },
    request: UUID,
  };

  it("has no findings", () => {
    expect(scanJsonForCredentials(DOCUMENT)).toEqual([]);
  });

  it("comes back equal to itself when values are taken out", () => {
    expect(redactJsonCredentials(DOCUMENT)).toEqual(DOCUMENT);
  });
});
