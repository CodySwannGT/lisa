/** A single native build trigger covers every commit in a push. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { jobOf, loadWorkflow } from "../helpers/workflow-test-utils.js";

const workflow = loadWorkflow("expo/create-only/.github/workflows/deploy.yml");
const body = jobOf(workflow, "check_app_config_changes").steps?.find(
  step => step.id === "check_changes"
)?.run;
const APP_CONFIG = "app.config.ts";
const BUILD_REQUIRED = "app_config_changed=true";
let root = "";

/**
 * Run a local fixture command and require success.
 * @param args Git arguments.
 * @returns Standard output from git.
 */
function git(...args: string[]): string {
  const result = boundedSpawnSync({
    label: "fixture git",
    command: "git",
    args,
    cwd: root,
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

/**
 * Commit a fixture change and return its revision.
 * @param file Fixture path.
 * @param content New file contents.
 * @returns Committed revision.
 */
function commit(file: string, content: string): string {
  fs.writeFileSync(path.join(root, file), content);
  git("add", file);
  git("commit", "-m", "fixture change");
  return git("rev-parse", "HEAD");
}

/**
 * Execute the actual workflow script against the fixture history.
 * @param before Push starting revision.
 * @param event Workflow event.
 * @returns The script output.
 */
function changed(before: string, event = "push"): string {
  const output = path.join(root, "outputs");
  const result = boundedSpawnSync({
    label: "native build push range",
    command: "bash",
    args: ["-c", body ?? "exit 99"],
    cwd: root,
    env: {
      ...process.env,
      GITHUB_OUTPUT: output,
      PUSH_BEFORE: before,
      EVENT_NAME: event,
    },
  });
  expect(result.status, result.stderr).toBe(0);
  return fs.readFileSync(output, "utf8").trim();
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-native-push-"));
  git("init", "-q");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  commit(APP_CONFIG, "initial");
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("native build push range", () => {
  it("builds when app config changed before the final commit", () => {
    const before = git("rev-parse", "HEAD");
    commit(APP_CONFIG, "changed");
    commit("README.md", "later unrelated commit");
    expect(changed(before)).toBe(BUILD_REQUIRED);
  });

  it("does not build for an unrelated push", () => {
    const before = git("rev-parse", "HEAD");
    commit("README.md", "documentation");
    expect(changed(before)).toBe("app_config_changed=false");
  });

  it.each(["app.json", "eas.json"])("builds for %s changes", file => {
    const before = git("rev-parse", "HEAD");
    commit(file, "{}");
    expect(changed(before)).toBe(BUILD_REQUIRED);
  });

  it("builds when a new branch has no before revision", () => {
    expect(changed("0".repeat(40))).toBe(BUILD_REQUIRED);
  });

  it("preserves manual comparison with the preceding commit", () => {
    commit(APP_CONFIG, "changed");
    expect(changed("", "workflow_dispatch")).toBe(BUILD_REQUIRED);
  });
});
