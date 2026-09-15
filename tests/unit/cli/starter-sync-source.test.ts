import { describe, expect, it, vi } from "vitest";
import { readStarterChanges } from "../../../src/cli/starter-sync-source.js";
import type { StarterTemplate } from "../../../src/core/project-config-starter.js";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const BASE_TREE = "c".repeat(40);
const HEAD_TREE = "d".repeat(40);
const OLD_BLOB = "e".repeat(40);
const NEW_BLOB = "f".repeat(40);
const REGULAR = "100644";
const LINT = "rules/lint.txt";
const REMOVED = "removed.txt";
const template: StarterTemplate = {
  repo: "example/starter",
  ref: "main",
  lastSync: { sha: BASE, at: "2026-09-15T00:00:00Z" },
};

/**
 * Model immutable API responses without allowing remote writes.
 * @param options - Completeness and same-revision scenarios.
 * @param options.same - Whether the tracked head equals the baseline.
 * @param options.truncated - Whether the remote tree is incomplete.
 * @returns Read-only command double.
 */
function reader(options: { same?: boolean; truncated?: boolean } = {}) {
  const old = [
    { path: LINT, mode: REGULAR, type: "blob", sha: OLD_BLOB },
    { path: REMOVED, mode: REGULAR, type: "blob", sha: OLD_BLOB },
    {
      path: ".opencode/commands/lisa:sync.md",
      mode: REGULAR,
      type: "blob",
      sha: OLD_BLOB,
    },
  ];
  const next = [
    { path: LINT, mode: "100755", type: "blob", sha: NEW_BLOB },
    { path: "added.txt", mode: REGULAR, type: "blob", sha: NEW_BLOB },
    {
      path: ".opencode/commands/lisa:sync.md",
      mode: REGULAR,
      type: "blob",
      sha: OLD_BLOB,
    },
  ];
  return vi.fn(async (command: string, args: readonly string[]) => {
    expect(command).toBe("gh");
    expect(args[0]).toBe("api");
    const endpoint = args[1];
    if (endpoint?.endsWith("/commits/main")) {
      return `${options.same ? BASE : HEAD}\t${HEAD_TREE}`;
    }
    if (endpoint?.endsWith(`/git/commits/${BASE}`)) return BASE_TREE;
    if (endpoint?.includes("/git/trees/")) {
      return JSON.stringify({
        truncated: options.truncated ?? false,
        tree: endpoint.includes(BASE_TREE) ? old : next,
      });
    }
    if (endpoint?.includes("/git/blobs/")) {
      const bytes = Buffer.from(
        endpoint.endsWith(OLD_BLOB) ? "old\n\n" : "new\n\n"
      );
      return JSON.stringify({
        encoding: "base64",
        size: bytes.length,
        content: bytes.toString("base64"),
      });
    }
    throw new Error(`Unexpected read ${endpoint}`);
  });
}

describe("immutable starter revision reads", () => {
  it("captures additions, deletions, exact bytes and executable modes", async () => {
    const capture = reader();
    const result = await readStarterChanges(template, capture);
    expect(result.sha).toBe(HEAD);
    expect(result.changes.map(change => change.path)).toEqual([
      "added.txt",
      REMOVED,
      LINT,
    ]);
    expect(result.changes[0]).toEqual({
      path: "added.txt",
      after: { bytes: Buffer.from("new\n\n"), mode: REGULAR },
    });
    expect(result.changes[1]).toEqual({
      path: REMOVED,
      before: { bytes: Buffer.from("old\n\n"), mode: REGULAR },
    });
    expect(result.changes[2]?.after?.mode).toBe("100755");
    expect(
      capture.mock.calls.every(([, args]) => !args.includes("--method"))
    ).toBe(true);
  });

  it("does not fetch trees or blobs when the recorded revision is current", async () => {
    const capture = reader({ same: true });
    expect(await readStarterChanges(template, capture)).toEqual({
      sha: BASE,
      changes: [],
    });
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("limits changes to path boundaries before fetching blob contents", async () => {
    const capture = reader();
    const result = await readStarterChanges(
      { ...template, paths: ["rules"] },
      capture
    );
    expect(result.changes.map(change => change.path)).toEqual([LINT]);
    expect(
      capture.mock.calls.filter(([, args]) => args[1]?.includes("/git/blobs/"))
        .length
    ).toBe(2);
  });

  it("refuses a truncated tree rather than reporting a partial diff", async () => {
    await expect(
      readStarterChanges(template, reader({ truncated: true }))
    ).rejects.toThrow(/truncated/i);
  });

  it.each(["../outside", "/absolute", "rules/../outside", "C:\\outside"])(
    "rejects unsafe configured scope %s before remote reads",
    async scope => {
      const capture = reader();
      await expect(
        readStarterChanges({ ...template, paths: [scope] }, capture)
      ).rejects.toThrow(/path/i);
      expect(capture).not.toHaveBeenCalled();
    }
  );
});
