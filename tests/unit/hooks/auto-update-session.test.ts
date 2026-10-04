/**
 * The session-start Lisa auto-update, end to end over a fixture project
 * (CodySwannGT/lisa#4337).
 *
 * The two properties that matter most are negative: a dirty tree is never
 * touched, and an update that cannot be committed as its own commit is left
 * pending rather than mixed into the next feature commit.
 * @module tests/unit/hooks/auto-update-session.test
 */
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  autoUpdate,
  updateSubject,
} from "../../../plugins/src/base/hooks/auto-update.mjs";
import {
  APPLY,
  BUMP,
  COMMIT,
  LISA,
  NEW,
  OLD,
  fakeRunner,
  pendingMarker,
  project,
  seedLock,
  seedPendingMarker,
  sessionStart,
} from "../../helpers/auto-update-fixture.js";

/**
 * Whether any recorded command starts with a prefix.
 * @param seen - Recorded commands
 * @param prefix - Command prefix
 * @returns True when one ran
 */
function ran(seen: readonly string[], prefix: string): boolean {
  return seen.some(line => line.startsWith(prefix));
}

describe("auto-update: a session start", () => {
  it("updates, applies and commits on a clean feature branch", async () => {
    const root = project({});
    const { text, seen } = await sessionStart(root);
    expect(seen).toContain(`${BUMP} -D ${LISA}@${NEW}`);
    expect(ran(seen, APPLY)).toBe(true);
    expect(ran(seen, COMMIT)).toBe(true);
    expect(text).toContain(`Updated Lisa from ${OLD} to ${NEW}`);
    expect(text).toContain("abc1234");
    expect(pendingMarker(root)).toBeNull();
  });

  it("does nothing when Lisa is current", async () => {
    const { text, seen } = await sessionStart(project({ installed: NEW }));
    expect(text).toBe("");
    expect(ran(seen, BUMP)).toBe(false);
  });

  it("never touches a dirty tree", async () => {
    const { text, seen } = await sessionStart(project({}), {
      dirtyBefore: " M src/a.ts",
    });
    expect(ran(seen, BUMP)).toBe(false);
    expect(text).toContain("uncommitted changes");
  });

  it("does nothing at all when autoUpdate is false", async () => {
    const root = project({ config: { autoUpdate: false } });
    const { text, seen } = await sessionStart(root);
    expect(text).toBe("");
    expect(seen).toEqual([]);
  });

  it("never runs in CI", async () => {
    const { text, seen } = await sessionStart(project({}), {}, { CI: "true" });
    expect(text).toBe("");
    expect(seen).toEqual([]);
  });

  it("leaves the update pending on a deploy branch of a tracked project", async () => {
    const root = project({ config: { tracker: "github" } });
    const { text, seen } = await sessionStart(root, { branch: "main" });
    expect(ran(seen, COMMIT)).toBe(false);
    expect(pendingMarker(root)).toMatchObject({
      to: NEW,
      files: ["package.json", "bun.lock", ".lisa/apply-receipt.json"],
    });
    expect(text).toContain("NOT committed yet");
    expect(text).toContain("main is a deploy branch");
  });

  it("leaves the update pending, unstaged, when the commit is refused", async () => {
    const root = project({});
    const { text, seen } = await sessionStart(root, { commitWorks: false });
    expect(seen).toContain("git reset --quiet");
    expect(pendingMarker(root)?.to).toBe(NEW);
    expect(text).toContain("committing it failed");
  });

  it("reminds about a pending update instead of updating again", async () => {
    const root = project({});
    seedPendingMarker(root);
    const { text, seen } = await sessionStart(root, {
      dirtyBefore: " M package.json",
    });
    expect(text).toContain("still uncommitted");
    expect(ran(seen, BUMP)).toBe(false);
  });

  it("clears a pending marker whose files were committed", async () => {
    const root = project({ installed: NEW });
    seedPendingMarker(root);
    const { text } = await sessionStart(root);
    expect(text).toBe("");
    expect(pendingMarker(root)).toBeNull();
  });

  it("refuses to update through a node_modules link into another checkout", async () => {
    const other = project({});
    const root = mkdtempSync(path.join(tmpdir(), "lisa-auto-update-linked-"));
    mkdirSync(path.join(root, ".git"));
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "host", devDependencies: { [LISA]: OLD } })
    );
    symlinkSync(
      path.join(other, "node_modules"),
      path.join(root, "node_modules")
    );
    const { text, seen } = await sessionStart(root);
    expect(ran(seen, BUMP)).toBe(false);
    expect(text).toContain("link to another checkout");
  });

  it("reports a bump that did not install the target", async () => {
    const { text } = await sessionStart(project({}), { bumpWorks: false });
    expect(text).toContain("automatic update failed");
    expect(text).toContain(`installed ${OLD}, not ${NEW}`);
  });

  it("reports another session holding the lock", async () => {
    const root = project({});
    seedLock(root);
    const { run } = fakeRunner(root);
    const text = await autoUpdate({
      projectDir: root,
      env: {},
      nowMs: Date.now(),
      run,
      refresh: async () => NEW,
    });
    expect(text).toContain("another session is updating");
  });
});

describe("auto-update: Lisa updating itself", () => {
  it("bumps the caret floor with no template apply", async () => {
    const { text, seen } = await sessionStart(project({ self: true }), {
      subjects: ["feat: shipped"],
    });
    expect(seen).toContain(`${BUMP} -D ${LISA}@^${NEW}`);
    expect(ran(seen, APPLY)).toBe(false);
    expect(text).toContain("self-dependency");
  });

  it("reports unreadable release tags instead of failing silently", async () => {
    const { text, seen } = await sessionStart(project({ self: true }), {
      tagsReadable: false,
    });
    expect(text).toContain("release tags needed to check it could not be read");
    expect(ran(seen, BUMP)).toBe(false);
  });

  it("does not chase the release its own update cut", async () => {
    const { text, seen } = await sessionStart(project({ self: true }), {
      subjects: [
        `chore(release): ${NEW} [skip ci] [skip-cd]`,
        updateSubject(OLD),
      ],
    });
    expect(text).toBe("");
    expect(ran(seen, BUMP)).toBe(false);
  });
});
