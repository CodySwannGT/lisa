/**
 * Unit tests for the start-of-run cleanup sweep's temp-folder half and its
 * one-line report (CodySwannGT/lisa#4597).
 *
 * Every case sweeps a PRIVATE root built for it, never the machine's real
 * temp directory, and turns the process half off: the process half is
 * covered with an injected process table in the sibling
 * `lisa-cleanup-sweep-processes.test.ts`.
 * @module tests/unit/scripts/lisa-cleanup-sweep
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatSummary,
  isLisaOwnedTempName,
  LISA_OWNED_TEMP_PREFIXES,
  LISA_PROTECTED_TEMP_NAMES,
  main,
  parseSweepArgs,
  sweep,
} from "../../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep.mjs";

const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.parse("2026-11-07T12:00:00Z");
const roots: string[] = [];

/**
 * Make a private sweep root for one case.
 * @returns Absolute path of an empty directory
 */
function privateRoot(): string {
  const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-sweep-root-"));
  roots.push(root);
  return root;
}

/**
 * Create a directory under `root` whose mtime is `ageHours` before NOW.
 * @param root - Private sweep root
 * @param name - Entry name
 * @param ageHours - Age to back-date the entry to
 * @returns The entry's absolute path
 */
function agedDir(root: string, name: string, ageHours: number): string {
  const entry = path.join(root, name);
  // 0700, as `mkdtemp` makes it: the sweep skips anything group or other can open.
  fs.mkdirSync(entry, { mode: 0o700 });
  fs.writeFileSync(path.join(entry, "payload.txt"), "x");
  const when = new Date(NOW - ageHours * HOUR_MS);
  fs.utimesSync(entry, when, when);
  return entry;
}

/**
 * Sweep a private root with processes off.
 * @param root - Private sweep root
 * @param extra - Further options
 * @returns The sweep result
 */
function sweepRoot(root: string, extra: Record<string, unknown> = {}) {
  return sweep({ root, now: NOW, orphans: false, ...extra });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Lisa-owned temp names", () => {
  it("matches the lisa- and lisa. prefixes, including mktemp forms", () => {
    expect(LISA_OWNED_TEMP_PREFIXES).toEqual(["lisa-", "lisa."]);
    expect(isLisaOwnedTempName("lisa-npm-update-abc123")).toBe(true);
    expect(isLisaOwnedTempName("lisa-gate-coverage.Ab12Cd34")).toBe(true);
    expect(isLisaOwnedTempName("lisa.health.x1")).toBe(true);
  });

  it("refuses generic prefixes that only mean something inside a run root", () => {
    for (const name of ["node-abc", "worker-1", "state-x", "e2e-y", "wiki-z"]) {
      expect(isLisaOwnedTempName(name)).toBe(false);
    }
    expect(isLisaOwnedTempName("lisa")).toBe(false);
    expect(isLisaOwnedTempName("lisaother")).toBe(false);
    expect(isLisaOwnedTempName("other-lisa-x")).toBe(false);
  });

  it("never matches persistent state or a preserved patch backup", () => {
    for (const name of LISA_PROTECTED_TEMP_NAMES) {
      expect(isLisaOwnedTempName(name)).toBe(false);
    }
    expect(LISA_PROTECTED_TEMP_NAMES).toEqual(
      expect.arrayContaining([
        "lisa-scratch",
        "lisa-kill-marks",
        "lisa-team-enforce",
        "lisa-verification-gate",
      ])
    );
    expect(isLisaOwnedTempName("lisa-preserve-Xy12Ab")).toBe(false);
  });
});

