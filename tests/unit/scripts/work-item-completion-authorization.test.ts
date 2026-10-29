/**
 * Run the real merge workflow command with the canonical CLI and controlled
 * provider reads/write recording. No tracker write leaves the fixture.
 * Production code and the existing lifecycle controls remain unchanged.
 */
import { mkdirSync, readFileSync, symlinkSync } from "node:fs";
import path from "node:path";

import { load } from "js-yaml";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import {
  cleanupFixtures,
  cleanupTemplates,
  commit,
  createFixture,
  git,
  githubConfig,
  issueJson,
  type Fixture,
} from "../../support/work-item-cli.js";
import { installStatefulProvider } from "../../support/work-item-stateful-provider.js";

const ISSUE_RESOURCE = "repos/acme/code/issues/42";
const UNKNOWN_READ = "unknown read";

useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

const REPOSITORY_ROOT = process.cwd();
const WORKFLOW = ".github/workflows/lifecycle-terminal-transition.yml";
const REF = "acme/code#42";
const TERMINAL = "status:done";

interface Workflow {
  jobs: { complete: { steps: { name?: string; run?: string }[] } };
}

const workflow = load(
  readFileSync(path.join(REPOSITORY_ROOT, WORKFLOW), "utf8")
) as Workflow;
const command = workflow.jobs.complete.steps.find(step =>
  step.run?.includes("sweep --apply")
)?.run;
if (command === undefined)
  throw new Error("Actual applying workflow step absent");

const MERGED_TIMELINE = JSON.stringify([
  {
    event: "cross-referenced",
    source: {
      issue: {
        number: 7,
        pull_request: { merged_at: "2026-01-01T00:00:00Z" },
        repository_url: "https://api.github.com/repos/acme/code",
      },
    },
  },
]);

/**
 * Create the existing controlled-provider fixture and expose the real thin
 * entry point at the path the workflow invokes. Node resolves its real import.
 * @returns Disposable repository with the actual CLI entry point symlinked.
 */
function workflowFixture(): Fixture {
  const fixture = createFixture({
    ...githubConfig("full", "code"),
    deploy: { branches: { production: "main" } },
  });
  mkdirSync(path.join(fixture.root, "scripts"));
  symlinkSync(
    path.join(REPOSITORY_ROOT, "scripts/lisa-work-item.mjs"),
    path.join(fixture.root, "scripts/lisa-work-item.mjs")
  );
  git(fixture.root, ["switch", "-q", "main"], fixture.env);
  return fixture;
}

/**
 * Execute the extracted complete step, including its range guard and pipeline.
 * The existing fake gh records real attempted CLI writes and staged readbacks.
 * @param fixture - Repository containing the push's declarations.
 * @param before - Exact push bound passed by the real workflow.
 * @param name - Named observation emitted to the normal test reporter.
 * @param body - Actual issue body returned by the controlled provider.
 * @returns Captured process streams and all provider command invocations.
 */
function runWorkflow(
  fixture: Fixture,
  before: string,
  name: string,
  body: string
) {
  const log = path.join(fixture.root, "gh.log");
  const initial = issueJson({
    assignees: [{ login: "fixture-owner" }],
    body,
    labels: [
      { name: "status:in-progress" },
      { name: "type:Bug" },
      { name: "component:ci" },
    ],
    url: "https://github.com/acme/code/issues/42",
  });
  const writes = installStatefulProvider(fixture, initial);
  const outcome = boundedSpawnSync({
    label: name,
    command: "/bin/bash",
    args: ["-e", "-c", command!],
    cwd: fixture.root,
    env: {
      ...fixture.env,
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
      PUSH_BEFORE: before,
      PUSH_BRANCH: "main",
      FAKE_GH_LOG: log,
      FAKE_GH_LIST_JSON: JSON.stringify([{ number: 42, title: name }]),
      FAKE_GH_TIMELINE_JSON: MERGED_TIMELINE,
    },
  });
  const calls = readFileSync(log, "utf8").trim().split("\n");
  const mutations = readFileSync(writes, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line).join(" "));
  const unhandled = readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8");
  console.log(
    JSON.stringify({
      name,
      workflow: WORKFLOW,
      command,
      pushBefore: before,
      pushBranch: "main",
      ref: REF,
      issueBody: body,
      replacementScaffolding:
        "Opt-in write-driven GitHub state and all-write recorder",
      actualCanonicalCli: "scripts/lisa-work-item.mjs (real source symlink)",
      status: outcome.status,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
      providerCalls: calls,
      mutations,
      unhandledProviderCalls: unhandled,
      realProviderWriteExecuted: false,
    })
  );
  expect(unhandled).toBe("");
  return { ...outcome, calls, mutations };
}

const REQUIRED_PROOF = [
  "## Target Backend Environment",
  "production",
  "## Validation Journey",
  "Verify the exact released package after release succeeds.",
  "[EVIDENCE: test-run-log: delivered-runtime-proof]",
].join("\n");

