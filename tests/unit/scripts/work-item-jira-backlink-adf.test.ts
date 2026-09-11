/** Jira backlinks recognize visible ADF text without treating metadata as prose. */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  cleanupTemplates,
  cli,
  createFixture,
  PR_URL,
} from "../../support/work-item-cli.js";

const REFERENCE = "LAS-12";
const MANAGED_TEXT = `[lisa-pr-link] ${PR_URL}`;
const CONFIG = {
  tracker: "jira",
  workItem: { verify: "trailer" },
  jira: { project: "LAS" },
  atlassian: { site: "https://example.atlassian.net" },
};

/** ADF shape emitted by the Jira writer, including structural string fields. */
function document(text: string) {
  return {
    content: [{ content: [{ text, type: "text" }], type: "paragraph" }],
    type: "doc",
    version: 1,
  };
}

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

describe("Jira managed backlink ADF identity", () => {
  it("recognizes its existing document on repeated runs without another write", () => {
    const fixture = createFixture(CONFIG);
    const count = path.join(fixture.root, "curl-count");
    const env = {
      JIRA_API_TOKEN: "fixture-token",
      JIRA_LOGIN: "test@example.test",
      FAKE_CURL_COUNT_FILE: count,
      FAKE_CURL_JSON: JSON.stringify({
        comments: [{ id: "11", body: document(MANAGED_TEXT) }],
      }),
    };
    const args = ["backlink", "--ref", REFERENCE, "--pr-url", PR_URL];
    const first = cli(fixture, args, env);
    expect(first.exitCode, first.stderr).toBeUndefined();
    expect(first.stdout).toContain("backlink unchanged");
    expect(cli(fixture, args, env).stdout).toContain("backlink unchanged");
    expect(readFileSync(count, "utf8").trim()).toBe("2");
  });

  it.each([
    document(`${MANAGED_TEXT} keep this human note`),
    { ...document("human note"), attrs: { href: MANAGED_TEXT } },
  ])("leaves human prose and metadata-only links unclaimed", body => {
    const fixture = createFixture(CONFIG);
    const result = cli(
      fixture,
      ["backlink", "--ref", REFERENCE, "--pr-url", PR_URL],
      {
        JIRA_API_TOKEN: "fixture-token",
        JIRA_LOGIN: "test@example.test",
        FAKE_CURL_JSON: JSON.stringify({ comments: [{ id: "11", body }] }),
      }
    );
    expect(result.exitCode, result.stderr).toBeUndefined();
    expect(result.stdout).toContain("backlink created");
  });
});
