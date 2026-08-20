/**
 * Tracker validation is OPTIONAL, and identically so on all three trackers.
 *
 * Three separate checks, and the distinction between them is the whole point:
 *
 * 1. FORMAT — always, offline, no credential. The trailer's shape against the
 *    configured project/team. This is what delivers traceability.
 * 2. EXISTENCE — only when a token happens to be present. An absent credential
 *    means "cannot verify, proceed", never "refuse the commit".
 * 3. CLAIM STATE — gone. It was the only check that could refuse work that was
 *    genuinely correct, and it did: right ticket, right trailer, right branch,
 *    tracker label simply not yet transitioned.
 *
 * These run in-process for the reason `tests/support/work-item-cli.ts` gives —
 * the mutation gate credits a kill only when the mutated module is loaded in
 * the test's own process.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  cleanupTemplates,
  cli,
  createFixture,
  Fixture,
  githubConfig,
  issueJson,
  REF,
} from "../../support/work-item-cli.js";

const VALIDATE = "validate-commit";
const SKIPPED = "live validation SKIPPED";
const REPO = "widgets";
const SOURCE = "all/copy-overwrite/scripts/lisa-work-item.mjs";

/** The lifecycle role an item carries BEFORE anything claims it. */
const READY = "status:ready";

/** A Jira project that asks for the full contract. */
const JIRA = {
  atlassian: { cloudId: "cloud-123", email: "agent@acme.test" },
  jira: { project: "LAS" },
  repo: REPO,
  tracker: "jira",
  workItem: { verify: "full" },
};

/** A Linear team that asks for the full contract. */
const LINEAR = {
  linear: { teamKey: "LIN", workspace: "acme" },
  repo: REPO,
  tracker: "linear",
  workItem: { verify: "full" },
};

/**
 * Every tracker credential this module can read, emptied.
 *
 * `cleanGitEnv` layers the fixture over the REAL process environment, so a
 * developer who exports `LINEAR_API_KEY` in their shell would otherwise turn
 * every "no credential" case into a credentialled one — passing for the wrong
 * reason on their machine and failing in CI.
 */
const NO_CREDENTIALS = {
  ATLASSIAN_API_TOKEN: "",
  JIRA_API_TOKEN: "",
  JIRA_LOGIN: "",
  LINEAR_API_KEY: "",
  LINEAR_API_KEY_ACME: "",
};

/** Credentials that make the Jira REST path the one that runs. */
const JIRA_CREDENTIALS = {
  JIRA_API_TOKEN: "jira-token",
  JIRA_LOGIN: "agent@acme.test",
};

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/**
 * A PATH with only the fixture's fakes and the system basics on it.
 *
 * The harness's default PATH keeps the developer's own, and `acli` is a real
 * binary on the machines this is written on. A Jira case asserting "no
 * credential anywhere" would then reach a live CLI.
 * @param fixture - The repository whose fakes should be reachable.
 * @returns The PATH value.
 */
function sealedPath(fixture: Fixture): string {
  return `${path.join(fixture.root, "fake-bin")}:/usr/bin:/bin`;
}

/**
 * Write a commit message carrying one Work-Item trailer.
 * @param fixture - The repository to write in.
 * @param ref - The reference the trailer names.
 * @returns Absolute path of the message file.
 */
function trailered(fixture: Fixture, ref: string): string {
  const file = path.join(fixture.root, "MSG");
  writeFileSync(file, `feat: tracked change\n\nWork-Item: ${ref}\n`);
  return file;
}

/**
 * A Jira issue payload, claimed unless a case says otherwise.
 * @param overrides - Fields to replace on `fields`.
 * @returns The payload as JSON text.
 */
function jiraJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    fields: {
      comment: { comments: [] },
      issuetype: { name: "Task" },
      labels: [`repo:${REPO}`],
      project: { key: "LAS" },
      status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
      subtasks: [],
      ...overrides,
    },
    key: "LAS-12",
  });
}

/**
 * A Linear issue payload, claimed unless a case says otherwise.
 * @param state - The workflow state to report.
 * @returns The payload as JSON text.
 */
