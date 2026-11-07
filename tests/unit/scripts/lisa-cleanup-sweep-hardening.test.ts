/**
 * Safety refusals of the cleanup sweep's temp half, added after the security
 * review of CodySwannGT/lisa#4597.
 *
 * Each case sweeps a private root with the process half off. The refusals:
 * an entry another user owns or could have written into, the `lisa apply`
 * rollback copy, and a root that is `/`, the home directory, or an ancestor of
 * the home directory or the working directory.
 * @module tests/unit/scripts/lisa-cleanup-sweep-hardening
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LISA_PROTECTED_TEMP_PREFIXES,
  isLisaOwnedTempName,
  sweep,
} from "../../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep.mjs";

const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.parse("2026-11-07T12:00:00Z");
const STALE = new Date(NOW - 48 * HOUR_MS);
const roots: string[] = [];

/**
 * A private, empty sweep root.
 * @returns Absolute path
 */
function privateRoot(): string {
  const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-sweep-hard-"));
  roots.push(root);
  return root;
}

/**
 * A stale directory with the given mode.
 * @param root - Private root
 * @param name - Entry name
 * @param mode - Permission bits
 * @returns Absolute path
 */
function staleDir(root: string, name: string, mode = 0o700): string {
  const entry = path.join(root, name);
  fs.mkdirSync(entry);
  fs.chmodSync(entry, mode);
  fs.utimesSync(entry, STALE, STALE);
  return entry;
}

/**
 * A stale file with the given mode.
 * @param root - Private root
 * @param name - Entry name
 * @param mode - Permission bits
 * @returns Absolute path
 */
function staleFile(root: string, name: string, mode: number): string {
  const entry = path.join(root, name);
  fs.writeFileSync(entry, "x");
  fs.chmodSync(entry, mode);
  fs.utimesSync(entry, STALE, STALE);
  return entry;
}

/**
 * Sweep a private root with processes off.
 * @param root - Root
 * @param extra - More options
 * @returns Result
 */
function sweepRoot(root: string, extra: Record<string, unknown> = {}) {
  return sweep({ root, now: NOW, orphans: false, ...extra });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe.runIf(typeof process.getuid === "function")(
  "owner and mode refusal",
  () => {
    it("skips an entry another user owns and counts it, without an error", async () => {
      const root = privateRoot();
      const entry = staleDir(root, "lisa-not-mine");
      const uid = (process.getuid as () => number)() + 1;
      const result = await sweepRoot(root, { uid });
      expect(result.removed).toEqual([]);
      expect(result.skippedUnsafe).toBe(1);
      expect(result.errors).toEqual([]);
      expect(fs.existsSync(entry)).toBe(true);
    });

    it("skips a directory open to group or other, and a group- or world-writable file", async () => {
      const root = privateRoot();
      const kept = [
        staleDir(root, "lisa-group-readable", 0o750),
        staleDir(root, "lisa-world-open", 0o777),
        staleFile(root, "lisa-group-writable.txt", 0o620),
        staleFile(root, "lisa-world-writable.txt", 0o602),
      ];
      const result = await sweepRoot(root);
      expect(result.removed).toEqual([]);
      expect(result.skippedUnsafe).toBe(4);
      for (const entry of kept) expect(fs.existsSync(entry)).toBe(true);
    });

    it("still removes a private directory and a readable but not writable file", async () => {
      const root = privateRoot();
      const dir = staleDir(root, "lisa-private", 0o700);
      const file = staleFile(root, "lisa-readable.txt", 0o644);
      const result = await sweepRoot(root);
      expect(result.removed).toEqual([dir, file]);
      expect(result.skippedUnsafe).toBe(0);
    });
  }
);

describe("git checkouts one level down", () => {
  it("keeps a stale folder whose direct child is a git checkout", async () => {
    const root = privateRoot();
    const holder = staleDir(root, "lisa-4316-workspace");
    fs.mkdirSync(path.join(holder, "repo", ".git"), { recursive: true });
    fs.utimesSync(holder, STALE, STALE);
    expect((await sweepRoot(root)).removed).toEqual([]);
    expect(fs.existsSync(path.join(holder, "repo", ".git"))).toBe(true);
  });

  it("keeps a stale folder whose children cannot be listed", async () => {
    const root = privateRoot();
    const sealed = staleDir(root, "lisa-sealed", 0o300);
    try {
      expect((await sweepRoot(root)).removed).toEqual([]);
      expect(fs.existsSync(sealed)).toBe(true);
    } finally {
      fs.chmodSync(sealed, 0o700);
    }
  });

  it("still removes a stale folder whose children hold no checkout", async () => {
    const root = privateRoot();
    const plain = staleDir(root, "lisa-plain");
    fs.mkdirSync(path.join(plain, "child"));
    fs.utimesSync(plain, STALE, STALE);
    expect((await sweepRoot(root)).removed).toEqual([plain]);
  });
});

describe("rollback copies", () => {
  it("never sweeps a `lisa apply` backup", async () => {
    expect(LISA_PROTECTED_TEMP_PREFIXES).toContain("lisa-backup-");
    expect(isLisaOwnedTempName("lisa-backup-Ab12Cd")).toBe(false);
    const root = privateRoot();
    const backup = staleDir(root, "lisa-backup-Ab12Cd");
    expect((await sweepRoot(root)).removed).toEqual([]);
    expect(fs.existsSync(backup)).toBe(true);
  });
});

describe("root refusal", () => {
  it.each([
    ["the filesystem root", "/"],
    ["the home directory", "HOME"],
    ["an ancestor of the home directory", "HOME_PARENT"],
  ])("refuses %s and sweeps nothing", async (_label, which) => {
    const base = privateRoot();
    const home = path.join(base, "home", "me");
    const cwd = path.join(base, "work", "repo");
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });
    const stale = staleDir(path.join(base, "home"), "lisa-would-go");
    const root = {
      "/": "/",
      HOME: home,
      HOME_PARENT: path.join(base, "home"),
    }[which] as string;
    const result = await sweepRoot(root, { home, cwd });
    expect(result.removed).toEqual([]);
    expect(result.errors).toEqual([
      expect.stringMatching(/refusing to sweep/u),
    ]);
    expect(fs.existsSync(stale)).toBe(true);
  });

  it("sweeps an ancestor of the working directory but keeps the entry holding it", async () => {
    const root = privateRoot();
    const holder = staleDir(root, "lisa-agent-worktree");
    const cwd = path.join(holder, "repo", "src");
    fs.mkdirSync(cwd, { recursive: true });
    fs.utimesSync(holder, STALE, STALE);
    const other = staleDir(root, "lisa-other-old");
    const result = await sweepRoot(root, {
      home: path.join(privateRoot(), "home"),
      cwd,
    });
    expect(result.errors).toEqual([]);
    expect(result.removed).toEqual([other]);
    expect(fs.existsSync(holder)).toBe(true);
  });

  it("sweeps a root that is neither", async () => {
    const root = privateRoot();
    const stale = staleDir(root, "lisa-fine");
    const result = await sweepRoot(root, {
      home: path.join(privateRoot(), "home"),
      cwd: path.join(privateRoot(), "repo"),
    });
    expect(result.removed).toEqual([stale]);
  });
});
