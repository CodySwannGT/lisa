/**
 * @file review-evidence-template-policy.test.ts
 * @description Executes the host-owned seed to prevent weaker policy drift.
 * @module tests/integration/review-evidence-template-policy
 */
import * as fs from "fs-extra";
import { globSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { loadWorkflow } from "../helpers/workflow-test-utils.js";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CURRENT_DIR, "..", "..");
const OWN_WORKFLOW = ".github/workflows/review-evidence.yml";
const TEMPLATE_WORKFLOW =
  "typescript/create-only/.github/workflows/review-evidence.yml";
const PROVER = "scripts/check-skipped-required-checks.mjs";
const UPSTREAM_PROVER =
  "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs";
const DECLARATION = ".github/required-checks.json";
const CI_WORKFLOW = ".github/workflows/ci.yml";
const CODERABBIT = "CodeRabbit";
const HEAD_SHA = "a".repeat(40);
const BASH = "/bin/bash";

/**
 * Return the review-evidence step whose policy must match Lisa's own workflow.
 * @param relative - Repository-relative workflow path under inspection
 * @returns Exact shell source for the vacuity prover step
 */
function stepSource(relative: string): string {
  const workflow = loadWorkflow(path.join(REPO_ROOT, relative));
  const step = (workflow.jobs?.vacuity?.steps ?? []).find(candidate =>
    candidate.run?.includes("check-skipped-required-checks.mjs")
  );
  expect(step, `${relative} must carry the vacuity prover`).toBeDefined();
  return step?.run ?? "";
}

/**
 * Isolate executable prover calls so header prose cannot satisfy flag parity.
 * @param source - Shell source from the review-evidence workflow step
 * @returns Node command lines in their authored order
 */
function nodeInvocations(source: string): readonly string[] {
  return source
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.startsWith("node "));
}

/**
 * Ignore incidental arguments while retaining mutually exclusive gate policy.
 * @param command - One authored Node command from the workflow
 * @returns Gate arguments in their authored order
 */
function policyArguments(command: string): readonly string[] {
  return [...command.matchAll(/--[a-z-]+/gu)]
    .map(match => match[0])
    .filter(flag =>
      [
        "--vacuity",
        "--require-review-evidence",
        "--fail-on-vacuous",
        "--pr",
      ].includes(flag)
    );
}

describe("shipped review-evidence template policy", () => {
  let workdir = "";
  let bindir = "";

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "review-seed-"));
    bindir = await fs.mkdtemp(path.join(os.tmpdir(), "review-seed-bin-"));
    await installInputs(workdir);
  });

  afterEach(async () => {
    await fs.remove(workdir);
    await fs.remove(bindir);
  });

  it("matches Lisa's enforcing policy in both selector branches", () => {
    const own = nodeInvocations(stepSource(OWN_WORKFLOW));
    const template = nodeInvocations(stepSource(TEMPLATE_WORKFLOW));

    expect(template).toHaveLength(2);
    expect(template.map(policyArguments)).toEqual(own.map(policyArguments));
    expect(
      template.every(line => line.includes("--require-review-evidence"))
    ).toBe(true);
    expect(template.every(line => !line.includes("--fail-on-vacuous"))).toBe(
      true
    );
  });

  it("keeps one create-only authority for all inheriting stacks", () => {
    const shipped = globSync(
      "*/create-only/.github/workflows/review-evidence.yml",
      { cwd: REPO_ROOT }
    ).sort((left, right) => left.localeCompare(right));

    expect(shipped).toEqual([TEMPLATE_WORKFLOW]);
  });

  it("documents the owner-ruling boundary without collapsing states", () => {
    const header = fs
      .readFileSync(path.join(REPO_ROOT, TEMPLATE_WORKFLOW), "utf8")
      .split("\nname:")[0];

    expect(header).not.toContain("THIS NEVER BLOCKS A MERGE, on purpose");
    expect(header).not.toMatch(/\bnever\s+blocks?\s+(?:a\s+)?merge\b/iu);
    expect(header).not.toMatch(/\badd\s+`?--fail-on-vacuous`?/iu);
    expect(header).not.toContain(
      "that is the supported way to ask for an exit code"
    );
    expect(header).toContain("Review rate limited");
    expect(header).toContain(
      "Review skipped: manual review required for this OSS repository"
    );
    expect(header).toContain("RAN AND OBJECTED");
    expect(header).toContain("--fail-on-vacuous` is a DIFFERENT switch");
    expect(header).toContain("THREE STATES, NEVER TWO");
    expect(header).toContain("`absent` is not `waived`");
    expect(header).toMatch(/hour(?:ly|-long)/iu);
    expect(header).toMatch(/agentic.*admin-merge/isu);
  });

  it.each(["dispatch", "pull_request"])(
    "blocks an objecting review through the %s selector",
    async selector => {
      await stubGh(bindir, {
        name: CODERABBIT,
        state: "FAILURE",
        bucket: "fail",
        description: "Review completed with blocking issues",
      });

      const run = runTemplate(workdir, bindir, selector);

      expect(run.status).not.toBe(0);
      expect(run.output).toContain("review_evidence_unsatisfied");
      expect(run.output).not.toContain("review_evidence_waived");
      expect(run.output).toContain("RAN AND OBJECTED");
    }
  );

  it.each([
    "Review rate limited",
    "Review skipped: manual review required for this OSS repository",
  ])("keeps %s loud and nonblocking", async description => {
    await stubGh(bindir, {
      name: CODERABBIT,
      state: "SUCCESS",
      bucket: "pass",
      description,
    });

    const run = runTemplate(workdir, bindir, "dispatch");

    expect(run.status).toBe(0);
    expect(run.output).toContain("review_evidence_waived");
    expect(run.output).not.toContain("review_evidence_unsatisfied");
    expect(run.output).toContain("UNREVIEWED");
  });

  it("retains a completed review but refuses absent evidence", async () => {
    await stubGh(bindir, {
      name: CODERABBIT,
      state: "SUCCESS",
      bucket: "pass",
      description: "Review completed",
    });

    const run = runTemplate(workdir, bindir, "dispatch");

    expect(run.status).toBe(0);
    expect(run.output).not.toContain("review_evidence_unsatisfied");
    expect(run.output).not.toContain("review_evidence_waived");
    expect(run.output).toContain("evidence-bearing check(s) examined");

    await fs.writeJson(path.join(bindir, "checks.json"), []);
    const absent = runTemplate(workdir, bindir, "dispatch", true);

    expect(absent.status).not.toBe(0);
    expect(absent.output).toContain("vacuity_no_checks_reported");
    expect(absent.output).not.toContain("review_evidence_unsatisfied");
    expect(absent.output).not.toContain("review_evidence_waived");
  });
});

