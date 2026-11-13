/**
 * Unit tests for the first-prompt detector (lisa#4503).
 *
 * A worker whose very first prompt never ran — an unknown `/lisa:implement`,
 * or a `UserPromptSubmit` hook that refuses it — goes idle with zero
 * assistant turns, and nothing in `claude agents --json` says why. The only
 * record is the session transcript. These tests pin the detector to the
 * transcript shapes Claude Code writes (fixtures under
 * tests/fixtures/session-manager/transcripts), and the locator to the
 * `<config dir>/projects/<encoded cwd>/<session id>.jsonl` layout.
 * @module tests/unit/session-manager/first-prompt
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  awaitFirstPrompt,
  claudeConfigDir,
  detectFirstPromptFailure,
  encodeProjectDir,
  findTranscript,
  firstPromptVerdict,
  parseTranscript,
  readFirstPrompt,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/first-prompt.mjs";

const FIXTURES = path.resolve(
  import.meta.dirname,
  "../../fixtures/session-manager/transcripts"
);

/**
 * Parsed entries of one transcript fixture.
 * @param name - Fixture basename without `.jsonl`
 * @returns Entries
 */
function fixture(name: string) {
  return parseTranscript(
    readFileSync(path.join(FIXTURES, `${name}.jsonl`), "utf8")
  );
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/**
 * A fresh real temp dir, removed after the test.
 * @returns Absolute path
 */
function tempDir(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "sm-fp-")));
  dirs.push(dir);
  return dir;
}

const FULL_ID = "1a2b3c4d-0000-4000-8000-000000000001";
const UNKNOWN = "unknown-command";
const BLOCKED = "prompt-blocked";
const HOOK_REASON = "Secret scanning is inactive: not authenticated.";

/**
 * Copy a fixture to where Claude Code would write the session's transcript.
 * @param configDir - Claude config dir
 * @param cwd - Session cwd
 * @param name - Fixture basename
 * @param sessionId - Full session id
 * @returns The transcript path
 */
function plant(
  configDir: string,
  cwd: string,
  name: string,
  sessionId = FULL_ID
) {
  const dir = path.join(configDir, "projects", encodeProjectDir(cwd));
  const file = path.join(dir, `${sessionId}.jsonl`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, readFileSync(path.join(FIXTURES, `${name}.jsonl`)));
  return file;
}

describe("detectFirstPromptFailure", () => {
  it("reads an unknown slash command with no assistant turn as unknown-command", () => {
    expect(detectFirstPromptFailure(fixture(UNKNOWN))).toEqual({
      kind: UNKNOWN,
      detail: "/lisa:implement",
    });
  });

  it("reads a UserPromptSubmit hook refusal with no assistant turn as prompt-blocked", () => {
    expect(detectFirstPromptFailure(fixture(BLOCKED))).toEqual({
      kind: BLOCKED,
      detail: HOOK_REASON,
    });
  });

  it("reads the hook refusal from its message text when the structured ending is absent", () => {
    const entries = [
      {
        type: "system",
        subtype: "informational",
        content:
          "UserPromptSubmit operation blocked by hook:\n[shim]: not signed in\n\n\nOriginal prompt: hi",
      },
    ];
    expect(detectFirstPromptFailure(entries)).toEqual({
      kind: BLOCKED,
      detail: "[shim]: not signed in",
    });
  });

  it("returns null for a healthy transcript", () => {
    expect(detectFirstPromptFailure(fixture("healthy"))).toBeNull();
  });

  it("never fails a worker that has produced an assistant turn", () => {
    const entries = [
      ...fixture(UNKNOWN),
      ...fixture(BLOCKED),
      { type: "assistant", message: { role: "assistant", content: [] } },
    ];
    expect(detectFirstPromptFailure(entries)).toBeNull();
  });

  it("ignores the failure text when a user or assistant typed it", () => {
    const entries = [
      {
        type: "user",
        message: { role: "user", content: "Unknown command: /lisa:implement" },
      },
    ];
    expect(detectFirstPromptFailure(entries)).toBeNull();
  });

  it("returns null for an empty transcript", () => {
    expect(detectFirstPromptFailure([])).toBeNull();
  });
});

describe("firstPromptVerdict", () => {
  it.each([
    ["healthy", { alive: true, failure: null }],
    [
      UNKNOWN,
      {
        alive: false,
        failure: { kind: UNKNOWN, detail: "/lisa:implement" },
      },
    ],
  ])("judges %s", (name, expected) => {
    expect(firstPromptVerdict(fixture(name))).toEqual(expected);
  });

  it("is neither alive nor failed before the first prompt resolves", () => {
    expect(firstPromptVerdict([{ type: "attachment" }])).toEqual({
      alive: false,
      failure: null,
    });
  });
});

