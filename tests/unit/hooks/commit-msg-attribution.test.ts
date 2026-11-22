/**
 * Regression tests for the commit-msg hook diagnostics.
 *
 * The hook should name the exact failing commitlint rule and show concrete
 * attribution trailers, so agents do not need multiple commit attempts to learn
 * what the hook wanted.
 * @module tests/unit/hooks/commit-msg-attribution
 */
import type { SpawnSyncReturns } from "node:child_process";
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import {
  BASH_PATH,
  OPENCODE_MODEL_HINT,
  OPENCODE_EFFORT_HINT,
  CLAUDE_AGENT_TRAILER,
  CLAUDE_TRAILER,
  DEVIN_AGENT_TRAILER,
  DEVIN_EFFORT_TRAILER,
  DEVIN_MODEL_TRAILER,
  DEVIN_TRAILER,
  HOOK_PATH,
  OPENCODE_AGENT_TRAILER,
  OPENCODE_TRAILER,
  PASSING_COMMITLINT_BIN,
  SH_PATH,
  TEMPLATE_HOOK_PATH,
  VALID_SUBJECT,
  WORK_ITEM_TRAILER,
  createProject as createHookProject,
  type ProjectOptions,
  runHook as runHookIn,
} from "./commit-msg-fixtures.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  tempDirs = [];
});

/**
 * Create a temp hook project and register it for cleanup after the test.
 * @param options - Project setup options.
 * @returns The temporary project directory.
 */
function createProject(options: ProjectOptions): string {
  const project = createHookProject(options, process.env);
  tempDirs.push(project);
  return project;
}

/**
 * Run the real commit-msg hook in a temp project under this process's env.
 * @param project - Temporary project directory.
 * @param shell - Interpreter to run the hook under; `sh` matches what git uses.
 * @param hookPath - Installed hook or source template to execute.
 * @returns The completed hook process.
 */
function runHook(
  project: string,
  shell?: string,
  hookPath?: string
): SpawnSyncReturns<string> {
  return runHookIn(project, process.env, shell, hookPath);
}

