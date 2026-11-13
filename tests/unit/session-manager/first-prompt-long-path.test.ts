/**
 * The first-prompt locator for a cwd whose project directory name Claude
 * Code truncates (lisa#4821).
 *
 * Claude Code 2.1.319 keeps only the first 200 characters of a long
 * dash-encoded cwd and appends `-<hash>`. The detector cannot rely on the
 * hash, so it scans for directories that start with the truncated prefix:
 * exactly one directory holding the session's transcript is a find, anything
 * else is no verdict. Transcripts are planted with an independent oracle of
 * Claude Code's naming rule (support/claude-project-dir.ts), never with the
 * detector's own encoder.
 * @module tests/unit/session-manager/first-prompt-long-path
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
  findTranscript,
  readFirstPrompt,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/first-prompt.mjs";
import {
  PROJECT_DIR_LIMIT,
  claudeProjectDirName,
} from "./support/claude-project-dir.js";

const FIXTURES = path.resolve(
  import.meta.dirname,
  "../../fixtures/session-manager/transcripts"
);
const FULL_ID = "1a2b3c4d-0000-4000-8000-000000000001";
const OTHER_ID = "9f8e7d6c-0000-4000-8000-000000000009";
const UNKNOWN = "unknown-command";
const UNKNOWN_VERDICT = {
  alive: false,
  failure: { kind: UNKNOWN, detail: "/lisa:implement" },
};

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
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "sm-fpl-")));
  dirs.push(dir);
  return dir;
}

/**
 * A real directory whose dash-encoded path is well over Claude Code's limit.
 * @returns Absolute path
 */
function longCwd(): string {
  const cwd = path.join(
    tempDir(),
    "a".repeat(60),
    "b".repeat(60),
    "c".repeat(60),
    "d".repeat(30)
  );
  mkdirSync(cwd, { recursive: true });
  return cwd;
}

/**
 * Copy a fixture into `<configDir>/projects/<dirName>/<sessionId>.jsonl`.
 * @param configDir - Claude config dir
 * @param dirName - Project directory name
 * @param sessionId - Session id
 * @returns The transcript path
 */
function plantIn(configDir: string, dirName: string, sessionId = FULL_ID) {
  const dir = path.join(configDir, "projects", dirName);
  const file = path.join(dir, `${sessionId}.jsonl`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, readFileSync(path.join(FIXTURES, `${UNKNOWN}.jsonl`)));
  return file;
}

/**
 * The truncated prefix every Claude Code directory name for `cwd` starts with.
 * @param cwd - Session cwd
 * @returns `<first 200 encoded characters>-`
 */
function truncatedPrefix(cwd: string): string {
  return `${claudeProjectDirName(cwd).slice(0, PROJECT_DIR_LIMIT)}-`;
}

describe("Claude Code project-dir oracle", () => {
  it("reproduces the name Claude Code 2.1.319 wrote for a 241-character cwd", () => {
    // Observed: `claude -p` run in this (realpath) cwd filed its transcript
    // under exactly this directory name.
    const cwd = `/private/tmp/lisa-4821-oracle/${"a".repeat(62)}/${"b".repeat(62)}/${"c".repeat(62)}/${"d".repeat(22)}`;
    expect(cwd).toHaveLength(241);
    expect(claudeProjectDirName(cwd)).toBe(
      `-private-tmp-lisa-4821-oracle-${"a".repeat(62)}-${"b".repeat(62)}-${"c".repeat(44)}-hu4nnd`
    );
  });

  it("leaves a name of 200 characters or fewer untouched", () => {
    const cwd = `/${"x".repeat(199)}`;
    expect(claudeProjectDirName(cwd)).toBe(`-${"x".repeat(199)}`);
  });
});

