/**
 * A consumer app reports the package.json version recorded at the commit that
 * triggered the run, not the version release.yml bumps to afterwards — the
 * bump is committed with [skip ci] and never built. `{sha_version}` names that
 * recorded version, and the name guard accepts it (CodySwannGT/lisa#4293).
 * These cases run the shipped resolver step under bash inside a real git
 * checkout; only the external Sentry action is simulated.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  exerciseSentryJob,
  releaseWorkflow,
  SENTRY_CREDENTIALS,
} from "../helpers/sentry-release-harness.js";
import { jobOf } from "../helpers/workflow-test-utils.js";
import { cleanGitEnv, GIT_BIN } from "../support/git-executable.js";

const GIT_ENV = {
  ...cleanGitEnv(),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};

/**
 * Run git in the fixture repository.
 * @param cwd Repository root.
 * @param args Git arguments.
 * @returns Trimmed stdout.
 */
function git(cwd: string, ...args: readonly string[]): string {
  const result = spawnSync(GIT_BIN, args, {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

/**
 * Commit one package.json body.
 * @param cwd Repository root.
 * @param body Raw package.json text, or null to commit without one.
 * @param message Commit message.
 * @returns The new commit's sha.
 */
function commitManifest(
  cwd: string,
  body: string | null,
  message: string
): string {
  if (body === null) {
    writeFileSync(path.join(cwd, "README.md"), message);
    git(cwd, "add", "README.md");
  } else {
    writeFileSync(path.join(cwd, "package.json"), body);
    git(cwd, "add", "package.json");
  }
  git(cwd, "commit", "-q", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

const RELEASED = { version: "0.0.675", tag: "v0.0.675" };

describe("release.yml Sentry {sha_version}", () => {
  let repository = "";
  let triggering = "";
  let bumped = "";
  let withoutManifest = "";
  let unparseable = "";
  let versionless = "";

  beforeAll(() => {
    repository = mkdtempSync(path.join(tmpdir(), "lisa-sentry-sha-version-"));
    git(repository, "init", "-q");
    withoutManifest = commitManifest(repository, null, "no manifest yet");
    unparseable = commitManifest(repository, "{ not json", "broken");
    versionless = commitManifest(
      repository,
      JSON.stringify({ name: "app" }),
      "no version"
    );
    // The merge a consumer's release run is triggered by: still 0.0.674.
    triggering = commitManifest(
      repository,
      JSON.stringify({ name: "app", version: "0.0.674" }),
      "feat: the change that ships"
    );
    // The bump release.yml commits afterwards with [skip ci]; never built.
    bumped = commitManifest(
      repository,
      JSON.stringify({ name: "app", version: "0.0.675" }),
      "chore(release): 0.0.675 [skip ci]"
    );
  });

  afterAll(() => {
    rmSync(repository, { recursive: true, force: true });
  });

  /**
   * Run the Sentry job in the fixture checkout.
   * @param inputs Naming inputs.
   * @param triggerSha The run's triggering commit.
   * @returns The observation.
   */
  function run(inputs: Record<string, string>, triggerSha = triggering) {
    return exerciseSentryJob({
      secrets: SENTRY_CREDENTIALS,
      inputs,
      versionOutputs: { ...RELEASED, release_commit: bumped },
      repository,
      triggerSha,
    });
  }

  it("names the release with the version the triggering commit recorded", () => {
    const result = run({ sentry_release_name: "app@{sha_version}+0.{sha:8}" });
    expect(result.resolveStdout).not.toContain("::error");
    expect(result.resolveStatus).toBe(0);
    expect(result.invoked).toBe(true);
    expect(result.actionVersion).toBe(
      `app@0.0.674+0.${triggering.slice(0, 8)}`
    );
    expect(result.output).toContain(
      `name=app@0.0.674+0.${triggering.slice(0, 8)}\n`
    );
  });

  it("accepts a command-printed name carrying the recorded version", () => {
    const result = run({
      sentry_release_name_command:
        'printf "app@%s+0.%s\\n" "$SENTRY_RELEASE_SHA_VERSION" "${SENTRY_RELEASE_SHA:0:8}"',
    });
    expect(result.resolveStdout).not.toContain("::error");
    expect(result.resolveStatus).toBe(0);
    expect(result.actionVersion).toBe(
      `app@0.0.674+0.${triggering.slice(0, 8)}`
    );
  });

  it("accepts a hard-coded command name carrying the recorded version", () => {
    const result = run({
      sentry_release_name_command: 'echo "app@0.0.674+0.abcdef12"',
    });
    expect(result.resolveStatus).toBe(0);
    expect(result.actionVersion).toBe("app@0.0.674+0.abcdef12");
  });

  it("still names the release with the released version via {version}", () => {
    const result = run({ sentry_release_name: "app@{version}" });
    expect(result.resolveStatus).toBe(0);
    expect(result.actionVersion).toBe("app@0.0.675");
  });

  it("keeps the bare released version when no naming input is given", () => {
    const result = run({});
    expect(result.resolveStatus).toBe(0);
    expect(result.actionVersion).toBe("0.0.675");
  });

  it.each([
    [
      "a command name carrying neither version",
      { sentry_release_name_command: 'echo "app@9.9.9"' },
      "0.0.674",
    ],
    [
      "a template using neither version placeholder",
      { sentry_release_name: "app@{tag}" },
      "{sha_version}",
    ],
  ])("refuses %s", (_, inputs, reason) => {
    const result = run(inputs);
    expect(result.resolveStatus).toBe(1);
    expect(result.invoked).toBe(false);
    expect(result.resolveStdout).toContain("::error");
    expect(result.resolveStdout).toContain(reason);
    expect(result.output).toBe("created=false\nurl=\nname=\n");
  });

  it.each([
    ["no package.json", () => withoutManifest, "could not read package.json"],
    ["an unparseable package.json", () => unparseable, "not valid JSON"],
    [
      "a package.json without a version",
      () => versionless,
      "no semver version",
    ],
  ])(
    "fails closed on {sha_version} when the triggering commit has %s",
    (_, sha, reason) => {
      const result = run(
        { sentry_release_name: "app@{sha_version}+0.{sha:8}" },
        sha()
      );
      expect(result.resolveStatus).toBe(1);
      expect(result.invoked).toBe(false);
      expect(result.resolveStdout).toContain("::error");
      expect(result.resolveStdout).toContain(reason);
    }
  );

  it("refuses a length on {sha_version}", () => {
    const result = run({ sentry_release_name: "app@{sha_version:7}" });
    expect(result.resolveStatus).toBe(1);
    expect(result.resolveStdout).toContain("{sha_version:7}");
  });

  it("checks out full history so the triggering commit's manifest is readable", () => {
    const checkout = jobOf(releaseWorkflow, "sentry_release").steps?.find(
      item => String(item.uses ?? "").startsWith("actions/checkout@")
    );
    expect(checkout?.with?.["fetch-depth"]).toBe(0);
  });

  it("fails closed on {sha_version} outside a git checkout", () => {
    const result = exerciseSentryJob({
      secrets: SENTRY_CREDENTIALS,
      inputs: { sentry_release_name: "app@{sha_version}" },
    });
    expect(result.resolveStatus).toBe(1);
    expect(result.resolveStdout).toContain("could not read package.json");
  });
});
