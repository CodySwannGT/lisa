/** Exercise the shipped Sentry configuration and reporting steps without an API write. */
import { describe, expect, it } from "vitest";

import {
  exerciseSentryJob,
  releaseWorkflow as workflow,
  render,
  SENTRY_CREDENTIALS as credentials,
} from "../helpers/sentry-release-harness.js";
import { jobOf } from "../helpers/workflow-test-utils.js";

const PUBLIC_ORG = "public-org";
const PUBLIC_PROJECT = "public-project";
const CREATED_WITHOUT_URL = "created=true\nurl=\nname=1.2.3\n";

/**
 * Exercise the job with the default release name.
 * @param secrets Fixture secret channel.
 * @param vars Fixture public variable channel.
 * @param actionOutcome Simulated external action result.
 * @returns The observation.
 */
function exercise(
  secrets: Record<string, string>,
  vars: Record<string, string> = {},
  actionOutcome = "success"
) {
  return exerciseSentryJob({ secrets, vars, actionOutcome });
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
      "created=true\nurl=https://sentry.io/organizations/public-org/releases/1.2.3/\nname=1.2.3\n"
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
      expect(result.output).toBe("created=false\nurl=\nname=\n");
      expect(result.summary).toContain("configuration incomplete");
    }
  );

  it("does not report a failed action as a created release", () => {
    const result = exercise(credentials, {}, "failure");
    expect(result.output).toBe("created=false\nurl=\nname=\n");
    expect(result.summary).not.toContain("created successfully");
  });
});
