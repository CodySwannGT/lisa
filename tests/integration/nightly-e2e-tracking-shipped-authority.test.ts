/**
 * RED authority contract binding workflow execution to the tested reconciler.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const PROVIDER_ACTION =
  "typescript/copy-overwrite/scripts/nightly-e2e-provider-action.mjs";
const RECONCILER = "./reconcile-nightly-e2e-tracking.mjs";
const COMBINED_WORKFLOW = ".github/workflows/nightly-e2e-tracking.yml";
const PROVIDER_WORKFLOWS = ["github", "sentry", "jira", "linear"].map(
  provider => `.github/workflows/create-${provider}-issue-on-failure.yml`
);

/** Minimal reusable-workflow shape needed by the authority assertions. */
interface Workflow {
  readonly on?: Record<string, unknown>;
  readonly true?: Record<string, unknown>;
  readonly jobs: Record<
    string,
    {
      readonly outputs?: Record<string, string>;
      readonly with?: Record<string, unknown>;
      readonly steps?: readonly {
        readonly env?: Record<string, string>;
        readonly run?: string;
        readonly uses?: string;
        readonly with?: Record<string, unknown>;
      }[];
    }
  >;
}

/**
 * Read one repository-relative file.
 * @param relative - Repository-relative path
 * @returns File contents
 */
function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

/**
 * Parse one workflow with YAML 1.1 `on` compatibility.
 * @param relative - Repository-relative workflow path
 * @returns Parsed workflow
 */
function workflow(relative: string): Workflow {
  return yaml.load(read(relative)) as Workflow;
}

/**
 * Return a reusable workflow's declared inputs.
 * @param value - Parsed reusable workflow
 * @returns Declared workflow-call inputs
 */
function inputs(value: Workflow): Record<string, unknown> {
  const on = value.on ?? value.true ?? {};
  const call = on.workflow_call as Record<string, unknown>;
  return call.inputs as Record<string, unknown>;
}

describe("shipped combined-tracker authority", () => {
  it("binds the tested reconciler from the provider action", () => {
    const source = read(PROVIDER_ACTION);
    const imports = source.match(/reconcileCombinedTracking/gu) ?? [];

    expect(source).toMatch(
      new RegExp(
        `import\\s*\\{[^}]*reconcileCombinedTracking[^}]*\\}` +
          `\\s*from\\s*"${RECONCILER}"`,
        "u"
      )
    );
    expect(source).toMatch(
      new RegExp(
        "export async function runProviderAction[\\s\\S]*" +
          "await reconcileCombinedTracking\\(",
        "u"
      )
    );
    expect(imports.length).toBe(2);
  });

  it("keeps imports pure and binds executable main once", () => {
    const source = read(PROVIDER_ACTION);

    expect(source).toContain(
      "pathToFileURL(invokedPath).href === import.meta.url"
    );
    expect(source.match(/await runProviderAction\(/gu)).toHaveLength(1);
    expect(source).not.toMatch(/await providers\[[^\]]+\]\(\)/u);
  });

  it("passes raw findings to exactly one selected provider job", () => {
    const combined = workflow(COMBINED_WORKFLOW);
    expect(combined.jobs.plan?.outputs).toHaveProperty("tracking_findings");

    for (const provider of ["github", "sentry", "jira", "linear"]) {
      expect(combined.jobs[provider]?.with?.tracking_findings).toContain(
        "needs.plan.outputs.tracking_findings"
      );
    }
  });

  it.each(PROVIDER_WORKFLOWS)(
    "%s feeds config and findings into the same provider entry point",
    relative => {
      const parsed = workflow(relative);
      expect(inputs(parsed)).toHaveProperty("tracking_findings");
      const step = Object.values(parsed.jobs)
        .flatMap(job => job.steps ?? [])
        .find(candidate =>
          candidate.run?.includes("nightly-e2e-provider-action")
        );

      expect(step?.env?.LISA_CONFIG_PATH).toBe(".lisa.config.json");
      expect(step?.env?.NIGHTLY_E2E_FINDINGS).toContain(
        "inputs.tracking_findings"
      );
      expect(step?.run).toBe("node scripts/nightly-e2e-provider-action.mjs");
    }
  );

  it("preserves PR 3403 publication fallback beside combined tracking", () => {
    const relative = ".github/workflows/create-github-issue-on-failure.yml";
    const parsed = workflow(relative);
    const steps = Object.values(parsed.jobs).flatMap(job => job.steps ?? []);
    const publication = steps.find(step =>
      step.uses?.startsWith("actions/github-script@")
    );
    const combined = steps.find(step =>
      step.run?.includes("nightly-e2e-provider-action")
    );
    const script = String(publication?.with?.script ?? "");

    expect(script).toContain("github.rest.repos.get");
    expect(script).toMatch(/has_issues\s*===\s*true/u);
    expect(script).toContain("core.warning");
    expect(script).toContain("core.summary");
    expect(script).toMatch(/if\s*\(!issuesEnabled\)[\s\S]*return/u);
    expect(script).toMatch(/catch\s*\([^)]*\)[\s\S]*publishFailure/u);
    expect(script).not.toContain("core.setFailed");
    expect(combined?.run).toBe("node scripts/nightly-e2e-provider-action.mjs");
  });
});
