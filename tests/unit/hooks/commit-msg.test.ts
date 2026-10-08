/* eslint-disable max-lines -- per-agent attribution cases each need a full fixture message; the suite tracks one gate across the whole fleet (#4282) */
/**
 * Regression tests for the commit-msg hook diagnostics.
 *
 * The hook should name the exact failing commitlint rule and show concrete
 * attribution trailers, so agents do not need multiple commit attempts to learn
 * what the hook wanted.
 * @module tests/unit/hooks/commit-msg
 */
import type { SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

const HOOK_PATH = path.resolve(".husky/commit-msg");
const TEMPLATE_HOOK_PATH = path.resolve(
  "typescript/copy-contents/.husky/commit-msg"
);
const BASH_PATH = "/bin/bash";
// git runs hooks through `sh`, not bash, and the two disagree about `echo`:
// bash prints `a\cb` verbatim while sh honours the XSI meaning of `\c` and
// stops output there. Tests that only ever run the hook under bash therefore
// cannot see any shell-portability defect, which is how #2143 survived.
const SH_PATH = "/bin/sh";
const GIT_PATH = resolveGit();
const VALID_SUBJECT = "fix: clarify hook output";
const PASSING_COMMITLINT_BIN = "exit 0\n";
const CLAUDE_AGENT_TRAILER = "AI-Agent: Claude";
const CLAUDE_TRAILER = "Co-authored-by: Claude <noreply@anthropic.com>";
const DEVIN_TRAILER = "Co-authored-by: Devin <devin@cognition.ai>";
const HUMAN_TRAILER = "Co-authored-by: Jane Doe <jane@example.com>";
const OPENCODE_TRAILER = "Co-authored-by: OpenCode <noreply@opencode.ai>";
const OPENCODE_AGENT_TRAILER = "AI-Agent: OpenCode";
const DEVIN_AGENT_TRAILER = "AI-Agent: Devin";
const DEVIN_MODEL_TRAILER = "AI-Model: cognition/swe-2";
const DEVIN_EFFORT_TRAILER = "AI-Effort: not exposed by runtime";
const OPENCODE_MODEL_HINT = "AI-Model: <provider/model>";
const OPENCODE_EFFORT_HINT = "AI-Effort: <effort or runtime value>";
const WORK_ITEM_REF = "acme/widgets#42";
const WORK_ITEM_TRAILER = `Work-Item: ${WORK_ITEM_REF}`;
const TRACKER_SCRIPT = path.resolve(
  "all/copy-overwrite/scripts/lisa-work-item.mjs"
);
/**
 * The directory the tracker reaches into for its shared modules.
 *
 * A directory, not a file. This named `lib/invoked-as-script.mjs` and stopped
 * being a faithful copy the moment the tracker imported a second sibling
 * (CodySwannGT/lisa#2980) — the fixture then failed with an
 * ERR_MODULE_NOT_FOUND inside `node_modules/@codyswann/lisa/…`, which reads as
 * the published package missing a file rather than as the fixture naming what
 * it should have read. CodySwannGT/lisa#3082.
 */
const ENTRY_GUARD_DIR = path.resolve("all/copy-overwrite/scripts/lib");

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
    expect(result.stdout).toContain(CLAUDE_TRAILER);
    expect(result.stdout).toContain("Co-authored-by: Codex <codex@openai.com>");
    expect(result.stdout).toContain(
      "Co-authored-by: Cursor <noreply@cursor.com>"
    );
    expect(result.stdout).toContain(OPENCODE_TRAILER);
    expect(result.stdout).toContain(
      "Co-authored-by: Antigravity <noreply@google.com>"
    );
    expect(result.stdout).toContain(
      "Co-authored-by: Copilot <noreply@github.com>"
    );
    expect(result.stdout).toContain(OPENCODE_AGENT_TRAILER);
    expect(result.stdout).toContain(OPENCODE_MODEL_HINT);
    expect(result.stdout).toContain(OPENCODE_EFFORT_HINT);
  });

  it("accepts every fleet agent's trailer alone", () => {
    // The gate must cover the whole supported fleet — Claude, Codex, Cursor,
    // OpenCode, Antigravity, Copilot — not just the three it started with.
    // CodySwannGT/lisa#4282.
    for (const trailer of [
      "Co-authored-by: Cursor <noreply@cursor.com>",
      "Co-authored-by: Antigravity <noreply@google.com>",
      "Co-authored-by: Copilot <noreply@github.com>",
    ]) {
      const project = createProject({
        binName: "npx",
        binBody: PASSING_COMMITLINT_BIN,
        message: `${VALID_SUBJECT}\n\n${WORK_ITEM_TRAILER}\n${trailer}\n`,
      });

      const result = runHook(project);

      expect(result.status, `refused ${trailer}`).toBe(0);
    }
  });

  it("accepts a non-fleet agent carrying AI metadata trailers", () => {
    // Devin is not in Lisa's plugin fleet, but the gate enforces attribution,
    // not agent gatekeeping: the AI-Agent/AI-Model/AI-Effort block keeps the
    // commit auditable. CodySwannGT/lisa#4282.
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        VALID_SUBJECT,
        "",
        WORK_ITEM_TRAILER,
        DEVIN_TRAILER,
        DEVIN_AGENT_TRAILER,
        DEVIN_MODEL_TRAILER,
        DEVIN_EFFORT_TRAILER,
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(0);
  });

  it("rejects a non-fleet agent missing AI metadata trailers", () => {
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [VALID_SUBJECT, "", WORK_ITEM_TRAILER, DEVIN_TRAILER, ""].join(
        "\n"
      ),
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("AI-Agent");
    expect(result.stdout).toContain("AI-Model");
    expect(result.stdout).toContain("AI-Effort");
  });

  it("rejects AI metadata written in body prose, not the trailer block", () => {
    // The AI-* checks read the same parsed trailer block the co-author list
    // comes from — an "AI-Agent:" line in prose is not attribution metadata
    // and must not satisfy the gate. CodySwannGT/lisa#4282.
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        VALID_SUBJECT,
        "",
        "Authored with assistance; metadata recorded inline:",
        DEVIN_AGENT_TRAILER,
        DEVIN_MODEL_TRAILER,
        DEVIN_EFFORT_TRAILER,
        "",
        WORK_ITEM_TRAILER,
        DEVIN_TRAILER,
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("AI-Agent");
  });

  it("rejects metadata that attests to no listed co-author", () => {
    // A commit whose only co-author is human — or whose AI-Agent names an
    // agent that is not a co-author — is refused: the block must attest to
    // someone actually listed. CodySwannGT/lisa#4294.
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        VALID_SUBJECT,
        "",
        WORK_ITEM_TRAILER,
        HUMAN_TRAILER,
        DEVIN_AGENT_TRAILER,
        DEVIN_MODEL_TRAILER,
        DEVIN_EFFORT_TRAILER,
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("AI-Agent");
  });

  it("rejects an AI-Agent value that only substring-matches the trailer prefix", () => {
    // "AI-Agent: Co-authored-by" substring-matches every co-author trailer
    // line while naming nobody — the check compares against the extracted
    // co-author NAME, not the raw line. CodySwannGT/lisa#4294.
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        VALID_SUBJECT,
        "",
        WORK_ITEM_TRAILER,
        HUMAN_TRAILER,
        "AI-Agent: Co-authored-by",
        DEVIN_MODEL_TRAILER,
        DEVIN_EFFORT_TRAILER,
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("AI-Agent");
  });

  it("accepts a human co-author when the driving agent is also listed", () => {
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        VALID_SUBJECT,
        "",
        WORK_ITEM_TRAILER,
        HUMAN_TRAILER,
        DEVIN_TRAILER,
        DEVIN_AGENT_TRAILER,
        DEVIN_MODEL_TRAILER,
        DEVIN_EFFORT_TRAILER,
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(0);
  });

  it("rejects a non-fleet co-author even when a fleet trailer is present", () => {
    // Per-entry judgement: a fleet trailer must not mask a sibling co-author
    // that owes AI-* metadata.
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        VALID_SUBJECT,
        "",
        WORK_ITEM_TRAILER,
        CLAUDE_TRAILER,
        DEVIN_TRAILER,
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("AI-Agent");
  });

  it("ignores a co-author named in prose, not the trailer block", () => {
    // A "Co-authored-by:" string inside the message body is not attribution —
    // only the git trailer block counts.
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        VALID_SUBJECT,
        "",
        "Review note: Co-authored-by: Devin <devin@cognition.ai> was discussed",
        "during pairing and is named here in passing.",
        "",
        WORK_ITEM_TRAILER,
        CLAUDE_TRAILER,
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(0);
  });

  it("does not count a body mention as co-authorship", () => {
    const project = createProject({
      binName: "npx",
      binBody: PASSING_COMMITLINT_BIN,
      message: [
        VALID_SUBJECT,
        "",
        "The diff was pair-reviewed; see Co-authored-by: Devin",
        "<devin@cognition.ai> in the notes.",
        "",
        WORK_ITEM_TRAILER,
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "Commit message must include AI co-authorship"
    );
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
  mkdirSync(path.join(project, "scripts/lib"), { recursive: true });
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
  // Every shared module the tracker imports. Missing one turns every
  // diagnostic this suite asserts on into an ERR_MODULE_NOT_FOUND stack.
  cpSync(ENTRY_GUARD_DIR, path.join(project, "scripts/lib"), {
    recursive: true,
  });
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
  boundedSpawnSync({
    label: "git init",
    command: GIT_PATH,
    args: ["init"],
    cwd: project,
    env: gitEnv,
  });
  boundedSpawnSync({
    label: "git checkout -b",
    command: GIT_PATH,
    args: ["checkout", "-b", "codex/issue-1264"],
    cwd: project,
    env: gitEnv,
  });
  return project;
}

/**
 * Run the real commit-msg hook against the temp project's commit message.
 * @param project - Temporary project directory.
 * @param shell - Interpreter to run the hook under; `sh` matches what git uses.
 * @param hookPath - Installed hook or source template to execute.
 * @returns The completed hook process.
 */
function runHook(
  project: string,
  shell: string = BASH_PATH,
  hookPath: string = HOOK_PATH
): SpawnSyncReturns<string> {
  return boundedSpawnSync({
    label: "commit-msg hook",
    command: shell,
    args: [hookPath, "COMMIT_EDITMSG"],
    cwd: project,
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

/* eslint-enable max-lines -- re-enable after the commit-msg attribution suite */