describe("commit-msg hook diagnostics", () => {
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

describe.each([
  { hookPath: HOOK_PATH, shell: BASH_PATH },
  { hookPath: HOOK_PATH, shell: SH_PATH },
  { hookPath: TEMPLATE_HOOK_PATH, shell: BASH_PATH },
  { hookPath: TEMPLATE_HOOK_PATH, shell: SH_PATH },
])(
  "exact commit attribution in $hookPath under $shell",
  ({ hookPath, shell }) => {
    it.each([
      [
        "body divider",
        ["Body.", "", "---", "", "More body."],
        [CLAUDE_TRAILER],
        0,
      ],
      ["native Claude attribution", [], ["Co-authored-by: Claude"], 0],
      [
        "native Codex attribution",
        [],
        ["Co-authored-by: Codex <noreply@openai.com>"],
        0,
      ],
      [
        "fleet driver missing metadata",
        [],
        [CLAUDE_TRAILER, CLAUDE_AGENT_TRAILER],
        1,
      ],
      [
        "fleet with unlisted driver",
        [],
        [
          CLAUDE_TRAILER,
          DEVIN_AGENT_TRAILER,
          DEVIN_MODEL_TRAILER,
          DEVIN_EFFORT_TRAILER,
        ],
        1,
      ],
      [
        "fleet with valid driver",
        [],
        [
          CLAUDE_TRAILER,
          CLAUDE_AGENT_TRAILER,
          DEVIN_MODEL_TRAILER,
          DEVIN_EFFORT_TRAILER,
        ],
        0,
      ],
      [
        "human with fleet first name",
        [],
        ["Co-authored-by: Claude Shannon <claude@example.com>"],
        1,
      ],
      [
        "fleet name with foreign email",
        [],
        ["Co-authored-by: Codex <someone@example.com>"],
        1,
      ],
      [
        "OpenCoder driver",
        [],
        [
          "Co-authored-by: OpenCoder <x@example.com>",
          "AI-Agent: OpenCoder",
          DEVIN_MODEL_TRAILER,
          DEVIN_EFFORT_TRAILER,
        ],
        0,
      ],
      [
        "email mentioning OpenCode",
        [],
        [
          "Co-authored-by: Jane Doe <jane@opencode.dev>",
          "AI-Agent: Jane Doe",
          DEVIN_MODEL_TRAILER,
          DEVIN_EFFORT_TRAILER,
        ],
        0,
      ],
      [
        "Devin driving alongside OpenCode",
        [],
        [
          DEVIN_TRAILER,
          OPENCODE_TRAILER,
          DEVIN_AGENT_TRAILER,
          DEVIN_MODEL_TRAILER,
          DEVIN_EFFORT_TRAILER,
        ],
        0,
      ],
      [
        "Claude driving alongside OpenCode",
        [],
        [
          CLAUDE_TRAILER,
          OPENCODE_TRAILER,
          CLAUDE_AGENT_TRAILER,
          DEVIN_MODEL_TRAILER,
          DEVIN_EFFORT_TRAILER,
        ],
        0,
      ],
      [
        "two driver attestations",
        [],
        [
          DEVIN_TRAILER,
          OPENCODE_TRAILER,
          DEVIN_AGENT_TRAILER,
          OPENCODE_AGENT_TRAILER,
          DEVIN_MODEL_TRAILER,
          DEVIN_EFFORT_TRAILER,
        ],
        1,
      ],
      [
        "duplicate identical driver",
        [],
        [
          OPENCODE_TRAILER,
          OPENCODE_AGENT_TRAILER,
          OPENCODE_AGENT_TRAILER,
          DEVIN_MODEL_TRAILER,
          DEVIN_EFFORT_TRAILER,
        ],
        1,
      ],
      [
        "unlisted OpenCode driver",
        [],
        [
          "Co-authored-by: Claude <bot@opencode.ai>",
          OPENCODE_AGENT_TRAILER,
          DEVIN_MODEL_TRAILER,
          DEVIN_EFFORT_TRAILER,
        ],
        1,
      ],
      [
        "case-insensitive exact fleet identity",
        [],
        ["Co-authored-by: cOdEx <CODEX@OPENAI.COM>"],
        0,
      ],
    ])("%s", (_name, body, trailers, status) => {
      const project = createProject({
        binName: "npx",
        binBody: PASSING_COMMITLINT_BIN,
        message: [
          VALID_SUBJECT,
          "",
          ...body,
          "",
          WORK_ITEM_TRAILER,
          ...trailers,
          "",
        ].join("\n"),
      });
      const result = runHook(project, shell, hookPath);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(status);
    });
  }
);

describe("commit message content cannot break the hook's own parsing", () => {
  const BACKSLASH_C_SUBJECT = String.raw`fix: use \copy for the bulk load`;

  it("accepts a valid trailer after a subject containing an XSI escape", () => {
    // Run under `sh`, deliberately. Under bash this passes with or without the
    // fix, so a bash-only assertion here would be a test that cannot fail.
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        BACKSLASH_C_SUBJECT,
        "",
        WORK_ITEM_TRAILER,
        CLAUDE_TRAILER,
        "",
      ].join("\n"),
    });

    const result = runHook(project, SH_PATH);

    // The trailer is present and correctly formed. Rejecting here means the
    // hook truncated the message before matching, then blamed the trailer.
    expect(result.stdout).not.toContain("must include AI co-authorship");
    expect(result.status).toBe(0);
  });

  it("still rejects a message that genuinely lacks a trailer", () => {
    // The control: the fix must not turn the co-authorship gate into a pass.
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: `${BACKSLASH_C_SUBJECT}\n\n${WORK_ITEM_TRAILER}\n`,
    });

    const result = runHook(project, SH_PATH);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("must include AI co-authorship");
  });
});