/**
 * Install real gate inputs so selector tests exercise shipped behavior.
 * @param root - Isolated host-project root that receives the gate inputs
 */
async function installInputs(root: string): Promise<void> {
  await fs.ensureDir(path.join(root, "scripts"));
  await fs.copy(
    path.join(REPO_ROOT, "typescript/copy-overwrite/scripts/lib"),
    path.join(root, "scripts/lib")
  );
  await fs.copy(path.join(REPO_ROOT, UPSTREAM_PROVER), path.join(root, PROVER));
  await fs.ensureDir(path.join(root, ".github/workflows"));
  await fs.writeFile(
    path.join(root, CI_WORKFLOW),
    ["jobs:", "  quality:", "    with:", "      skip_jobs: ''", ""].join("\n")
  );
  await fs.writeJson(path.join(root, DECLARATION), {
    ruleset: {
      repo: "owner/name",
      ids: [1],
      baseline_fetched_at: new Date().toISOString().slice(0, 10),
    },
    workflows: [CI_WORKFLOW],
    required_contexts: [CODERABBIT],
    skip_job_declarations: {},
    evidence_bearing_checks: { [CODERABBIT]: {} },
  });
  await fs.writeJson(path.join(root, "event.json"), {
    pull_request: { number: 4001 },
  });
}

/**
 * Serve one settled check without granting the test live GitHub access.
 * @param bin - Isolated executable directory prepended to PATH
 * @param row - Check result the real prover must classify
 */
async function stubGh(
  bin: string,
  row: Readonly<Record<string, string>>
): Promise<void> {
  const payload = path.join(bin, "checks.json");
  await fs.writeJson(payload, [row]);
  await fs.writeFile(
    path.join(bin, "gh"),
    `#!/bin/sh
case "$1:$2" in
  pr:view) printf '%s\n' ${JSON.stringify(HEAD_SHA)} ;;
  pr:checks) cat ${JSON.stringify(payload)} ;;
  api:*status*) cat ${JSON.stringify(payload)} ;;
  api:*check-runs*) printf '%s\n' '[]' ;;
  *) exit 1 ;;
esac
`,
    { mode: 0o755 }
  );
}

/**
 * Execute the create-only step with its real prover and declaration.
 * @param root - Isolated host-project root containing shipped inputs
 * @param bin - Isolated directory containing the GitHub CLI fixture
 * @param selector - Dispatch or pull-request branch to exercise
 * @param immediateSettle - Whether an intentionally absent roster skips polling
 * @returns Child exit status and combined output for policy assertions
 */
function runTemplate(
  root: string,
  bin: string,
  selector: string,
  immediateSettle = false
): { readonly status: number; readonly output: string } {
  const source = stepSource(TEMPLATE_WORKFLOW);
  const command = immediateSettle
    ? source.replaceAll(
        " --vacuity",
        " --vacuity --settle-timeout=0 --settle-interval=0"
      )
    : source;
  const result = boundedSpawnSync({
    label: `the review-evidence seed's ${selector} branch`,
    command: BASH,
    args: ["-c", command],
    cwd: root,
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
      VACUITY_PR: selector === "dispatch" ? "4001" : "",
      GITHUB_REPOSITORY: "owner/name",
      GITHUB_EVENT_PATH: path.join(root, "event.json"),
      GITHUB_REF: "refs/pull/4001/merge",
      GITHUB_STEP_SUMMARY: "",
    },
  });
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}
