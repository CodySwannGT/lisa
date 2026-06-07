import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeSanitizedSourceNote } from "../../../plugins/src/wiki/scripts/_wiki-lib.mjs";

const FIXTURE_SECRET = "sk_test_abcdefghijklmnopqrstuvwxyz";
const API_KEY_PLACEHOLDER = "api_key = [REDACTED:API_KEY]";
const GIT_BIN = "/usr/bin/git";
const PYTHON_BIN = process.env.PYTHON ?? "python3";
const CLEAN_GIT_ENV = cleanGitEnv();

describe("lisa-wiki connector source sanitization (#1171)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-wiki-sources-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { force: true, recursive: true });
  });

  it("sanitizes git source notes immediately before writing wiki/sources", () => {
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    execFileSync(GIT_BIN, ["init"], { cwd: repo, env: CLEAN_GIT_ENV });
    execFileSync(GIT_BIN, ["config", "user.email", "test@example.com"], {
      cwd: repo,
      env: CLEAN_GIT_ENV,
    });
    execFileSync(GIT_BIN, ["config", "user.name", "Test User"], {
      cwd: repo,
      env: CLEAN_GIT_ENV,
    });
    fs.writeFileSync(path.join(repo, "README.md"), "fixture\n");
    execFileSync(GIT_BIN, ["add", "README.md"], {
      cwd: repo,
      env: CLEAN_GIT_ENV,
    });
    execFileSync(
      GIT_BIN,
      ["commit", "-m", `record fixture api_key = ${FIXTURE_SECRET}`],
      { cwd: repo, env: CLEAN_GIT_ENV }
    );

    const sourceDir = path.join(tmp, "wiki", "sources", "git");
    const metaPath = path.join(tmp, "wiki", "state", "handoff", "git.json");
    execFileSync(
      process.execPath,
      [
        path.resolve("plugins/src/wiki/scripts/ingest-git.mjs"),
        "--repo",
        repo,
        "--slug",
        "fixture",
        "--source-dir",
        sourceDir,
        "--emit-meta",
        metaPath,
      ],
      { cwd: tmp, env: CLEAN_GIT_ENV }
    );

    const note = fs.readFileSync(
      path.join(
        sourceDir,
        `${new Date().toISOString().slice(0, 10)}-fixture-git.md`
      ),
      "utf8"
    );
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));

    expect(note).toContain(API_KEY_PLACEHOLDER);
    expect(note).not.toContain(FIXTURE_SECRET);
    expect(meta.safety.reviewRequired).toBe(true);
    expect(meta.safety.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: "api_key", count: 1 }),
      ])
    );
  });

  it("sanitizes project memory notes and leaves raw memory outside wiki/sources", () => {
    const memoryDir = path.join(tmp, "project-memory");
    const repo = path.join(tmp, "repo");
    const sourceDir = path.join(tmp, "wiki", "sources", "memory");
    const metaPath = path.join(tmp, "wiki", "state", "handoff", "memory.json");
    const configPath = path.join(tmp, "wiki", "lisa-wiki.config.json");
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(
      path.join(memoryDir, "MEMORY.md"),
      `Customer SSN 123-45-6789 and api_key = ${FIXTURE_SECRET}\n`
    );
    fs.writeFileSync(
      configPath,
      JSON.stringify({ memory: { allowedRoots: [memoryDir] } }, null, 2)
    );

    execFileSync(
      process.execPath,
      [
        path.resolve("plugins/src/wiki/scripts/ingest-memory.mjs"),
        "--memory-dir",
        memoryDir,
        "--repo",
        repo,
        "--config",
        configPath,
        "--source-dir",
        sourceDir,
        "--emit-meta",
        metaPath,
      ],
      { cwd: tmp }
    );

    const note = fs.readFileSync(
      path.join(
        sourceDir,
        `${new Date().toISOString().slice(0, 10)}-memory.md`
      ),
      "utf8"
    );
    const rawMemory = fs.readFileSync(
      path.join(memoryDir, "MEMORY.md"),
      "utf8"
    );

    expect(rawMemory).toContain(FIXTURE_SECRET);
    expect(note).toContain("[REDACTED:SSN]");
    expect(note).toContain(API_KEY_PLACEHOLDER);
    expect(note).not.toContain("123-45-6789");
    expect(note).not.toContain(FIXTURE_SECRET);
  });

  it("sanitizes Slack message text with typed placeholders", () => {
    const script = path.resolve(
      "plugins/src/wiki/scripts/ingest_slack_channel.py"
    );
    const result = spawnSync(
      PYTHON_BIN,
      [
        "-c",
        [
          "import importlib.util, json, sys",
          "spec = importlib.util.spec_from_file_location('slack_ingest', sys.argv[1])",
          "mod = importlib.util.module_from_spec(spec)",
          "spec.loader.exec_module(mod)",
          "print(json.dumps(mod.render_message({'ts':'1.000000','user':'U1','text':sys.argv[2]})))",
        ].join(";"),
        script,
        `token xoxp-secret-token and SSN 123-45-6789 and api_key = ${FIXTURE_SECRET}`,
      ],
      { encoding: "utf8" }
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[REDACTED:OAUTH_TOKEN]");
    expect(result.stdout).toContain("[REDACTED:SSN]");
    expect(result.stdout).toContain(API_KEY_PLACEHOLDER);
    expect(result.stdout).not.toContain("xoxp-secret-token");
    expect(result.stdout).not.toContain(FIXTURE_SECRET);
  });

  it("sanitizes Jira-style source notes through the shared writer", () => {
    const notePath = path.join(tmp, "wiki", "sources", "jira", "fixture.md");
    const result = writeSanitizedSourceNote(
      notePath,
      [
        "---",
        "type: source",
        "source_system: jira",
        "---",
        "",
        "# Jira Ingest",
        "",
        `Source: LISA-123 with client_secret = ${FIXTURE_SECRET}`,
      ].join("\n"),
      { sourceId: "jira/LISA-123", sourceSystem: "jira" }
    );
    const note = fs.readFileSync(notePath, "utf8");

    expect(result.reviewRequired).toBe(true);
    expect(note).toContain("client_secret = [REDACTED:API_KEY]");
    expect(note).not.toContain(FIXTURE_SECRET);
  });
});

/**
 * Remove parent-hook Git environment so fixture commands use the temp repo.
 *
 * @returns Process environment for nested Git commands.
 */
function cleanGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1" };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}