describe("actual merge workflow: completion authorization", () => {
  it.each<[string, string[]]>([
    ["PATCH", ["api", "--method", "PATCH", ISSUE_RESOURCE]],
    ["POST", ["api", "--method=POST", ISSUE_RESOURCE]],
    ["DELETE", ["api", "-XDELETE", ISSUE_RESOURCE]],
    [
      "GraphQL mutation",
      ["api", "graphql", "-f", "query=mutation { syntheticMutation }"],
    ],
    [UNKNOWN_READ, ["api", "repos/acme/code/unknown-read"]],
  ])("provider records and refuses unsupported %s", (name, args) => {
    const fixture = workflowFixture();
    fixture.env.FAKE_GH_LOG = path.join(fixture.root, "gh.log");
    const writes = installStatefulProvider(fixture, issueJson());
    const result = boundedSpawnSync({
      label: `controlled provider ${name}`,
      command: path.join(fixture.root, "fake-bin/gh"),
      args,
      env: fixture.env,
    });
    expect(result.status).toBe(70);
    expect(result.stderr).toContain("Unsupported controlled gh invocation:");
    const unhandled = JSON.parse(
      readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")
    );
    expect(unhandled.args).toEqual(args);
    expect(unhandled.writes).toBe(name !== UNKNOWN_READ);
    const recorded = readFileSync(writes, "utf8").trim();
    if (name === UNKNOWN_READ) expect(recorded).toBe("");
    else expect(JSON.parse(recorded)).toEqual(args);
  });

  it("provider state stays open through reads and changes only after recorded writes", () => {
    const fixture = workflowFixture();
    fixture.env.FAKE_GH_LOG = path.join(fixture.root, "gh.log");
    const writes = installStatefulProvider(fixture, issueJson());
    const invoke = (args: string[]) =>
      boundedSpawnSync({
        label: "controlled provider state model",
        command: path.join(fixture.root, "fake-bin/gh"),
        args,
        env: fixture.env,
      });
    const view = () => {
      const result = invoke(["issue", "view", "42", "--json", "state,labels"]);
      expect(result.status).toBe(0);
      return JSON.parse(result.stdout);
    };
    expect(view().state).toBe("OPEN");
    expect(view().state).toBe("OPEN");
    expect(readFileSync(writes, "utf8")).toBe("");
    expect(
      invoke(["issue", "edit", "42", "--add-label", TERMINAL]).status
    ).toBe(0);
    expect(view().state).toBe("OPEN");
    expect(view().labels).toContainEqual({ name: TERMINAL });
    expect(invoke(["issue", "close", "42"]).status).toBe(0);
    const closed = view();
    expect(closed.state).toBe("CLOSED");
    expect(view()).toEqual(closed);
    expect(readFileSync(writes, "utf8").trim().split("\n")).toHaveLength(2);
  });

  it.each(["first observation", "repeat observation"])(
    "merge-pending-proof-keeps-work-open (%s)",
    observation => {
      const fixture = workflowFixture();
      const before = git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
      commit(fixture, `fix: delivered source\n\nWork-Item: ${REF}\n`);
      const result = runWorkflow(
        fixture,
        before,
        `merge-pending-proof-keeps-work-open (${observation})`,
        `${REQUIRED_PROOF}\n## Delivery status\nRelease pending; runtime proof and public acceptance pending.\n`
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.calls.some(call => call.includes("timeline"))).toBe(true);
      expect(result.mutations).toEqual([]);
      expect(result.stdout).not.toContain("work-item completed:");
      expect(result.stdout).toMatch(/pending/i);
      expect(result.stdout).toMatch(/release|runtime|evidence|proof/i);
    }
  );

  it("merge-missing-proof-keeps-work-open", () => {
    const fixture = workflowFixture();
    const before = git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
    commit(fixture, `fix: delivered source\n\nWork-Item: ${REF}\n`);
    const result = runWorkflow(
      fixture,
      before,
      "merge-missing-proof-keeps-work-open",
      REQUIRED_PROOF
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.mutations).toEqual([]);
    expect(result.stdout).not.toContain("work-item completed:");
    expect(result.stdout).toMatch(
      /missing|absent|not attached|not accepted|pending/i
    );
    expect(result.stdout).toMatch(/runtime|evidence|proof/i);
  });

  it("valid bounded push leaves earlier work untouched", () => {
    const fixture = workflowFixture();
    commit(fixture, `fix: earlier source\n\nWork-Item: ${REF}\n`);
    const before = git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
    commit(fixture, "chore: unrelated push\n");
    const result = runWorkflow(
      fixture,
      before,
      "valid bounded push leaves earlier work untouched",
      REQUIRED_PROOF
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("No drift:");
    expect(result.calls.some(call => call.startsWith("issue list"))).toBe(true);
    expect(result.mutations).toEqual([]);
  });
});
