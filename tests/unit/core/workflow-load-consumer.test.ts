import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const roots: string[] = [];
const template = path.resolve("all/copy-overwrite/scripts");

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * Run the installed script in a consumer with no Lisa source or dependencies.
 * @param scenario API response fixture to use.
 * @returns The consumer process result.
 */
function scan(scenario: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), "lisa-load-consumer-"));
  roots.push(root);
  mkdirSync(path.join(root, "scripts/lib"), { recursive: true });
  mkdirSync(path.join(root, ".github/workflows"), { recursive: true });
  cpSync(
    path.join(template, "check-workflow-load-failures.mjs"),
    path.join(root, "scripts/check-workflow-load-failures.mjs")
  );
  for (const name of ["failure", "adapter", "scan"]) {
    cpSync(
      path.join(template, `lib/reusable-workflow-load-${name}.mjs`),
      path.join(root, `scripts/lib/reusable-workflow-load-${name}.mjs`)
    );
  }
  writeFileSync(
    path.join(root, ".github/workflows/deploy.yml"),
    "jobs:\n  deploy:\n    uses: CodySwannGT/lisa/.github/workflows/release.yml@main\n"
  );
  writeFileSync(
    path.join(root, "gh"),
    `#!/usr/bin/env node
const mode = process.env.LOAD_SCAN_SCENARIO;
if (mode === "denied") { console.error("API access denied"); process.exit(1); }
if (mode === "invalid-json") { console.log("not JSON"); process.exit(0); }
if (mode === "malformed-object") { console.log("{}"); process.exit(0); }
const endpoint = process.argv[3];
let body;
if (endpoint.includes("/jobs?")) body = { total_count: mode === "runner" ? 1 : 0 };
else if (endpoint.endsWith("/runs/71")) body = { referenced_workflows: mode === "resolved" ? [{ sha: "resolved" }] : [] };
else body = { workflow_runs: [{ id: 71, path: ".github/workflows/deploy.yml", created_at: new Date().toISOString(), conclusion: "failure" }] };
console.log(JSON.stringify(body));
`,
    { mode: 0o755 }
  );
  if (scenario === "unreadable-workflow") {
    const workflow = path.join(root, ".github/workflows/deploy.yml");
    rmSync(workflow);
    mkdirSync(workflow);
  }
  return boundedSpawnSync({
    label: "consumer workflow-load scan",
    command: process.execPath,
    args: ["scripts/check-workflow-load-failures.mjs"],
    cwd: root,
    env: {
      PATH: `${root}${path.delimiter}${process.env.PATH}`,
      GITHUB_REPOSITORY: "CodySwannGT/lisa",
      LOAD_SCAN_SCENARIO: scenario,
    },
  });
}

describe("workflow-load detection reaches consumers", () => {
  it.each(["resolved", "runner"])("accepts a %s run", scenario => {
    const result = scan(scenario);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OK.");
  });

  it("reports a failed push handler with no loaded workflow", () => {
    const result = scan("load-failure");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("run 71");
    expect(result.stdout).toContain("failed to LOAD");
  });

  it.each([
    "denied",
    "invalid-json",
    "malformed-object",
    "unreadable-workflow",
  ])("refuses an unreadable scan: %s", scenario => {
    const result = scan(scenario);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("OK.");
  });

  it("seeds a scheduled Node runner independent of reusable workflow loading", () => {
    const workflow = readFileSync(
      "all/create-only/.github/workflows/workflow-load-failure-sweep.yml",
      "utf8"
    );
    expect(workflow).toContain("cron:");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("node scripts/check-workflow-load-failures.mjs");
    expect(workflow).not.toContain("CodySwannGT/lisa/.github/workflows/");
    expect(workflow).not.toContain("install");
  });
});