describe("findTranscript under a truncated project directory", () => {
  it("finds the transcript and gives the same verdict as a short path", () => {
    const configDir = tempDir();
    const cwd = longCwd();
    const file = plantIn(configDir, claudeProjectDirName(cwd));
    expect(findTranscript({ configDir, cwd, sessionId: FULL_ID })).toBe(file);
    expect(findTranscript({ configDir, cwd, sessionId: "1a2b3c4d" })).toBe(
      file
    );
    expect(readFirstPrompt({ configDir, cwd, sessionId: FULL_ID })).toEqual(
      UNKNOWN_VERDICT
    );

    const shortCwd = tempDir();
    plantIn(configDir, claudeProjectDirName(shortCwd));
    expect(
      readFirstPrompt({ configDir, cwd: shortCwd, sessionId: FULL_ID })
    ).toEqual(UNKNOWN_VERDICT);
  });

  it("finds it under a symlinked cwd's long real path", () => {
    const configDir = tempDir();
    const real = longCwd();
    const link = path.join(tempDir(), "link");
    symlinkSync(real, link);
    const file = plantIn(configDir, claudeProjectDirName(real));
    expect(findTranscript({ configDir, cwd: link, sessionId: FULL_ID })).toBe(
      file
    );
  });

  it("uses the one prefix directory that holds the session, ignoring others", () => {
    const configDir = tempDir();
    const cwd = longCwd();
    plantIn(configDir, `${truncatedPrefix(cwd)}zzzzzz`, OTHER_ID);
    const file = plantIn(configDir, claudeProjectDirName(cwd));
    expect(findTranscript({ configDir, cwd, sessionId: FULL_ID })).toBe(file);
  });

  it("gives no verdict when two prefix directories both hold the session", () => {
    const configDir = tempDir();
    const cwd = longCwd();
    plantIn(configDir, claudeProjectDirName(cwd));
    plantIn(configDir, `${truncatedPrefix(cwd)}zzzzzz`);
    expect(findTranscript({ configDir, cwd, sessionId: FULL_ID })).toBeNull();
    expect(readFirstPrompt({ configDir, cwd, sessionId: FULL_ID })).toBeNull();
  });

  it("ignores a parent directory named exactly the bare 200-character prefix", () => {
    const configDir = tempDir();
    const cwd = longCwd();
    plantIn(configDir, truncatedPrefix(cwd).slice(0, -1));
    const file = plantIn(configDir, claudeProjectDirName(cwd));
    expect(findTranscript({ configDir, cwd, sessionId: FULL_ID })).toBe(file);
  });

  it("finds a transcript filed under the exact untruncated name", () => {
    const configDir = tempDir();
    // Over Claude Code's 200 but under the filesystem's 255-character name cap.
    const base = tempDir();
    const cwd = path.join(base, "e".repeat(230 - base.length - 1));
    mkdirSync(cwd, { recursive: true });
    const untruncated = cwd.replace(/[^A-Za-z0-9]/g, "-");
    expect(untruncated.length).toBeGreaterThan(PROJECT_DIR_LIMIT);
    const file = plantIn(configDir, untruncated);
    expect(findTranscript({ configDir, cwd, sessionId: FULL_ID })).toBe(file);
  });

  // The literal AC2 "neither" case. It is null with or without the scan;
  // the "one holds" and "both hold" cases above are what exercise the scan.
  it("gives no verdict when two prefix directories hold neither", () => {
    const configDir = tempDir();
    const cwd = longCwd();
    plantIn(configDir, claudeProjectDirName(cwd), OTHER_ID);
    plantIn(configDir, `${truncatedPrefix(cwd)}zzzzzz`, OTHER_ID);
    expect(findTranscript({ configDir, cwd, sessionId: FULL_ID })).toBeNull();
    expect(readFirstPrompt({ configDir, cwd, sessionId: FULL_ID })).toBeNull();
  });

  it("gives no verdict when the projects directory does not exist", () => {
    expect(
      findTranscript({
        configDir: tempDir(),
        cwd: longCwd(),
        sessionId: FULL_ID,
      })
    ).toBeNull();
  });
});

describe("findTranscript for a short cwd", () => {
  it("uses the exact encoded directory and never a prefix look-alike", () => {
    const configDir = tempDir();
    const cwd = tempDir();
    const name = claudeProjectDirName(cwd);
    expect(name.length).toBeLessThanOrEqual(PROJECT_DIR_LIMIT);
    const file = plantIn(configDir, name);
    plantIn(configDir, `${name}-zzzzzz`);
    expect(findTranscript({ configDir, cwd, sessionId: FULL_ID })).toBe(file);
  });

  it("does not fall back to a prefix look-alike when the exact directory is missing", () => {
    const configDir = tempDir();
    const cwd = tempDir();
    plantIn(configDir, `${claudeProjectDirName(cwd)}-zzzzzz`);
    expect(findTranscript({ configDir, cwd, sessionId: FULL_ID })).toBeNull();
  });
});
