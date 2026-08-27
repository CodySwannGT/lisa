/**
 * Tracker resolution and config precedence, driven in-process.
 *
 * See `tests/support/work-item-cli.ts` for why these run in-process alongside —
 * never instead of — the subprocess suites.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  cleanupTemplates,
  cli,
  commit,
  createFixture,
  githubConfig,
  PR_URL,
} from "../../support/work-item-cli.js";

const VERIFY_LEVEL = "verify-level";
const LINK = "link";
const TRAILER = "trailer";
const REPO = "widgets";
const LOCAL_CONFIG = ".lisa.config.local.json";
const LINEAR_TOKEN = "linear-token";

/** A Jira project whose lifecycle roles are all defaults. */
const JIRA = {
  jira: { project: "LAS" },
  repo: REPO,
  tracker: "jira",
  workItem: { verify: TRAILER },
};

/** A Linear team whose lifecycle roles are all defaults. */
const LINEAR = {
  linear: { teamKey: "LIN", workspace: "acme" },
  repo: "code",
  tracker: "linear",
  workItem: { verify: TRAILER },
};

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

describe("in-process CLI: which tracker", () => {
  it("refuses a tracker nobody implements", () => {
    const fixture = createFixture({ repo: REPO, tracker: "bugzilla" });
    const result = cli(fixture, [VERIFY_LEVEL]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Unknown tracker 'bugzilla'. Expected github, jira, or linear"
    );
  });

  it("refuses a config naming no tracker at all", () => {
    const fixture = createFixture({ repo: REPO });
    const result = cli(fixture, [VERIFY_LEVEL]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Tracker configuration is missing tracker");
  });

  it("refuses a GitHub config with no org", () => {
    const fixture = createFixture({
      github: { repo: REPO },
      tracker: "github",
    });
    const result = cli(fixture, [VERIFY_LEVEL]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("missing github.org");
  });
});

describe("in-process CLI: Jira and Linear references", () => {
  it("canonicalizes a lower-case Jira key", () => {
    const fixture = createFixture(JIRA);
    expect(cli(fixture, [LINK, "las-12"]).stdout).toContain(
      "work-item bound: LAS-12"
    );
  });

  it("refuses a Jira key from another project", () => {
    const fixture = createFixture(JIRA);
    const result = cli(fixture, [LINK, "OTH-12"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("is outside configured jira project LAS");
  });

  it("refuses a Jira reference that is not KEY-123", () => {
    const fixture = createFixture(JIRA);
    const result = cli(fixture, [LINK, "LAS/12"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("expected KEY-123");
  });

  it("canonicalizes a Linear identifier against the configured team", () => {
    const fixture = createFixture(LINEAR);
    expect(cli(fixture, [LINK, "lin-12"]).stdout).toContain(
      "work-item bound: LIN-12"
    );
  });

  it("refuses a Linear identifier from another team", () => {
    const fixture = createFixture(LINEAR);
    expect(cli(fixture, [LINK, "OTH-12"]).stderr).toContain(
      "is outside configured linear project LIN"
    );
  });

  it("has no completion writer for a tracker it cannot close", () => {
    const fixture = createFixture(JIRA);
    const result = cli(fixture, ["complete", "--ref", "LAS-12"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no completion writer for tracker 'jira'");
  });

  it("completes Linear only from a merged, managed-backlink PR", () => {
    const fixture = createFixture(LINEAR);
    const lookup = JSON.stringify({
      data: {
        issue: {
          id: "linear-12",
          identifier: "LIN-12",
          team: {
            key: "LIN",
            states: {
              nodes: [
                { id: "started", name: "In Progress", type: "started" },
                { id: "done", name: "Done", type: "completed" },
              ],
            },
          },
          state: { id: "started", name: "In Progress", type: "started" },
          attachments: { nodes: [] },
          comments: { nodes: [{ body: `[lisa-pr-link] ${PR_URL}` }] },
        },
      },
    });
    const update = JSON.stringify({
      data: { issueUpdate: { success: true } },
    });
    const readback = JSON.stringify({
      data: {
        issue: {
          id: "linear-12",
          identifier: "LIN-12",
          state: { id: "done", name: "Done", type: "completed" },
        },
      },
    });
    const result = cli(
      fixture,
      ["complete", "--ref", "LIN-12", "--pr-url", PR_URL],
      {
        FAKE_CURL_COUNT_FILE: path.join(fixture.root, "curl-count"),
        FAKE_CURL_JSON_1: lookup,
        FAKE_CURL_JSON_2: update,
        FAKE_CURL_JSON_3: readback,
        FAKE_GH_PR_JSON: JSON.stringify({
          mergedAt: "2026-08-26T00:00:00Z",
          number: 7,
          state: "MERGED",
          url: PR_URL,
        }),
        LINEAR_API_KEY: LINEAR_TOKEN,
      }
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(
      "work-item completed: LIN-12 -> done (merged: #7)"
    );
  });

  it("refuses Linear completion without explicit merged-PR evidence", () => {
    const fixture = createFixture(LINEAR);
    const result = cli(fixture, ["complete", "--ref", "LIN-12"], {
      LINEAR_API_KEY: LINEAR_TOKEN,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("completing Linear work requires --pr-url");
  });

  it("refuses Linear completion when the supplied PR is not merged", () => {
    const fixture = createFixture(LINEAR);
    const result = cli(
      fixture,
      ["complete", "--ref", "LIN-12", "--pr-url", PR_URL],
      {
        FAKE_GH_PR_JSON: JSON.stringify({
          mergedAt: null,
          number: 7,
          state: "OPEN",
          url: PR_URL,
        }),
        LINEAR_API_KEY: LINEAR_TOKEN,
      }
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("pull request is not verified merged");
  });

  it("refuses Linear completion from a same-named repository under another owner", () => {
    const fixture = createFixture(LINEAR);
    const result = cli(
      fixture,
      [
        "complete",
        "--ref",
        "LIN-12",
        "--pr-url",
        "https://github.com/microsoft/code/pull/7",
      ],
      { LINEAR_API_KEY: LINEAR_TOKEN }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "it belongs to microsoft/code, not repository acme/code"
    );
  });

  it("lets an explicit --url outrank LISA_PR_URL for Linear completion", () => {
    const fixture = createFixture(LINEAR);
    const terminalIssue = JSON.stringify({
      data: {
        issue: {
          id: "linear-12",
          identifier: "LIN-12",
          team: {
            key: "LIN",
            states: {
              nodes: [{ id: "done", name: "Done", type: "completed" }],
            },
          },
          state: { id: "done", name: "Done", type: "completed" },
          attachments: { nodes: [] },
          comments: { nodes: [{ body: `[lisa-pr-link] ${PR_URL}` }] },
        },
      },
    });
    const result = cli(
      fixture,
      ["complete", "--ref", "LIN-12", "--url", PR_URL],
      {
        FAKE_CURL_JSON: terminalIssue,
        FAKE_GH_PR_JSON: JSON.stringify({
          mergedAt: "2026-08-26T00:00:00Z",
          number: 7,
          state: "MERGED",
          url: PR_URL,
        }),
        LINEAR_API_KEY: LINEAR_TOKEN,
        LISA_PR_URL: "https://github.com/acme/code/pull/99",
      }
    );

    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("work-item completed: LIN-12 -> done");
  });

  it("has no sweep for a tracker it cannot sweep", () => {
    const fixture = createFixture(LINEAR);
    const result = cli(fixture, ["sweep"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no sweep for tracker 'linear'");
  });

  it("refuses a Linear backlink with no key anywhere", () => {
    const fixture = createFixture(LINEAR);
    const result = cli(fixture, [
      "backlink",
      "--ref",
      "LIN-12",
      "--pr-url",
      "https://github.com/acme/code/pull/7",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("requires LINEAR_API_KEY");
  });
});

describe("in-process CLI: where the config comes from", () => {
  it("merges .lisa.config.local.json over the committed config", () => {
    const fixture = createFixture();
    writeFileSync(
      path.join(fixture.root, LOCAL_CONFIG),
      `${JSON.stringify({ workItem: { verify: TRAILER } })}\n`
    );
    expect(cli(fixture, [VERIFY_LEVEL]).stdout).toBe(TRAILER);
  });

  it("honours an explicit config file without merging head-local overrides", () => {
    const fixture = createFixture();
    const trusted = path.join(fixture.root, "trusted.json");
    writeFileSync(trusted, `${JSON.stringify(githubConfig(TRAILER))}\n`);
    writeFileSync(
      path.join(fixture.root, LOCAL_CONFIG),
      `${JSON.stringify({ workItem: { verify: "full" } })}\n`
    );
    expect(
      cli(fixture, [VERIFY_LEVEL], { LISA_TRACKING_CONFIG_FILE: trusted })
        .stdout
    ).toBe(TRAILER);
  });

  it("refuses when the explicitly named config file is missing", () => {
    const fixture = createFixture();
    const result = cli(fixture, [VERIFY_LEVEL], {
      LISA_TRACKING_CONFIG_FILE: path.join(fixture.root, "absent.json"),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Required file not found");
  });

  // This used to prove the config was read by staging an unclaimed issue and
  // reading the role name out of the refusal. That refusal is gone — claim
  // state no longer blocks anything — but the role names are still read from
  // the project's config, and they still reach a reader: the gate summary
  // printed alongside every traceability refusal names both of them. Asserting
  // there keeps the config-resolution coverage without reinstating a check the
  // guard deliberately no longer performs.
  it("reads a project's own lifecycle role names", () => {
    const fixture = createFixture({
      github: {
        labels: { build: { claimed: "state:building", ready: "state:queued" } },
        org: "acme",
        repo: REPO,
      },
      tracker: "github",
      workItem: { verify: TRAILER },
    });
    commit(fixture, "feat: a change naming no work item");
    const body = path.join(fixture.root, "BODY");
    writeFileSync(body, "no trailer anywhere in this body\n");

    const result = cli(fixture, [
      "validate-pr",
      "--base",
      "HEAD~1",
      "--body-file",
      body,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('the ready role "state:queued"');
    expect(result.stderr).toContain('the claimed role "state:building"');
  });
});