function linearJson(
  state: { name: string; type: string } = {
    name: "In Progress",
    type: "started",
  }
): string {
  return JSON.stringify({
    data: {
      issue: {
        attachments: { nodes: [] },
        children: { nodes: [] },
        comments: { nodes: [] },
        id: "id-12",
        identifier: "LIN-12",
        labels: { nodes: [{ name: `repo:${REPO}` }, { name: "type:Task" }] },
        state,
        team: { key: "LIN" },
      },
    },
  });
}

describe("an absent tracker credential never refuses a commit", () => {
  it("GitHub: an unauthenticated gh degrades to the offline checks", () => {
    const fixture = createFixture(githubConfig());
    const result = cli(fixture, [VALIDATE, trailered(fixture, REF)], {
      ...NO_CREDENTIALS,
      FAKE_GH_ISSUE_FAIL: "1",
      FAKE_GH_STDERR: "gh auth login required",
    });
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toBe(`WORK_ITEM_TRACKING_OK ${REF}`);
    expect(result.stderr).toContain(SKIPPED);
  });

  it("Jira: no acli and no API token degrades to the offline checks", () => {
    const fixture = createFixture(JIRA);
    const result = cli(fixture, [VALIDATE, trailered(fixture, "LAS-12")], {
      ...NO_CREDENTIALS,
      PATH: sealedPath(fixture),
    });
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toBe("WORK_ITEM_TRACKING_OK LAS-12");
    expect(result.stderr).toContain(SKIPPED);
  });

  it("Linear: no LINEAR_API_KEY degrades to the offline checks", () => {
    const fixture = createFixture(LINEAR);
    const result = cli(fixture, [VALIDATE, trailered(fixture, "LIN-12")], {
      ...NO_CREDENTIALS,
      PATH: sealedPath(fixture),
    });
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toBe("WORK_ITEM_TRACKING_OK LIN-12");
    expect(result.stderr).toContain(SKIPPED);
  });

  it("Jira: an acli that is not identity-matched degrades rather than refusing", () => {
    const fixture = createFixture({
      ...JIRA,
      atlassian: { ...JIRA.atlassian, site: "acme.atlassian.net" },
    });
    writeFileSync(
      path.join(fixture.root, "fake-bin", "acli"),
      "#!/bin/sh\nset -eu\nprintf 'logged in to attacker.atlassian.net\\n'\n",
      { mode: 0o755 }
    );
    const result = cli(fixture, [VALIDATE, trailered(fixture, "LAS-12")], {
      ...NO_CREDENTIALS,
      PATH: sealedPath(fixture),
    });
    expect(result.exitCode).toBeUndefined();
    expect(result.stderr).toContain(SKIPPED);
    expect(result.stderr).toContain("acme.atlassian.net");
  });
});

