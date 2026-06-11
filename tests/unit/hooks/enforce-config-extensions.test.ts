/**
 * Tests for enforce-config-extensions.sh - the Harper/Fabric PostToolUse hook
 * that blocks accidental top-level config.yaml extension removal.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const PLUGIN_ROOT = path.resolve("plugins/src/harper-fabric");
const SCRIPT_PATH = path.join(
  PLUGIN_ROOT,
  "hooks/enforce-config-extensions.sh"
);
const BASH_PATH = "/bin/bash";
const CONFIG_PATH = "harper-app/config.yaml";
const GIT_PATH = "/usr/bin/git";

const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;

const BASE_CONFIG = `rest: true
graphqlSchema:
  files: '*.graphql'
roles:
  files: 'roles.yaml'
jsResource:
  files: 'resources.js'
static:
  files: 'web/**'
`;

const WITHOUT_GRAPHQL = `rest: true
roles:
  files: 'roles.yaml'
jsResource:
  files: 'resources.js'
static:
  files: 'web/**'
`;

const envelope = (filePath: string): string =>
  JSON.stringify({
    tool_name: "Edit",
    tool_input: { file_path: filePath },
  });

const run = (cwd: string, filePath = CONFIG_PATH) =>
  spawnSync(BASH_PATH, [SCRIPT_PATH], {
    cwd,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
    input: envelope(filePath),
    encoding: "utf-8",
  });

const gitEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
  );

const git = (cwd: string, args: readonly string[]) => {
  const result = spawnSync(GIT_PATH, args, {
    cwd,
    encoding: "utf-8",
    env: gitEnv(),
  });
  expect(result.status).toBe(0);
};

describe("enforce-config-extensions.sh", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "harper-config-hook-"));
    fs.mkdirSync(path.join(tempDir, "harper-app"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, CONFIG_PATH), BASE_CONFIG);
    git(tempDir, ["init"]);
    git(tempDir, ["config", "user.email", "test@example.com"]);
    git(tempDir, ["config", "user.name", "Test User"]);
    git(tempDir, ["add", CONFIG_PATH]);
    git(tempDir, ["commit", "-m", "seed config"]);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  it("blocks silent extension drops", () => {
    fs.writeFileSync(path.join(tempDir, CONFIG_PATH), WITHOUT_GRAPHQL);

    const result = run(tempDir);

    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain("graphqlSchema");
    expect(result.stderr).toContain("does not merge");
  });

  it("allows an intentional removal documented in the allowlist", () => {
    fs.mkdirSync(path.join(tempDir, ".lisa"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, ".lisa/harper-config-extension-allowlist.json"),
      JSON.stringify({
        [CONFIG_PATH]: {
          allowedRemovedExtensions: ["graphqlSchema"],
        },
      })
    );
    fs.writeFileSync(path.join(tempDir, CONFIG_PATH), WITHOUT_GRAPHQL);

    const result = run(tempDir);

    expect(result.status).toBe(EXIT_ALLOWED);
    expect(result.stderr).toBe("");
  });

  it("allows non-config edits", () => {
    const result = run(tempDir, "src/harper/resources.ts");

    expect(result.status).toBe(EXIT_ALLOWED);
    expect(result.stderr).toBe("");
  });

  it("allows edits when the current config.yaml contains malformed YAML", () => {
    fs.writeFileSync(
      path.join(tempDir, CONFIG_PATH),
      "!! invalid yaml: {{{ unclosed"
    );

    const result = run(tempDir);

    expect(result.status).toBe(EXIT_ALLOWED);
  });

  it("allows edits when the HEAD config.yaml contains malformed YAML", () => {
    fs.writeFileSync(
      path.join(tempDir, CONFIG_PATH),
      "!! invalid yaml: {{{ unclosed"
    );
    git(tempDir, ["add", CONFIG_PATH]);
    git(tempDir, ["commit", "-m", "commit malformed yaml"]);
    fs.writeFileSync(path.join(tempDir, CONFIG_PATH), BASE_CONFIG);

    const result = run(tempDir);

    expect(result.status).toBe(EXIT_ALLOWED);
  });
});
