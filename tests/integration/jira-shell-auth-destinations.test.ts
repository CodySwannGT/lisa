/** Jira shell helpers validate destinations before constructing credentials. */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import {
  BASH,
  SYSTEM_PATH,
  writeStub,
} from "./support/shell-guard-refusal-fixture.js";

const DOWNLOAD =
  "plugins/src/base/skills/lisa-jira-read-ticket/scripts/download-attachment.sh";
const SOURCES = [
  DOWNLOAD,
  "plugins/src/base/skills/lisa-jira-evidence/scripts/post-evidence.sh",
  "plugins/src/expo/skills/jira-evidence/scripts/post-evidence.sh",
  "plugins/src/rails/skills/jira-evidence/scripts/post-evidence.sh",
];
const ORIGIN = "https://jira.invalid";
const INSECURE_ORIGIN = ORIGIN.replace("https:", "http:");
const AUTH_CONSTRUCTED = "AUTH_CONSTRUCTED";
const BASIC_AUTH = "Authorization: Basic ";
const AUTH_HEADER = "Authorization:";
const INVALID_SERVERS = [
  INSECURE_ORIGIN,
  "https://operator@jira.invalid",
  "https://jira.invalid@other.invalid",
  "https://jira.invalid/base",
  "https://jira.invalid?",
  "https://jira.invalid#",
  "https://jira.invalid:0",
  "https://jira.invalid:65536",
  "https://jira.invalid trailing",
  "https://jira..invalid",
  "https://jira.invalid.",
];
const roots: string[] = [];
const CURL_STUB = `printf 'REQUEST\\n' >> "$LISA_AUTH_TRACE"
printf '%s\\n' "$@" >> "$LISA_AUTH_TRACE"
if [ "$LISA_AUTH_MODE" = redirect ]; then
  while [ "$#" -gt 0 ]; do
    if [ "$1" = -D ]; then
      printf 'Location: https://media.invalid/signed?token=fixture\\r\\n' > "$2"
      printf '302'
      exit 0
    fi
    shift
  done
elif [ "$LISA_AUTH_MODE" = download ]; then
  printf '200'
else
  printf '{}\\nHTTP_CODE:201'
fi
`;

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * Prepare isolated service stubs that record requests and credential encoding.
 * @param server - Configured origin under test; never contacted over the network.
 * @returns Isolated paths for the real helper and request recorder.
 */
function prepareFixture(server: string) {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-jira-auth-"));
  const bin = path.join(root, "bin");
  const evidence = path.join(root, "evidence");
  const config = path.join(root, ".lisa", "jira-cli");
  const trace = path.join(root, "auth.log");
  roots.push(root);
  mkdirSync(config, { recursive: true });
  mkdirSync(evidence);
  writeFileSync(trace, "");
  writeFileSync(
    path.join(config, ".config.yml"),
    `server: ${server}\nlogin: operator@jira.invalid\n`
  );
  for (const name of [
    "01-log.txt",
    "02-shot.png",
    "comment.md",
    "comment.txt",
  ]) {
    writeFileSync(path.join(evidence, name), "fixture evidence\n");
  }
  writeStub(
    bin,
    "base64",
    'printf "AUTH_CONSTRUCTED\\n" >> "$LISA_AUTH_TRACE"\n/usr/bin/base64\n'
  );
  writeStub(bin, "curl", CURL_STUB);
  writeStub(
    bin,
    "gh",
    'case "$1" in repo) printf "fixture/repo\\n" ;; pr) printf "body\\n" ;; esac\nexit 0\n'
  );
  writeStub(bin, "jira", "exit 0\n");
  return { root, bin, evidence, trace };
}

/**
 * Run a real helper with every service intercepted and auth encoding recorded.
 * @param script - Canonical helper path relative to this checkout.
 * @param server - Origin supplied by environment or configuration.
 * @param attachment - Numeric identifier or URL supplied to the download helper.
 * @param options - Configuration and response controls.
 * @param options.configOnly - Omit environment overrides to exercise config fallback.
 * @param options.redirect - Simulate a signed external attachment redirect.
 * @returns Process result with all observed credential and request events.
 */
