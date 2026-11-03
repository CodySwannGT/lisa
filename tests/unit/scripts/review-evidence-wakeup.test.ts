/** Late reviewer completions request a normal fresh inspection (#4622). */
import * as path from "node:path";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadWorkflow } from "../../helpers/workflow-test-utils.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();

const ROOT = path.resolve(import.meta.dirname, "../../..");
const WORKFLOWS = [
  ".github/workflows/review-evidence.yml",
  "typescript/create-only/.github/workflows/review-evidence.yml",
];
const HEAD = "a".repeat(40);
const REPO = "owner/name";
const REVIEWER = "CodeRabbit";
const APP = 347564;
const WAKE_ONLY = "not review proof";

interface Scenario {
  name?: string;
  app?: { id?: number; slug?: string } | null;
  action?: string;
  status?: string;
  eventRepo?: string;
  currentHead?: string;
  baseRepo?: string;
  state?: string;
  race?: boolean;
  multiple?: boolean;
  conclusion?: string;
  eventName?: string;
  legacyState?: string;
}

/** Run the shipped executable; gh alone is the explicit external unit boundary. */
function runEvent(scenario: Scenario = {}, workflowStep?: string) {
  const folder = fs.mkdtempSync(path.join(tmpdir(), "review-wakeup-"));
  try {
    fs.mkdirSync(path.join(folder, ".github"));
    fs.mkdirSync(path.join(folder, "bin"));
    fs.cpSync(
      path.join(ROOT, "all/copy-overwrite/scripts"),
      path.join(folder, "scripts"),
      { recursive: true }
    );
    fs.writeFileSync(
      path.join(folder, ".github/required-checks.json"),
      JSON.stringify({ evidence_bearing_checks: { [REVIEWER]: {} } })
    );
    fs.writeFileSync(
      path.join(folder, ".lisa.config.json"),
      JSON.stringify({
        gates: {
          "code-review": {
            "pull-request": {
              level: "required",
              await: REVIEWER,
              posted_by: APP,
              evidence: { reviewer: true },
            },
          },
        },
      })
    );
    const event = {
      action: scenario.action ?? "completed",
      context: scenario.name ?? REVIEWER,
      sha: HEAD,
      state: scenario.legacyState ?? "success",
      repository: { full_name: scenario.eventRepo ?? REPO },
      check_run: {
        name: scenario.name ?? REVIEWER,
        head_sha: HEAD,
        app:
          scenario.app === undefined
            ? { id: APP, slug: "coderabbitai" }
            : scenario.app,
        status: scenario.status ?? "completed",
        conclusion: scenario.conclusion ?? "success",
        output: {
          title: "Finished",
          summary: "Result: Success - Review completed",
        },
      },
    };
    fs.writeFileSync(path.join(folder, "event.json"), JSON.stringify(event));
    fs.writeFileSync(
      path.join(folder, "scenario.json"),
      JSON.stringify(scenario)
    );
    fs.writeFileSync(path.join(folder, "calls.jsonl"), "");
    fs.writeFileSync(
      path.join(folder, "bin/gh"),
      `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const scenario = JSON.parse(fs.readFileSync("scenario.json", "utf8"));
const calls = fs.readFileSync("calls.jsonl", "utf8").trim().split("\\n").filter(Boolean).map(JSON.parse);
fs.appendFileSync("calls.jsonl", JSON.stringify(args)+"\\n");
const route = args[1];
if (args[0] === "workflow") process.exit(0);
if (route === "repos/${REPO}") console.log(JSON.stringify({full_name:${JSON.stringify(REPO)},default_branch:"main"}));
else if (route.includes("/commits/")) console.log(JSON.stringify(scenario.multiple ? [[{number:7}],[{number:8}]] : [[{number:7}]]));
else if (/\\/pulls\\/\\d+$/u.test(route)) {
 const previous = calls.filter(row => row[1]===route).length;
 console.log(JSON.stringify({number:Number(route.split("/").at(-1)),state:scenario.state??"open",head:{sha:scenario.race&&previous>0?"b".repeat(40):scenario.currentHead??${JSON.stringify(HEAD)}},base:{repo:{full_name:scenario.baseRepo??${JSON.stringify(REPO)}}}}));
} else {console.error("Unexpected gh arguments", args);process.exit(2)}
`,
      { mode: 0o755 }
    );
    const result = boundedSpawnSync({
      label: "shipped late reviewer wake-up CLI",
      command: workflowStep ? "/bin/sh" : process.execPath,
      args: workflowStep
        ? ["-c", workflowStep]
        : ["scripts/review-evidence-event.mjs", "--dispatch"],
      cwd: folder,
      env: {
        ...process.env,
        PATH: `${path.join(folder, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
        GITHUB_EVENT_NAME: scenario.eventName ?? "check_run",
        GITHUB_EVENT_PATH: path.join(folder, "event.json"),
        GITHUB_REPOSITORY: REPO,
      },
      baseMs: 30000,
    });
    const calls: string[][] = fs
      .readFileSync(path.join(folder, "calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line));
    return {
      status: result.status,
      stdout: String(result.stdout),
      stderr: String(result.stderr),
      calls,
      dispatches: calls.filter(args => args[0] === "workflow"),
    };
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

describe.each(WORKFLOWS)("late reviewer wake-up in %s", workflow => {
  it("listens for completed reviewer check runs after the first attempt expires", () => {
    const parsed = loadWorkflow(path.join(ROOT, workflow));
    expect(parsed.on).toHaveProperty("check_run.types", ["completed"]);
  });
  it("executes its actual recheck step and dispatches only a trusted current reviewer", () => {
    const parsed = loadWorkflow(path.join(ROOT, workflow));
    const job = parsed.jobs.recheck;
    const step = job?.steps?.find(row =>
      row.run?.includes("review-evidence-event.mjs")
    );
    expect(step?.run).toBeTruthy();
    const checkout = job?.steps?.find(row =>
      row.uses?.startsWith("actions/checkout@")
    );
    expect(checkout?.with?.ref).toBeUndefined();
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
    const accepted = runEvent({}, step?.run);
    expect(accepted.status, accepted.stderr).toBe(0);
    expect(accepted.dispatches).toHaveLength(1);
    const rejected = runEvent({ app: { id: APP + 1 } }, step?.run);
    expect(rejected.status, rejected.stderr).toBe(0);
    expect(rejected.dispatches).toEqual([]);
  });
});

describe("shipped late reviewer wake-up CLI", () => {
  it("dispatches the canonical default-branch gate for the current matching PR", () => {
    const result = runEvent();
    expect(result.status, result.stderr).toBe(0);
    expect(result.dispatches).toEqual([
      [
        "workflow",
        "run",
        "review-evidence.yml",
        "--repo",
        REPO,
        "--ref",
        "main",
        "-f",
        "pr=7",
      ],
    ]);
    expect(result.stdout).toContain(WAKE_ONLY);
    expect(result.calls).toContainEqual([
      "api",
      `repos/${REPO}/commits/${HEAD}/pulls?per_page=100`,
      "--paginate",
      "--slurp",
    ]);
  });

  it("does not lose another current PR on a later discovery page", () => {
    const result = runEvent({ multiple: true });
    expect(result.status, result.stderr).toBe(0);
    expect(result.dispatches.map(args => args.at(-1))).toEqual([
      "pr=7",
      "pr=8",
    ]);
  });

  const rejected: readonly [string, Scenario][] = [
    ["unrelated declared context", { name: "Build" }],
    ["wrong pinned reviewer app", { app: { id: APP + 1, slug: "impostor" } }],
    ["Actions-generated check", { app: { id: APP, slug: "github-actions" } }],
    ["absent app", { app: null }],
    ["invalid app identity", { app: { id: 0 } }],
    ["incomplete check", { status: "in_progress" }],
    ["nonterminal event action", { action: "created" }],
    ["foreign event repository", { eventRepo: "other/repo" }],
    ["stale review head", { currentHead: "b".repeat(40) }],
    ["closed current PR", { state: "closed" }],
    ["foreign current base repository", { baseRepo: "other/repo" }],
    ["push between discovery and dispatch", { race: true }],
  ];
  it.each(rejected)("cannot dispatch for %s", (_name, scenario) => {
    const result = runEvent(scenario);
    expect(result.status, result.stderr).toBe(0);
    expect(result.dispatches).toEqual([]);
    expect(result.calls.every(args => args[0] === "api")).toBe(true);
  });

  it("terminal skipped review only wakes a fresh gate and never posts a verdict", () => {
    const result = runEvent({ conclusion: "skipped" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.dispatches).toHaveLength(1);
    expect(result.calls.filter(args => args[0] !== "api")).toEqual(
      result.dispatches
    );
    expect(result.stdout).toContain(WAKE_ONLY);
  });

  it("legacy terminal status also dispatches only a fresh normal gate", () => {
    const result = runEvent({ eventName: "status", legacyState: "failure" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.dispatches).toHaveLength(1);
    expect(result.stdout).toContain(WAKE_ONLY);
  });

  it("pending legacy status cannot dispatch a gate", () => {
    const result = runEvent({ eventName: "status", legacyState: "pending" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.dispatches).toEqual([]);
  });
});
