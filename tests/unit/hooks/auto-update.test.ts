/**
 * The session-start Lisa auto-update's decisions (CodySwannGT/lisa#4337),
 * tested as pure functions. The end-to-end runs live in
 * `auto-update-session.test.ts`.
 * @module tests/unit/hooks/auto-update.test
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  AUTO_UPDATE_DEFAULT,
  autoUpdateSetting,
  bumpCommand,
  choosePackageManager,
  commitDecision,
  envelope,
  lockIsAbandoned,
  onlyUpdateCommits,
  parsePorcelainZ,
  releaseLock,
  takeLock,
  updateMessage,
  updateSubject,
} from "../../../plugins/src/base/hooks/auto-update.mjs";
import { FEATURE, LISA, NEW, OLD } from "../../helpers/auto-update-fixture.js";

/** A bound work item. */
const ITEM = "o/r#1";
/** A project that requires a work item on every commit. */
const TRACKED = { tracker: "github" };
/** The lockfile Bun writes. */
const BUN_LOCK = "bun.lock";

/**
 * A fresh directory to hold a lock file.
 * @returns Absolute directory path
 */
function lockDir(): string {
  return mkdtempSync(path.join(tmpdir(), "lisa-auto-update-lock-"));
}

describe("auto-update: decisions", () => {
  it("is on unless the config, the environment or CI turns it off", () => {
    expect(AUTO_UPDATE_DEFAULT).toBe(true);
    expect(autoUpdateSetting({}, {}).on).toBe(true);
    expect(autoUpdateSetting({ autoUpdate: true }, {}).on).toBe(true);
    expect(autoUpdateSetting({ autoUpdate: false }, {}).on).toBe(false);
    expect(autoUpdateSetting({}, { CI: "true" }).on).toBe(false);
    expect(autoUpdateSetting({}, { LISA_AUTO_UPDATE: "0" }).on).toBe(false);
  });

  it("picks the package manager the way install-pkgs does", () => {
    expect(
      choosePackageManager({ packageManager: "pnpm@9.0.0" }, [BUN_LOCK])
    ).toBe("pnpm");
    expect(
      choosePackageManager({ engines: { bun: "please-use-npm" } }, [BUN_LOCK])
    ).toBe("npm");
    expect(choosePackageManager({}, ["yarn.lock"])).toBe("yarn");
    expect(choosePackageManager({}, [])).toBe("npm");
    expect(bumpCommand("bun", `^${NEW}`)).toEqual([
      "bun",
      "add",
      "-D",
      `${LISA}@^${NEW}`,
    ]);
  });

  it("commits at once on a feature branch with a bound item", () => {
    expect(
      commitDecision({ branch: FEATURE, config: TRACKED, boundRef: ITEM })
    ).toMatchObject({ commitNow: true, workItem: ITEM });
  });

  it("waits for a work item when the project requires one", () => {
    expect(
      commitDecision({ branch: FEATURE, config: TRACKED, boundRef: null })
        .commitNow
    ).toBe(false);
  });

  it("commits without a trailer when the project requires none", () => {
    expect(
      commitDecision({ branch: FEATURE, config: {}, boundRef: null })
    ).toMatchObject({ commitNow: true, workItem: null });
  });

  it("never commits on a deploy branch or a detached HEAD", () => {
    const declared = { deploy: { branches: { dev: "dev" } } };
    expect(
      commitDecision({ branch: "main", config: {}, boundRef: ITEM }).commitNow
    ).toBe(false);
    expect(
      commitDecision({ branch: "dev", config: declared, boundRef: null })
        .commitNow
    ).toBe(false);
    expect(
      commitDecision({ branch: "", config: {}, boundRef: null }).commitNow
    ).toBe(false);
  });

  it("treats a release carrying only update commits as the same release", () => {
    expect(
      onlyUpdateCommits([
        `chore(release): ${NEW} [skip ci] [skip-cd]`,
        updateSubject(NEW),
      ])
    ).toBe(true);
    expect(onlyUpdateCommits(["feat: something real"])).toBe(false);
  });

  it("writes one update commit, with the trailer only when there is one", () => {
    expect(updateMessage(OLD, NEW, ITEM)).toContain(`\n\nWork-Item: ${ITEM}\n`);
    expect(updateMessage(OLD, NEW, null)).not.toContain("Work-Item");
    expect(updateMessage(OLD, NEW, null).split("\n")[0]).toBe(
      updateSubject(NEW)
    );
  });

  it("reads status records without losing the leading space or a rename's source", () => {
    expect(
      parsePorcelainZ(" M package.json\0R  new.ts\0old.ts\0?? .lisa/x.json\0")
    ).toEqual(["package.json", "new.ts", "old.ts", ".lisa/x.json"]);
    // A rename flagged in the WORKTREE column carries its source the same way.
    expect(parsePorcelainZ(" R b.ts\0a.ts\0")).toEqual(["b.ts", "a.ts"]);
  });

  it("never reaps a lock whose owner is alive, and reaps one whose owner is gone", () => {
    const dir = lockDir();
    const lock = path.join(dir, "auto-update.lock");
    const now = Date.now();
    expect(takeLock(lock, now)).toBe(true);
    // Held by this live process: refused, however old the clock says it is.
    expect(takeLock(lock, now + 10 * 60 * 60 * 1000)).toBe(false);
    expect(lockIsAbandoned(lock, now + 10 * 60 * 60 * 1000)).toBe(false);
    releaseLock(lock);
    expect(existsSync(lock)).toBe(false);
    // A lock naming a process that no longer exists is reaped.
    writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 7, at: now }));
    expect(lockIsAbandoned(lock, now)).toBe(true);
    expect(takeLock(lock, now)).toBe(true);
  });

  it("keeps a lock whose owner cannot be read, and frees one that is gone", () => {
    const dir = lockDir();
    // A directory where the lock file should be: reading it fails with EISDIR,
    // which says nothing about the owner, so the lock stays protected.
    const unreadable = path.join(dir, "held.lock");
    mkdirSync(unreadable);
    expect(lockIsAbandoned(unreadable, Date.now() + 10 * 60 * 60 * 1000)).toBe(
      false
    );
    expect(lockIsAbandoned(path.join(dir, "missing.lock"), Date.now())).toBe(
      true
    );
  });

  it("never deletes a lock another session holds", () => {
    const dir = lockDir();
    const lock = path.join(dir, "auto-update.lock");
    writeFileSync(lock, JSON.stringify({ pid: process.ppid, at: Date.now() }));
    releaseLock(lock);
    expect(existsSync(lock)).toBe(true);
  });

  it("says nothing when there is nothing to say", () => {
    expect(envelope("", "SessionStart")).toBe("");
    expect(
      JSON.parse(envelope("x", "SessionStart")).hookSpecificOutput
        .additionalContext
    ).toBe("<lisa-auto-update>\nx\n</lisa-auto-update>");
  });
});
