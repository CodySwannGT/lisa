/** Exercise the shipped Sentry configuration and reporting steps without an API write. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { data, Evaluator, Lexer, Parser } from "@actions/expressions";
import { describe, expect, it } from "vitest";

import { githubCondition } from "../helpers/github-expression.js";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import {
  jobOf,
  loadWorkflow,
  type WorkflowStep,
} from "../helpers/workflow-test-utils.js";

const workflow = loadWorkflow(".github/workflows/release.yml");
const job = jobOf(workflow, "sentry_release");
const credentials = {
  SENTRY_AUTH_TOKEN: "fixture-token",
  SENTRY_ORG: "private-org",
  SENTRY_PROJECT: "private-project",
};
const PUBLIC_ORG = "public-org";
const PUBLIC_PROJECT = "public-project";
const CREATED_WITHOUT_URL = "created=true\nurl=\n";

/**
 * Resolve expressions using GitHub's interpreter, including actual env bindings.
 * @param source Shipped workflow expression or shell script.
 * @param context Fixture values for GitHub contexts.
 * @returns Rendered value passed to the shell.
 */
function render(source: unknown, context: Record<string, unknown>): string {
  return String(source).replace(
    /\$\{\{(.*?)\}\}/gu,
    (_, expression: string) => {
      const tokens = new Lexer(expression.trim()).lex().tokens;
      const parsed = new Parser(tokens, Object.keys(context), []).parse();
      const values = JSON.parse(
        JSON.stringify(context),
        data.reviver
      ) as data.Dictionary;
      return new Evaluator(parsed, values).evaluate().coerceString();
    }
  );
}

/**
 * Run real shell steps; only the external Sentry action outcome is supplied.
 * @param secrets Fixture secret channel.
 * @param vars Fixture public variable channel.
 * @param actionOutcome Simulated external action result.
 * @returns Observed action selection, credentials, outputs and summary.
 */
function exercise(
  secrets: Record<string, string>,
  vars: Record<string, string> = {},
  actionOutcome = "success"
) {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-sentry-config-"));
  const output = path.join(root, "output");
  const summary = path.join(root, "summary");
  const context = {
    secrets,
    vars,
    inputs: { environment: "production", sourcemaps: "" },
    needs: { version: { outputs: { version: "1.2.3" } } },
    steps: {
      check_config: { outputs: { configured: "false" } },
      sentry: { outcome: actionOutcome },
    },
  };
  const step = (id: string) => {
    const found = job.steps?.find(item => item.id === id || item.name === id);
    if (!found) throw new Error(`Missing Sentry step ${id}`);
    return found;
  };
  const environment = (item: WorkflowStep) =>
    Object.fromEntries(
      Object.entries(item.env ?? {}).map(([key, value]) => [
        key,
        render(value, context),
      ])
    );
  const run = (item: WorkflowStep) => {
    const fixtureEnv: Record<string, string> = {
      PATH: "/usr/bin:/bin",
      ...environment(item),
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
    };
    const clearMissing = Object.keys(credentials)
      .filter(key => fixtureEnv[key] === "")
      .map(key => `unset ${key};`)
      .join("\n");
    // Clear ambient credential injection inside the child before the fixture runs.
    return boundedSpawnSync({
      label: "Sentry workflow step",
      command: "/usr/bin/env",
      args: [
        "-i",
        ...Object.entries(fixtureEnv).map(([key, value]) => `${key}=${value}`),
        "/bin/bash",
        "-e",
        "-c",
        `${clearMissing}\n${render(item.run, context)}`,
      ],
      cwd: root,
    });
  };
  try {
    writeFileSync(output, "");
    writeFileSync(summary, "");
    run(step("check_config"));
    const configured = readFileSync(output, "utf8").includes("configured=true");
    context.steps.check_config.outputs.configured = String(configured);
    const action = step("sentry");
    const invoked = githubCondition(action.if ?? "false", context);
    if (!invoked) context.steps.sentry.outcome = "skipped";
    const reporting = step("Update Release Summary");
    if (githubCondition(reporting.if ?? "false", context)) run(reporting);
    writeFileSync(output, "");
    run(step("set_outputs"));
    return {
      invoked,
      actionEnv: environment(action),
      output: readFileSync(output, "utf8"),
      summary: readFileSync(summary, "utf8"),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("Sentry release configuration", () => {
  it("uses declared secrets first and never exports their metadata", () => {
    const result = exercise(credentials, {
      SENTRY_ORG: PUBLIC_ORG,
      SENTRY_PROJECT: PUBLIC_PROJECT,
    });
    expect(result.invoked).toBe(true);
    expect(result.actionEnv).toEqual(credentials);
    expect(result.output).toBe(CREATED_WITHOUT_URL);
    for (const value of Object.values(credentials)) {
      expect(result.summary + result.output).not.toContain(value);
    }
  });

  it("accepts secret-only callers without requiring variables", () => {
    const result = exercise(credentials);
    expect(result.invoked).toBe(true);
    expect(result.output).toBe(CREATED_WITHOUT_URL);
  });

  it("retains variable fallback and a URL containing only public metadata", () => {
    const result = exercise(
      { SENTRY_AUTH_TOKEN: credentials.SENTRY_AUTH_TOKEN },
      {
        SENTRY_ORG: PUBLIC_ORG,
        SENTRY_PROJECT: PUBLIC_PROJECT,
      }
    );
    expect(result.invoked).toBe(true);
    expect(result.actionEnv.SENTRY_ORG).toBe(PUBLIC_ORG);
    expect(result.actionEnv.SENTRY_PROJECT).toBe(PUBLIC_PROJECT);
    expect(result.output).toBe(
      "created=true\nurl=https://sentry.io/organizations/public-org/releases/1.2.3/\n"
    );
  });

  it("resolves each slug independently when callers mix channels", () => {
    const result = exercise(
      { ...credentials, SENTRY_PROJECT: "" },
      {
        SENTRY_PROJECT: PUBLIC_PROJECT,
      }
    );
    expect(result.invoked).toBe(true);
    expect(result.actionEnv.SENTRY_ORG).toBe("private-org");
    expect(result.actionEnv.SENTRY_PROJECT).toBe(PUBLIC_PROJECT);
    expect(result.output).toBe(CREATED_WITHOUT_URL);
  });

  it("reports a created release honestly when its URL is withheld", () => {
    const summaryLine = jobOf(workflow, "release_summary")
      .steps?.flatMap(step => step.run?.split("\n") ?? [])
      .find(line => line.includes("**Sentry Release**"));
    expect(summaryLine).toBeDefined();
    expect(
      render(summaryLine, {
        needs: {
          sentry_release: {
            outputs: {
              sentry_release_created: "true",
              sentry_release_url: "",
            },
          },
        },
      }).trim()
    ).toBe("- **Sentry Release**: Created");
  });

  it.each(Object.keys(credentials))(
    "skips when %s is missing from both channels",
    missing => {
      const result = exercise({ ...credentials, [missing]: "" });
      expect(result.actionEnv[missing]).toBe("");
      expect(result.invoked).toBe(false);
      expect(result.output).toBe("created=false\nurl=\n");
      expect(result.summary).toContain("configuration incomplete");
    }
  );

  it("does not report a failed action as a created release", () => {
    const result = exercise(credentials, {}, "failure");
    expect(result.output).toBe("created=false\nurl=\n");
    expect(result.summary).not.toContain("created successfully");
  });
});
