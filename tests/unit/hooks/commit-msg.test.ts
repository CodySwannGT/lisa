/**
 * Regression tests for the commit-msg hook diagnostics.
 *
 * The hook should name the exact failing commitlint rule and show concrete
 * attribution trailers, so agents do not need multiple commit attempts to learn
 * what the hook wanted.
 * @module tests/unit/hooks/commit-msg
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cleanGitEnv } from "../../helpers/test-utils.js";

const HOOK_PATH = path.resolve(".husky/commit-msg");
const BASH_PATH = "/bin/bash";
const GIT_PATH = "/usr/bin/git";
const VALID_SUBJECT = "fix: clarify hook output";
const PASSING_COMMITLINT_BIN = "exit 0\n";
const OPENCODE_TRAILER = "Co-authored-by: OpenCode <noreply@opencode.ai>";
const OPENCODE_AGENT_TRAILER = "AI-Agent: OpenCode";
const OPENCODE_MODEL_HINT = "AI-Model: <provider/model>";
const OPENCODE_EFFORT_HINT = "AI-Effort: <effort or runtime value>";
const WORK_ITEM_REF = "acme/widgets#42";
const WORK_ITEM_TRAILER = `Work-Item: ${WORK_ITEM_REF}`;
const TRACKER_SCRIPT = path.resolve(
  "all/copy-overwrite/scripts/lisa-work-item.mjs"
);

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  tempDirs = [];
});

describe("commit-msg hook diagnostics", () => {
  it("names the failed commitlint rule and offending subject", () => {
    const project = createProject({
      binName: "npx",
      binBody: [
        "printf '%s\\n' 'input: Fix Bad Subject'",
        "printf '%s\\n' '✖   subject must not be sentence-case, start-case, pascal-case, upper-case [subject-case]'",
        "exit 1",
      ].join("\n"),
      message: [
        "Fix Bad Subject",
        "",
        WORK_ITEM_TRAILER,
        "Co-authored-by: Codex <codex@openai.com>",
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Failed commitlint rule(s):");
    expect(result.stdout).toContain("[subject-case]");
    expect(result.stdout).toContain("Subject: Fix Bad Subject");
  });

  it("prints exact expected attribution trailers", () => {
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: `${VALID_SUBJECT}\n\n${WORK_ITEM_TRAILER}\n`,
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Expected one of these trailers:");
    expect(result.stdout).toContain(
      "Co-authored-by: Claude <noreply@anthropic.com>"
    );
    expect(result.stdout).toContain("Co-authored-by: Codex <codex@openai.com>");
    expect(result.stdout).toContain(OPENCODE_TRAILER);
    expect(result.stdout).toContain(OPENCODE_AGENT_TRAILER);
    expect(result.stdout).toContain(OPENCODE_MODEL_HINT);
    expect(result.stdout).toContain(OPENCODE_EFFORT_HINT);
  });

  it("accepts OpenCode attribution with model and effort metadata", () => {
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        VALID_SUBJECT,
        "",
        WORK_ITEM_TRAILER,
        OPENCODE_TRAILER,
        OPENCODE_AGENT_TRAILER,
        "AI-Model: openai/gpt-5.5",
        "AI-Effort: not exposed by runtime",
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(0);
  });

  it("rejects OpenCode attribution without model and effort metadata", () => {
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        VALID_SUBJECT,
        "",
        WORK_ITEM_TRAILER,
        OPENCODE_TRAILER,
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "OpenCode commits must include AI metadata trailers"
    );
    expect(result.stdout).toContain(OPENCODE_AGENT_TRAILER);
    expect(result.stdout).toContain(OPENCODE_MODEL_HINT);
    expect(result.stdout).toContain(OPENCODE_EFFORT_HINT);
  });
});

/**
 *
 */
type ProjectOptions = {
  readonly binName: string;
  readonly binBody: string;
  readonly message: string;
};

/**
 * Create a temporary git project wired to a fake package-manager binary.
 * @param options - Project setup options.
 * @returns The temporary project directory.
 */
function createProject(options: ProjectOptions): string {
  const project = mkdtempSync(path.join(tmpdir(), "lisa-commit-msg-"));
  const gitEnv = cleanGitEnv(process.env);
  tempDirs.push(project);
  mkdirSync(path.join(project, "node_modules", ".bin"), { recursive: true });
  mkdirSync(path.join(project, "scripts"), { recursive: true });
  writeFileSync(path.join(project, "package-lock.json"), "{}\n");
  writeFileSync(
    path.join(project, ".lisa.config.json"),
    '{"tracker":"github","github":{"org":"acme","repo":"widgets"}}\n'
  );
  writeFileSync(path.join(project, "COMMIT_EDITMSG"), options.message);
  copyFileSync(
    TRACKER_SCRIPT,
    path.join(project, "scripts/lisa-work-item.mjs")
  );
  writeBin(project, options.binName, options.binBody);
  writeBin(
    project,
    "gh",
    `if [ "\${1:-} \${2:-}" = "api graphql" ]; then
  printf '%s\\n' '{"data":{"repository":{"issue":{"subIssues":{"nodes":[]}}}}}'
else
  printf '%s\\n' '{"number":42,"url":"https://github.com/acme/widgets/issues/42","state":"OPEN","labels":[{"name":"status:in-progress"},{"name":"type:Task"}],"comments":[],"closedByPullRequestsReferences":[]}'
fi\n`
  );
  spawnSync(GIT_PATH, ["init"], {
    cwd: project,
    encoding: "utf8",
    env: gitEnv,
  });
  spawnSync(GIT_PATH, ["checkout", "-b", "codex/issue-1264"], {
    cwd: project,
    encoding: "utf8",
    env: gitEnv,
  });
  return project;
}

/**
 * Run the real commit-msg hook against the temp project's commit message.
 * @param project - Temporary project directory.
 * @returns The completed hook process.
 */
function runHook(project: string): ReturnType<typeof spawnSync> {
  return spawnSync(BASH_PATH, [HOOK_PATH, "COMMIT_EDITMSG"], {
    cwd: project,
    encoding: "utf8",
    env: cleanGitEnv(process.env, {
      PATH: `${path.join(project, "node_modules", ".bin")}:${process.env.PATH}`,
    }),
  });
}

/**
 * Write an executable fake binary into the temp project's local bin directory.
 * @param project - Temporary project directory.
 * @param name - Binary filename.
 * @param body - Shell body to execute after the shebang.
 */
function writeBin(project: string, name: string, body: string): void {
  const binPath = path.join(project, "node_modules", ".bin", name);
  writeFileSync(binPath, `#!/usr/bin/env bash\n${body}`);
  chmodSync(binPath, 0o755);
}