describe("parseTranscript", () => {
  it("skips blank and half-written lines", () => {
    expect(parseTranscript('{"type":"a"}\n\n{"type":"b"}\n{"typ')).toEqual([
      { type: "a" },
      { type: "b" },
    ]);
  });
});

describe("transcript location", () => {
  it("encodes every non-alphanumeric cwd character as a dash", () => {
    expect(
      encodeProjectDir("/Users/me/work/repo.v2/.claude/worktrees/x_1")
    ).toBe("-Users-me-work-repo-v2--claude-worktrees-x-1");
  });

  it("uses CLAUDE_CONFIG_DIR, else <home>/.claude", () => {
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: "/cfg" }, "/home/me")).toBe(
      "/cfg"
    );
    expect(claudeConfigDir({}, "/home/me")).toBe("/home/me/.claude");
  });

  it("finds a transcript by full id or by the short id claude --bg prints", () => {
    const configDir = tempDir();
    const cwd = tempDir();
    const file = plant(configDir, cwd, "healthy");
    expect(findTranscript({ configDir, cwd, sessionId: FULL_ID })).toBe(file);
    expect(findTranscript({ configDir, cwd, sessionId: "1a2b3c4d" })).toBe(
      file
    );
  });

  it("finds a transcript Claude Code filed under the cwd's real path", () => {
    const configDir = tempDir();
    const real = tempDir();
    const link = path.join(tempDir(), "link");
    // A symlinked cwd (macOS /tmp is /private/tmp) is filed by its real path.
    symlinkSync(real, link);
    const file = plant(configDir, real, "healthy");
    expect(findTranscript({ configDir, cwd: link, sessionId: FULL_ID })).toBe(
      file
    );
  });

  it("returns null when the transcript is missing or the id is ambiguous", () => {
    const configDir = tempDir();
    const cwd = tempDir();
    expect(
      findTranscript({ configDir, cwd, sessionId: "1a2b3c4d" })
    ).toBeNull();
    plant(configDir, cwd, "healthy");
    plant(configDir, cwd, "healthy", "1a2b3c4d-0000-4000-8000-000000000002");
    expect(
      findTranscript({ configDir, cwd, sessionId: "1a2b3c4d" })
    ).toBeNull();
    expect(findTranscript({ configDir, cwd, sessionId: null })).toBeNull();
  });

  it("readFirstPrompt gives no verdict for a missing transcript", () => {
    const configDir = tempDir();
    expect(
      readFirstPrompt({ configDir, cwd: tempDir(), sessionId: FULL_ID })
    ).toBeNull();
  });

  it("readFirstPrompt reads the planted fixture", () => {
    const configDir = tempDir();
    const cwd = tempDir();
    plant(configDir, cwd, BLOCKED);
    expect(readFirstPrompt({ configDir, cwd, sessionId: "1a2b3c4d" })).toEqual({
      alive: false,
      failure: {
        kind: BLOCKED,
        detail: HOOK_REASON,
      },
    });
  });
});

describe("awaitFirstPrompt", () => {
  it("polls until the transcript resolves", async () => {
    const configDir = tempDir();
    const cwd = tempDir();
    let sleeps = 0;
    const verdict = await awaitFirstPrompt({
      configDir,
      cwd,
      sessionId: FULL_ID,
      windowMs: 10_000,
      intervalMs: 1_000,
      sleep: async () => {
        sleeps += 1;
        if (sleeps === 2) plant(configDir, cwd, UNKNOWN);
      },
    });
    expect(sleeps).toBe(2);
    expect(verdict?.failure?.kind).toBe(UNKNOWN);
  });

  it("gives up with no verdict when the window ends unresolved", async () => {
    let sleeps = 0;
    const verdict = await awaitFirstPrompt({
      configDir: tempDir(),
      cwd: tempDir(),
      sessionId: FULL_ID,
      windowMs: 3_000,
      intervalMs: 1_000,
      sleep: async () => {
        sleeps += 1;
      },
    });
    expect(verdict).toBeNull();
    expect(sleeps).toBe(3);
  });

  it("reads once and never sleeps with a zero window", async () => {
    const configDir = tempDir();
    const cwd = tempDir();
    plant(configDir, cwd, "healthy");
    let sleeps = 0;
    const verdict = await awaitFirstPrompt({
      configDir,
      cwd,
      sessionId: FULL_ID,
      windowMs: 0,
      intervalMs: 1_000,
      sleep: async () => {
        sleeps += 1;
      },
    });
    expect(verdict).toEqual({ alive: true, failure: null });
    expect(sleeps).toBe(0);
  });
});
