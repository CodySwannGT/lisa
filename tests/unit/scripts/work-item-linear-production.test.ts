/** Linear completion must use the configured production merge destination. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  cleanupTemplates,
  cli,
  createFixture,
  PR_URL,
} from "../../support/work-item-cli.js";

const COMPLETE = ["complete", "--ref", "LIN-12", "--pr-url", PR_URL];
const PRODUCTION_BRANCH = "release/production";
const CONFIG = {
  tracker: "linear",
  repo: "code",
  linear: { workspace: "acme", teamKey: "LIN" },
};
const DONE = { id: "done", name: "Done", type: "completed" };
const STARTED = { id: "started", name: "In Progress", type: "started" };

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/** Stage the existing lookup, mutation, and readback transport protocol. */
function staged(
  base: string | undefined,
  config: object = CONFIG,
  done = false
) {
  const fixture = createFixture(config);
  const count = path.join(fixture.root, "curl-count");
  const issue = {
    id: "linear-12",
    identifier: "LIN-12",
    team: { key: "LIN", states: { nodes: [STARTED, DONE] } },
    state: done ? DONE : STARTED,
    comments: { nodes: [{ body: `[lisa-pr-link] ${PR_URL}` }] },
    attachments: { nodes: [] },
  };
  const result = cli(fixture, COMPLETE, {
    LINEAR_API_KEY: "fixture-token",
    FAKE_GH_PR_JSON: JSON.stringify({
      baseRefName: base,
      mergedAt: "2026-08-26T00:00:00Z",
      number: 7,
      state: "MERGED",
      url: PR_URL,
    }),
    FAKE_CURL_COUNT_FILE: count,
    FAKE_CURL_JSON_1: JSON.stringify({ data: { issue } }),
    FAKE_CURL_JSON_2: JSON.stringify({
      data: { issueUpdate: { success: true } },
    }),
    FAKE_CURL_JSON_3: JSON.stringify({
      data: { issue: { ...issue, state: DONE } },
    }),
  });
  return { count, result };
}

describe("Linear completion merge destination", () => {
  it.each(["main", "staging", "feature/work", "", undefined])(
    "refuses non-production or unreadable base %s before any Linear request",
    base => {
      const { count, result } = staged(base, {
        ...CONFIG,
        deploy: {
          branches: { production: PRODUCTION_BRANCH, staging: "staging" },
        },
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(PRODUCTION_BRANCH);
      expect(result.stdout).not.toContain("work-item completed");
      expect(existsSync(count)).toBe(false);
    }
  );

  it.each([
    { base: "main", config: CONFIG },
    {
      base: "trunk",
      config: {
        ...CONFIG,
        policy: { repository: { default_branch: "trunk" } },
      },
    },
    {
      base: PRODUCTION_BRANCH,
      config: {
        ...CONFIG,
        deploy: { branches: { production: PRODUCTION_BRANCH } },
      },
    },
  ])(
    "completes production on $base while retaining default Done",
    ({ base, config }) => {
      const { count, result } = staged(base, config);
      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).toContain("work-item completed: LIN-12 -> Done");
      expect(readFileSync(count, "utf8").trim()).toBe("3");
    }
  );

  it("keeps an already-completed production item idempotent", () => {
    const { count, result } = staged("main", CONFIG, true);
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("work-item completed: LIN-12 -> Done");
    expect(readFileSync(count, "utf8").trim()).toBe("1");
  });
});