describe("temp sweep selection", () => {
  it("removes a 25-hour Lisa folder and keeps a 1-hour one and a non-Lisa one", async () => {
    const root = privateRoot();
    const stale = agedDir(root, "lisa-sweep-demo-old", 25);
    const fresh = agedDir(root, "lisa-sweep-demo-new", 1);
    const foreign = agedDir(root, "other-sweep-demo-old", 25);
    const result = await sweepRoot(root);
    expect(result.removed).toEqual([stale]);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(foreign)).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("honours --max-age-hours", async () => {
    const root = privateRoot();
    const twoHours = agedDir(root, "lisa-two-hours", 2);
    const result = await sweepRoot(root, { maxAgeHours: 1 });
    expect(result.removed).toEqual([twoHours]);
  });

  it("also removes stale Lisa-owned FILES left by mktemp without -d", async () => {
    const root = privateRoot();
    const file = path.join(root, "lisa-pushed-refs.Ab12Cd34");
    fs.writeFileSync(file, "refs");
    const when = new Date(NOW - 30 * HOUR_MS);
    fs.utimesSync(file, when, when);
    expect((await sweepRoot(root)).removed).toEqual([file]);
  });

  it("keeps protected state and preserved backups whatever their age", async () => {
    const root = privateRoot();
    const kept = [
      ...LISA_PROTECTED_TEMP_NAMES.map(name => agedDir(root, name, 500)),
      agedDir(root, "lisa-preserve-Ab12Cd", 500),
    ];
    const result = await sweepRoot(root);
    expect(result.removed).toEqual([]);
    for (const entry of kept) expect(fs.existsSync(entry)).toBe(true);
  });

  it("keeps a stale folder that is a git checkout", async () => {
    const root = privateRoot();
    const checkout = agedDir(root, "lisa-4316-worktree", 48);
    fs.writeFileSync(path.join(checkout, ".git"), "gitdir: elsewhere\n");
    const when = new Date(NOW - 48 * HOUR_MS);
    fs.utimesSync(checkout, when, when);
    expect((await sweepRoot(root)).removed).toEqual([]);
    expect(fs.existsSync(checkout)).toBe(true);
  });

  it("refuses symlinks and never follows one out of the root", async () => {
    const root = privateRoot();
    const outside = privateRoot();
    const target = agedDir(outside, "lisa-target", 48);
    const link = path.join(root, "lisa-link-to-target");
    fs.symlinkSync(target, link);
    const when = new Date(NOW - 48 * HOUR_MS);
    fs.lutimesSync(link, when, when);
    expect((await sweepRoot(root)).removed).toEqual([]);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(target, "payload.txt"))).toBe(true);
  });

  it("selects at the top level only", async () => {
    const root = privateRoot();
    const parent = agedDir(root, "keeper", 48);
    const nested = agedDir(parent, "lisa-nested-old", 48);
    expect((await sweepRoot(root)).removed).toEqual([]);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it("reports what it would remove in a dry run and removes nothing", async () => {
    const root = privateRoot();
    const stale = agedDir(root, "lisa-dry-old", 48);
    const result = await sweepRoot(root, { dryRun: true });
    expect(result).toMatchObject({ dryRun: true, removed: [stale] });
    expect(fs.existsSync(stale)).toBe(true);
  });

  it("reports an unreadable root as an error instead of throwing", async () => {
    const missing = path.join(privateRoot(), "does-not-exist");
    const result = await sweepRoot(missing);
    expect(result.removed).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/does-not-exist/u);
  });
});

describe("summary line", () => {
  it("prints the one line the ticket specifies", () => {
    const line = formatSummary({
      removed: Array.from({ length: 37 }, (_, i) => `/t/lisa-${i}`),
      killed: [11, 12],
      errors: [],
      dryRun: false,
      durationMs: 412.4,
    });
    expect(line).toBe(
      "🧹 swept 37 stale temp dirs, 2 orphaned test processes (412 ms)"
    );
  });

  it("names entries kept as not private without calling them errors", () => {
    const line = formatSummary({
      removed: [],
      skippedUnsafe: 3,
      killed: [],
      errors: [],
      dryRun: false,
      durationMs: 5,
    });
    expect(line).toBe(
      "🧹 swept 0 stale temp dirs, 0 orphaned test processes (5 ms); kept 3 entries not private to this user"
    );
  });

  it("names errors and dry runs on the same single line", () => {
    const line = formatSummary({
      removed: ["/t/lisa-1"],
      killed: [],
      errors: ["boom", "bang"],
      dryRun: true,
      durationMs: 3,
    });
    expect(line).toBe(
      "🧹 would sweep 1 stale temp dir, 0 orphaned test processes (3 ms); 2 errors, first: boom"
    );
    expect(line).not.toContain("\n");
  });
});

describe("CLI", () => {
  it("parses --dry-run, --json and --max-age-hours in both spellings", () => {
    expect(
      parseSweepArgs(["--dry-run", "--json", "--max-age-hours", "6"])
    ).toEqual({ dryRun: true, json: true, maxAgeHours: 6, processes: true });
    expect(parseSweepArgs(["--no-processes"])).toMatchObject({
      processes: false,
    });
    expect(parseSweepArgs(["--max-age-hours=0.5"])).toEqual({
      dryRun: false,
      json: false,
      maxAgeHours: 0.5,
      processes: true,
    });
  });

  it("rejects an unknown flag or a bad age", () => {
    expect(() => parseSweepArgs(["--nope"])).toThrow(/--nope/u);
    expect(() => parseSweepArgs(["--max-age-hours", "-1"])).toThrow(
      /max-age-hours/u
    );
  });

  it("prints JSON with removed, killed, errors and durationMs, and exits 0", async () => {
    const root = privateRoot();
    const stale = agedDir(root, "lisa-cli-old", 48);
    const lines: string[] = [];
    const code = await main(["--json"], {
      sweepOptions: { root, now: NOW, orphans: false },
      write: line => lines.push(line),
    });
    expect(code).toBe(0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      removed: [stale],
      killed: [],
      errors: [],
      durationMs: expect.any(Number),
    });
  });

  it("leaves processes alone under --no-processes", async () => {
    const root = privateRoot();
    const lines: string[] = [];
    const listProcesses = vi.fn(() => []);
    const code = await main(["--json", "--no-processes"], {
      sweepOptions: { root, now: NOW, orphans: { listProcesses } },
      write: line => lines.push(line),
    });
    expect(code).toBe(0);
    expect(listProcesses).not.toHaveBeenCalled();
    expect(JSON.parse(lines[0] as string).killed).toEqual([]);
  });

  it("exits 2 with usage on a bad flag", async () => {
    const lines: string[] = [];
    const code = await main(["--bogus"], { write: line => lines.push(line) });
    expect(code).toBe(2);
    expect(lines.join("\n")).toMatch(/usage/iu);
  });
});