describe("the format check bites with no credential anywhere", () => {
  it("GitHub: a trailer outside the configured repository is refused", () => {
    const fixture = createFixture(githubConfig());
    const result = cli(
      fixture,
      [VALIDATE, trailered(fixture, "acme/elsewhere#42")],
      { ...NO_CREDENTIALS, FAKE_GH_ISSUE_FAIL: "1" }
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("outside configured tracker repository");
  });

  it("GitHub: a trailer that is not owner/repo#123 is refused", () => {
    const fixture = createFixture(githubConfig());
    const result = cli(fixture, [VALIDATE, trailered(fixture, "LAS-12")], {
      ...NO_CREDENTIALS,
      FAKE_GH_ISSUE_FAIL: "1",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("expected owner/repo#123");
  });

  it("Jira: a trailer that is not KEY-123 is refused", () => {
    const fixture = createFixture(JIRA);
    const result = cli(fixture, [VALIDATE, trailered(fixture, "LAS/12")], {
      ...NO_CREDENTIALS,
      PATH: sealedPath(fixture),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("expected KEY-123");
  });

  it("Linear: a trailer from another team is refused", () => {
    const fixture = createFixture(LINEAR);
    const result = cli(fixture, [VALIDATE, trailered(fixture, "OTH-12")], {
      ...NO_CREDENTIALS,
      PATH: sealedPath(fixture),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("is outside configured linear project LIN");
  });
});

describe("a present credential still catches a fabricated reference", () => {
  it("GitHub: an issue the tracker does not have is refused", () => {
    const fixture = createFixture(githubConfig());
    const result = cli(fixture, [VALIDATE, trailered(fixture, REF)], {
      FAKE_GH_ISSUE_FAIL: "1",
      FAKE_GH_STDERR: "GraphQL: Could not resolve to an Issue (HTTP 404)",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("does not exist or is inaccessible");
  });

  it("Jira: a ticket the tracker does not have is refused", () => {
    const fixture = createFixture(JIRA);
    const result = cli(fixture, [VALIDATE, trailered(fixture, "LAS-12")], {
      ...JIRA_CREDENTIALS,
      FAKE_CURL_FAIL: "1",
      PATH: sealedPath(fixture),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("does not exist or is inaccessible");
  });

  it("Linear: an issue the tracker does not have is refused", () => {
    const fixture = createFixture(LINEAR);
    const result = cli(fixture, [VALIDATE, trailered(fixture, "LIN-12")], {
      FAKE_CURL_JSON: JSON.stringify({ data: { issue: null } }),
      LINEAR_API_KEY: "linear-token",
      PATH: sealedPath(fixture),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("does not exist in configured team LIN");
  });
});

describe("claim state is not enforced, credential or no credential", () => {
  it("GitHub: an item still carrying the ready role is accepted", () => {
    const fixture = createFixture(githubConfig());
    const result = cli(fixture, [VALIDATE, trailered(fixture, REF)], {
      FAKE_GH_ISSUE_JSON: issueJson({
        labels: [{ name: READY }, { name: "type:Bug" }],
      }),
    });
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toBe(`WORK_ITEM_TRACKING_OK ${REF}`);
    expect(result.stderr).not.toContain(SKIPPED);
  });

  it("GitHub: an item carrying no lifecycle role at all is accepted", () => {
    const fixture = createFixture(githubConfig());
    const result = cli(fixture, [VALIDATE, trailered(fixture, REF)], {
      FAKE_GH_ISSUE_JSON: issueJson({ labels: [{ name: "type:Bug" }] }),
    });
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toBe(`WORK_ITEM_TRACKING_OK ${REF}`);
  });

  it("Jira: a ticket still in the ready status is accepted", () => {
    const fixture = createFixture(JIRA);
    const result = cli(fixture, [VALIDATE, trailered(fixture, "LAS-12")], {
      ...JIRA_CREDENTIALS,
      FAKE_CURL_JSON: jiraJson({
        status: { name: "Ready", statusCategory: { key: "new" } },
      }),
      PATH: sealedPath(fixture),
    });
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toBe("WORK_ITEM_TRACKING_OK LAS-12");
  });

  it("Linear: an issue still in the ready state is accepted", () => {
    const fixture = createFixture(LINEAR);
    const result = cli(fixture, [VALIDATE, trailered(fixture, "LIN-12")], {
      FAKE_CURL_JSON: linearJson({ name: "Ready", type: "unstarted" }),
      LINEAR_API_KEY: "linear-token",
      PATH: sealedPath(fixture),
    });
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toBe("WORK_ITEM_TRACKING_OK LIN-12");
  });

  it("the checks claim state sat beside are untouched: an epic is still refused", () => {
    const fixture = createFixture(githubConfig());
    const result = cli(fixture, [VALIDATE, trailered(fixture, REF)], {
      FAKE_GH_ISSUE_JSON: issueJson({
        labels: [{ name: READY }, { name: "type:Epic" }],
      }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("is a container");
  });

  it("the checks claim state sat beside are untouched: a closed issue is still refused", () => {
    const fixture = createFixture(githubConfig());
    const result = cli(fixture, [VALIDATE, trailered(fixture, REF)], {
      FAKE_GH_ISSUE_JSON: issueJson({
        labels: [{ name: READY }],
        state: "CLOSED",
      }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("is closed; bind an open work item");
  });
});

describe("the deprecated lisa-linear keychain entry is gone", () => {
  it("no code path consults it", () => {
    const source = readFileSync(SOURCE, "utf8");
    expect(source).not.toContain("find-generic-password");
    expect(source).not.toContain("lisa-linear");
  });

  it("the Linear backlink writer names the variable, not a keychain entry", () => {
    const fixture = createFixture(LINEAR);
    const result = cli(
      fixture,
      [
        "backlink",
        "--ref",
        "LIN-12",
        "--pr-url",
        "https://github.com/acme/code/pull/7",
      ],
      { ...NO_CREDENTIALS, PATH: sealedPath(fixture) }
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("LINEAR_API_KEY");
    expect(result.stderr).not.toContain("keychain");
  });
});
