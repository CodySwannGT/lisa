/**
 * Tests for worktree ownership receipts (CodySwannGT/lisa#2993).
 *
 * The receipt is the only positive ownership evidence the cleaner has, so the
 * cases that matter are the ones where it is absent, damaged, or names somebody
 * else — every one of which must resolve AGAINST deletion.
 * @module tests/unit/cli/worktree-ownership
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  judgeOwnership,
  OWNER_RECEIPT_FILENAME,
  ownerReceiptPath,
  readOwnerReceipt,
  resolveCallerOwnerId,
  writeOwnerReceipt,
} from "../../../src/cli/worktree-ownership.js";

/**
 * Create a throwaway admin directory.
 * @returns Absolute directory path
 */
async function scratchAdminDirectory(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "lisa-owner-"));
}

describe("judgeOwnership", () => {
  it("calls a matching receipt mine", () => {
    expect(judgeOwnership("agent-a", "agent-a")).toBe("mine");
  });

  it("calls a receipt naming somebody else theirs", () => {
    expect(judgeOwnership("agent-a", "agent-b")).toBe("theirs");
  });

  it("calls a receipt theirs when the caller has no id of its own", () => {
    expect(judgeOwnership("agent-a", undefined)).toBe("theirs");
  });

  it("calls an absent or empty receipt unclaimed", () => {
    expect(judgeOwnership(undefined, "agent-a")).toBe("unclaimed");
    expect(judgeOwnership("", "agent-a")).toBe("unclaimed");
  });
});

describe("resolveCallerOwnerId", () => {
  it("prefers the explicit Lisa owner id", () => {
    expect(
      resolveCallerOwnerId({
        LISA_OWNER_ID: "explicit",
        CLAUDE_SESSION_ID: "session",
      })
    ).toBe("explicit");
  });

  it("falls back to the runtime session id", () => {
    expect(resolveCallerOwnerId({ CODEX_SESSION_ID: "codex-1" })).toBe(
      "codex-1"
    );
  });

  it("treats a blank value as no id at all", () => {
    expect(resolveCallerOwnerId({ LISA_OWNER_ID: "   " })).toBeUndefined();
  });

  it("returns undefined when no runtime supplied one", () => {
    expect(resolveCallerOwnerId({})).toBeUndefined();
  });
});

describe("worktree ownership receipts", () => {
  it("round-trips a claim through the admin directory", async () => {
    const admin = await scratchAdminDirectory();
    const written = await writeOwnerReceipt(admin, "agent-a");
    expect(written).toBe(ownerReceiptPath(admin));
    expect(path.basename(written)).toBe(OWNER_RECEIPT_FILENAME);
    expect(await readOwnerReceipt(admin)).toBe("agent-a");
  });

  it("records when the claim was made", async () => {
    const admin = await scratchAdminDirectory();
    await writeOwnerReceipt(admin, "agent-a", () => new Date(0));
    const raw = JSON.parse(
      await readFile(ownerReceiptPath(admin), "utf8")
    ) as Record<string, unknown>;
    expect(raw["claimedAt"]).toBe("1970-01-01T00:00:00.000Z");
  });

  it("reads an absent receipt as unclaimed rather than throwing", async () => {
    const admin = await scratchAdminDirectory();
    expect(await readOwnerReceipt(admin)).toBeUndefined();
  });

  it("reads a corrupt receipt as unclaimed rather than as an owner", async () => {
    const admin = await scratchAdminDirectory();
    await writeFile(ownerReceiptPath(admin), "{not json", "utf8");
    expect(await readOwnerReceipt(admin)).toBeUndefined();
  });

  it("reads a receipt with no owner id as unclaimed", async () => {
    const admin = await scratchAdminDirectory();
    await writeFile(ownerReceiptPath(admin), '{"ownerId":""}', "utf8");
    expect(await readOwnerReceipt(admin)).toBeUndefined();
  });
});
