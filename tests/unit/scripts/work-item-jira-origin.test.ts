/** Credential-bearing Jira work-item requests must use a validated origin. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  cleanupTemplates,
  cli,
  createFixture,
  PR_URL,
} from "../../support/work-item-cli.js";

const ORIGIN = "https://jira.example";
const REFERENCE = "LAS-12";
const TOKEN = "fixture-jira-token";
const LOGIN = "fixture@example.test";
const ARGS = ["backlink", "--ref", REFERENCE, "--pr-url", PR_URL];
const CONFIG = {
  tracker: "jira",
  workItem: { verify: "trailer" },
  jira: { project: "LAS" },
};

/** Run the real CLI while capturing transport input without network access. */
function request(site?: string, cloudId?: string, server = "") {
  const fixture = createFixture({ ...CONFIG, atlassian: { site, cloudId } });
  const capture = path.join(fixture.root, "requests.jsonl");
  writeFileSync(
    path.join(fixture.root, "fake-bin", "curl"),
    [
      "#!/usr/bin/env python3",
      "import json, os, sys",
      "with open(os.environ['REQUEST_CAPTURE'], 'a') as output:",
      "    output.write(json.dumps({'args': sys.argv[1:], 'config': sys.stdin.read()}) + '\\n')",
      `print(json.dumps({'comments': [{'id': '1', 'body': '[lisa-pr-link] ${PR_URL}'}]}))`,
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
  const result = cli(fixture, ARGS, {
    ATLASSIAN_API_TOKEN: "",
    JIRA_API_TOKEN: TOKEN,
    JIRA_LOGIN: LOGIN,
    JIRA_SERVER: server,
    PATH: `${path.join(fixture.root, "fake-bin")}:/usr/bin:/bin`,
    REQUEST_CAPTURE: capture,
  });
  return {
    ...result,
    sent: existsSync(capture)
      ? readFileSync(capture, "utf8")
          .trim()
          .split("\n")
          .map(line => JSON.parse(line) as { args: string[]; config: string })
      : [],
  };
}

/** Check both the comment lookup and update at the captured transport boundary. */
function expectRequests(result: ReturnType<typeof request>, origin: string) {
  expect(result.exitCode, result.stderr).toBeUndefined();
  const comments = `${origin}/rest/api/3/issue/${REFERENCE}/comment`;
  expect(result.sent.map(sent => sent.args.at(-1))).toEqual([
    `${comments}?maxResults=100`,
    `${comments}/1`,
  ]);
  expect(result.sent.map(sent => sent.config)).toEqual([
    expect.not.stringContaining("request ="),
    expect.stringContaining('request = "PUT"'),
  ]);
  for (const sent of result.sent) {
    expect(sent.config).toContain(`user = "${LOGIN}:${TOKEN}"`);
    expect(sent.args.join(" ")).not.toContain(TOKEN);
    expect(sent.args.join(" ")).not.toContain(LOGIN);
    expect(sent.args).toEqual(expect.arrayContaining(["--config", "-"]));
  }
}

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

describe("Jira work-item origin validation", () => {
  it.each([
    "https://user:password@jira.example",
    "https://jira.example@elsewhere.example",
    "https://jira.example/path",
    "https://jira.example//",
    "https://jira.example/..",
    "https://jira.example/%2e",
    "https://jira.example?",
    "https://jira.example#",
    "http://jira.example",
    "ftp://jira.example",
    "https://jira.example:0",
    "https://jira.example:65536",
    "https://jira.example:",
    "https://jira.example:port",
    "https://jira..example",
    "https://-jira.example",
    "https://jira.example.",
    "https://jira.exämple",
    "https://jira.exa%6dple",
    "https://127.1",
    "0x7f000001",
    "https://0x7f000001",
    "https://0x7f.0.0.1",
    "https://[not-an-address]",
    "https://jira\t.example",
    ` ${ORIGIN}`,
    `${ORIGIN}\n`,
  ])("rejects %j before invoking a credential transport", site => {
    const result = request(site);
    expect(result.exitCode).toBe(1);
    expect(result.sent).toEqual([]);
    expect(result.stderr).toContain("Jira server");
    expect(result.stderr).not.toContain(TOKEN);
    expect(result.stderr).not.toContain(site);
  });

  it.each([
    [ORIGIN, ORIGIN],
    ["jira.example", ORIGIN],
    ["jira.example/", ORIGIN],
    ["HTTPS://JIRA.EXAMPLE:443/", ORIGIN],
    ["https://jira.example:8443", "https://jira.example:8443"],
    ["https://192.0.2.10", "https://192.0.2.10"],
    ["https://[2001:db8::1]", "https://[2001:db8::1]"],
  ])("sends credentials only to canonical %s", (site, expected) => {
    expectRequests(request(site), expected);
  });

  it("validates the environment fallback too", () => {
    expectRequests(request(undefined, undefined, "jira.example"), ORIGIN);
    const invalid = request(undefined, undefined, "https://jira.example/path");
    expect(invalid.exitCode).toBe(1);
    expect(invalid.sent).toEqual([]);
  });

  it("preserves configured-site precedence over the environment", () => {
    expectRequests(
      request(ORIGIN, undefined, "https://elsewhere.example"),
      ORIGIN
    );
  });

  it("keeps the cloud-ID gateway independent of a direct site URL", () => {
    expectRequests(
      request("https://invalid.example/path", "cloud-123"),
      "https://api.atlassian.com/ex/jira/cloud-123"
    );
  });
});
