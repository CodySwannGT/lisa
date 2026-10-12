/**
 * The Sentry release release.yml creates must carry exactly the identifier the
 * caller's app reports, or no event ever attaches to it (CodySwannGT/lisa#4293).
 * These cases run the shipped resolver step under bash; only the external
 * Sentry action is simulated.
 */
import { describe, expect, it } from "vitest";

import {
  exerciseSentryJob,
  releaseWorkflow,
  SENTRY_CREDENTIALS,
} from "../helpers/sentry-release-harness.js";
import { jobOf } from "../helpers/workflow-test-utils.js";

const APP_NAME = "app@1.2.3+0.56f04b8d";

/**
 * Exercise a configured Sentry job with the given naming inputs.
 * @param inputs The naming inputs a caller passes.
 * @param vars Public variables (a public org makes a URL observable).
 * @param versionOutputs Overrides for the version job's outputs.
 * @returns The observation.
 */
function named(
  inputs: Record<string, string>,
  vars: Record<string, string> = {},
  versionOutputs: Record<string, string> = {}
) {
  return exerciseSentryJob({
    secrets: SENTRY_CREDENTIALS,
    vars,
    inputs,
    versionOutputs,
  });
}

describe("release.yml Sentry release naming", () => {
  it("declares both naming inputs as optional strings defaulting to empty", () => {
    const inputs = releaseWorkflow.on?.workflow_call?.inputs ?? {};
    for (const key of ["sentry_release_name", "sentry_release_name_command"]) {
      expect(inputs[key]).toMatchObject({
        required: false,
        type: "string",
        default: "",
      });
    }
  });

  it("publishes the resolved name as a workflow output", () => {
    const outputs = releaseWorkflow.on?.workflow_call?.outputs ?? {};
    expect(outputs.sentry_release_name?.value).toBe(
      "${{ jobs.sentry_release.outputs.sentry_release_name }}"
    );
  });

  it("keeps the bare version when no naming input is given", () => {
    const result = named({});
    expect(result.resolveStatus).toBe(0);
    expect(result.invoked).toBe(true);
    expect(result.actionVersion).toBe("1.2.3");
  });

  it("renders a template with version and a truncated trigger commit", () => {
    const result = named({ sentry_release_name: "app@{version}+0.{sha:8}" });
    expect(result.resolveStatus).toBe(0);
    expect(result.actionVersion).toBe(APP_NAME);
    expect(result.output).toContain(`name=${APP_NAME}\n`);
    expect(result.summary).toContain(APP_NAME);
  });

  it("reads a zero-padded length as decimal, never octal", () => {
    // Bash arithmetic reads 010 as octal 8 and rejects 08 outright.
    const result = named({
      sentry_release_name: "app@{version}+{sha:010}.{sha:08}",
    });
    expect(result.resolveStatus).toBe(0);
    expect(result.actionVersion).toBe("app@1.2.3+56f04b8d01.56f04b8d");
  });

  it("renders the tag, full commits and the release commit", () => {
    const result = named({
      sentry_release_name:
        "app@{version}+{tag}.{sha}.{release_commit}.{release_commit:7}",
    });
    expect(result.actionVersion).toBe(
      "app@1.2.3+v1.2.3.56f04b8d0123456789abcdef0123456789abcdef." +
        "c0ffee1234567890c0ffee1234567890c0ffee12.c0ffee1"
    );
  });

  it("takes the name a repository-declared command prints", () => {
    const result = named({
      sentry_release_name_command:
        'printf "app@%s+0.%s\\n" "$SENTRY_RELEASE_VERSION" "${SENTRY_RELEASE_SHA:0:8}"',
    });
    expect(result.resolveStatus).toBe(0);
    expect(result.actionVersion).toBe(APP_NAME);
  });

  it("hands the caller's command no secret", () => {
    // Asserted on the shipped step rather than by running a command: a runner
    // only exposes what the step's env declares, while a developer machine may
    // inject credentials into every shell it starts.
    const resolver = jobOf(releaseWorkflow, "sentry_release").steps?.find(
      item => item.id === "resolve_name"
    );
    const env = Object.entries(resolver?.env ?? {});
    expect(env.length).toBeGreaterThan(0);
    for (const [key, value] of env) {
      expect(key).not.toContain("TOKEN");
      expect(["SENTRY_ORG", "SENTRY_PROJECT"]).not.toContain(key);
      expect(String(value)).not.toContain("secrets.");
    }
  });

  it("encodes the resolved name into the public release URL", () => {
    const result = exerciseSentryJob({
      secrets: { ...SENTRY_CREDENTIALS, SENTRY_ORG: "" },
      vars: { SENTRY_ORG: "public-org" },
      inputs: { sentry_release_name: "app@{version}+0.{sha:8}" },
    });
    expect(result.output).toContain(
      "url=https://sentry.io/organizations/public-org/releases/app%401.2.3%2B0.56f04b8d/\n"
    );
  });

  it.each([
    [
      "both inputs set",
      {
        sentry_release_name: "a@{version}",
        sentry_release_name_command: "echo a",
      },
      "both",
    ],
    [
      "an unknown placeholder",
      { sentry_release_name: "a@{version}+{build}" },
      "{build}",
    ],
    [
      "an unbalanced brace",
      { sentry_release_name: "a@{version}+{sha" },
      "brace",
    ],
    [
      "a length on version",
      { sentry_release_name: "a@{version:3}" },
      "{version:3}",
    ],
    [
      "a too-short commit length",
      { sentry_release_name: "a@{version}+{sha:3}" },
      "{sha:3}",
    ],
    [
      "a commit length too large for shell arithmetic",
      { sentry_release_name: "a@{version}+{sha:99999999999999999999}" },
      "{sha:99999999999999999999}",
    ],
    [
      "a mistyped placeholder before a valid one",
      { sentry_release_name: "{Tag}-{version}" },
      "{Tag}",
    ],
    [
      "a name without the version",
      { sentry_release_name: "app@latest" },
      "1.2.3",
    ],
    [
      "whitespace in the name",
      { sentry_release_name: "app {version}" },
      "whitespace",
    ],
    ["a slash in the name", { sentry_release_name: "app/{version}" }, "/"],
    ["a failing command", { sentry_release_name_command: "exit 3" }, "exited"],
    [
      "an empty command result",
      { sentry_release_name_command: "true" },
      "empty",
    ],
  ])("fails the job, never the bare version, on %s", (_, inputs, reason) => {
    const result = named(inputs);
    expect(result.resolveStatus).toBe(1);
    expect(result.invoked).toBe(false);
    expect(result.resolveStdout).toContain("::error");
    expect(result.resolveStdout).toContain(reason);
    expect(result.output).toBe("created=false\nurl=\nname=\n");
  });

  it("refuses a release-commit placeholder when the version job reported none", () => {
    const result = named(
      { sentry_release_name: "a@{version}+{release_commit}" },
      {},
      { release_commit: "" }
    );
    expect(result.resolveStatus).toBe(1);
    expect(result.resolveStdout).toContain("{release_commit}");
  });

  it("resolves nothing and fails nothing when Sentry is not configured", () => {
    const result = exerciseSentryJob({
      secrets: { ...SENTRY_CREDENTIALS, SENTRY_AUTH_TOKEN: "" },
      inputs: { sentry_release_name: "a@{version}+{bogus}" },
    });
    expect(result.resolveStatus).toBeNull();
    expect(result.invoked).toBe(false);
  });
});