function runHelper(
  script: string,
  server: string,
  attachment = "12345",
  options: { configOnly?: boolean; redirect?: boolean } = {}
) {
  const { root, bin, evidence, trace } = prepareFixture(server);
  const download = script === DOWNLOAD;
  const args = download
    ? [attachment, path.join(root, "attachment")]
    : ["TEST-1", evidence, "42"];
  const result = boundedSpawnSync({
    label: "Jira helper with recorded authorization",
    command: BASH,
    args: [path.resolve(script), ...args],
    cwd: root,
    env: {
      HOME: root,
      CLAUDE_PROJECT_DIR: root,
      PATH: `${bin}:${SYSTEM_PATH}`,
      ...(options.configOnly
        ? {}
        : { JIRA_SERVER: server, JIRA_LOGIN: "operator@jira.invalid" }),
      JIRA_API_TOKEN: "fixture-token",
      LISA_AUTH_TRACE: trace,
      LISA_AUTH_MODE: options.redirect
        ? "redirect"
        : download
          ? "download"
          : "evidence",
    },
  });
  return { ...result, trace: readFileSync(trace, "utf8") };
}

describe.each(SOURCES)("Jira credential destination: %s", script => {
  it.each(INVALID_SERVERS)(
    "rejects %s before constructing authorization",
    server => {
      const result = runHelper(script, server);

      expect(result.status).not.toBe(0);
      expect(result.trace).not.toContain(AUTH_CONSTRUCTED);
      expect(result.trace).not.toContain(AUTH_HEADER);
    }
  );

  it.each([ORIGIN, "HTTPS://JIRA.INVALID:443/", "https://jira.invalid:8443/"])(
    "uses a canonical request origin for %s",
    server => {
      const result = runHelper(script, server);
      const origin = server.includes("8443")
        ? "https://jira.invalid:8443"
        : ORIGIN;

      expect(result.status, result.stderr).toBe(0);
      expect(result.trace).toContain(AUTH_CONSTRUCTED);
      expect(result.trace).toContain(BASIC_AUTH);
      expect(result.trace).toContain(`${origin}/rest/api/`);
      expect(result.trace).not.toContain(`${origin}//rest/`);
    }
  );
});

describe("attachment URL credentials", () => {
  it.each([
    `${INSECURE_ORIGIN}/rest/api/3/attachment/content/123`,
    "https://other.invalid/rest/api/3/attachment/content/123",
    "https://operator@jira.invalid/rest/api/3/attachment/content/123",
    "https://jira.invalid:8443/rest/api/3/attachment/content/123",
    "https://jira.invalid/rest/api/3/attachment/content/123#fragment",
  ])("rejects %s before constructing authorization", url => {
    const result = runHelper(DOWNLOAD, ORIGIN, url);

    expect(result.status).not.toBe(0);
    expect(result.trace).not.toContain(AUTH_CONSTRUCTED);
    expect(result.trace).not.toContain(AUTH_HEADER);
  });

  it("allows a same-origin attachment URL", () => {
    const url = `${ORIGIN}/rest/api/3/attachment/content/123?redirect=false`;
    const result = runHelper(DOWNLOAD, ORIGIN, url);

    expect(result.status, result.stderr).toBe(0);
    expect(result.trace).toContain(BASIC_AUTH);
    expect(result.trace).toContain(url);
  });

  it.each(INVALID_SERVERS)(
    "rejects invalid config fallback %s before constructing authorization",
    server => {
      const result = runHelper(DOWNLOAD, server, "12345", { configOnly: true });

      expect(result.status).not.toBe(0);
      expect(result.trace).not.toContain(AUTH_CONSTRUCTED);
      expect(result.trace).not.toContain(AUTH_HEADER);
    }
  );

  it("uses a valid configuration fallback without environment overrides", () => {
    const result = runHelper(DOWNLOAD, "HTTPS://JIRA.INVALID:443/", "12345", {
      configOnly: true,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.trace).toContain(BASIC_AUTH);
    expect(result.trace).toContain(`${ORIGIN}/rest/api/`);
  });

  it("sends no Basic credentials on the signed HTTPS redirect", () => {
    const result = runHelper(DOWNLOAD, ORIGIN, "12345", { redirect: true });
    const [, firstRequest, signedRequest] = result.trace.split("REQUEST\n");

    expect(result.status, result.stderr).toBe(0);
    expect(firstRequest).toContain(BASIC_AUTH);
    expect(firstRequest).toContain(`${ORIGIN}/rest/api/`);
    expect(signedRequest).not.toContain(AUTH_HEADER);
    expect(signedRequest).toContain("--proto\n=https\n");
    expect(signedRequest).toContain(
      "--url\nhttps://media.invalid/signed?token=fixture"
    );
  });
});
