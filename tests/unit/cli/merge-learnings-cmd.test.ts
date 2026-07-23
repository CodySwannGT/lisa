/**
 * Process-boundary behaviour of the `lisa merge-learnings` git merge driver.
 *
 * The driver's exit code IS the merge verdict: exit 0 tells git the merge is
 * CLEAN and to accept `%A` verbatim as a completed commit. So any path that
 * returns 0 without a correct union publishes silent data loss — there is no
 * conflict marker, no stderr, and no second chance.
 *
 * The merge base is the load-bearing input: without it the union degrades to a
 * two-way merge that cannot tell "the other branch never had this entry" from
 * "the other branch superseded it", and resurrects consolidated entries.
 */
import * as fs from "fs-extra";
import { readFile } from "node:fs/promises";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMergeLearnings } from "../../../src/cli/merge-learnings-cmd.js";
import {
  renderLearningsFile,
  type LearningEntry,
} from "../../../src/core/learnings.js";

const LEDGER_PATH = ".lisa/PROJECT_LEARNINGS.md";
const SHARED = "shared";
const FROM_OURS = "from-ours";
const FROM_THEIRS = "from-theirs";

/**
 * Build one valid entry.
 * @param id - Stable entry id
 * @returns Valid learning entry
 */
function entry(id: string): LearningEntry {
  return {
    id,
    rule: `Rule for ${id}.`,
    why: `Why for ${id}.`,
    provenance: [`issue:#${id}`],
    first_learned: "2026-07-16",
    last_confirmed: "2026-07-16",
    confidence: "high",
  };
}

/**
 * Render a canonical ledger from ids.
 * @param ids - Entry ids
 * @returns Canonical document
 */
function ledger(ids: readonly string[]): string {
  return renderLearningsFile(
    [...ids].sort((left, right) => left.localeCompare(right)).map(entry)
  );
}

describe("runMergeLearnings", () => {
  let dir: string;
  let base: string;
  let ours: string;
  let theirs: string;
  let errors: string[];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-merge-cmd-"));
    base = path.join(dir, "base");
    ours = path.join(dir, "ours");
    theirs = path.join(dir, "theirs");
    errors = [];
  });

  afterEach(async () => {
    await fs.remove(dir);
  });

  /**
   * Read the ids the driver published into `%A`.
   * @returns Entry ids written to the ours file
   */
  async function publishedIds(): Promise<readonly string[]> {
    const content = await readFile(ours, "utf8");
    return content
      .split("\n")
      .filter(line => line.startsWith("{"))
      .map(line => (JSON.parse(line) as LearningEntry).id);
  }

  it("unions and exits zero on a clean merge", async () => {
    await fs.writeFile(base, ledger([SHARED]));
    await fs.writeFile(ours, ledger([SHARED, FROM_OURS]));
    await fs.writeFile(theirs, ledger([SHARED, FROM_THEIRS]));
    const code = await runMergeLearnings(
      { base, ours, theirs, path: LEDGER_PATH },
      { error: message => errors.push(message) }
    );
    expect(code).toBe(0);
    expect(await publishedIds()).toEqual([FROM_OURS, FROM_THEIRS, SHARED]);
  });

  describe("when the merge base was supplied but cannot be read", () => {
    // Reachable in production: ERR_STRING_TOO_LONG on an oversized base,
    // EACCES, ENOMEM, or EMFILE/ENFILE exhaustion under exactly the parallel
    // worktree merges this driver exists to serve.

    beforeEach(async () => {
      await fs.writeFile(base, ledger(["keep", "stale"]));
      // Our branch consolidated `stale` away; theirs never saw the removal.
      await fs.writeFile(ours, ledger(["keep", "consolidated"]));
      await fs.writeFile(theirs, ledger(["keep", "stale", FROM_THEIRS]));
      await fs.remove(base);
    });

    it("fails closed instead of silently degrading to a two-way union", async () => {
      const code = await runMergeLearnings(
        { base, ours, theirs, path: LEDGER_PATH },
        { error: message => errors.push(message) }
      );
      expect(code).toBe(1);
    });

    it("explains why on stderr", async () => {
      await runMergeLearnings(
        { base, ours, theirs, path: LEDGER_PATH },
        { error: message => errors.push(message) }
      );
      expect(errors.join("\n")).toMatch(/merge base/i);
    });

    it("does not resurrect the superseded entry into the published file", async () => {
      await runMergeLearnings(
        { base, ours, theirs, path: LEDGER_PATH },
        { error: message => errors.push(message) }
      );
      expect(await publishedIds()).not.toContain("stale");
    });
  });

  it("still treats an omitted base flag as a genuinely new file", async () => {
    // git supplies %O for a real merge; its absence here means the caller did
    // not pass one, which legitimately means "new on both sides".
    await fs.writeFile(ours, ledger([FROM_OURS]));
    await fs.writeFile(theirs, ledger([FROM_THEIRS]));
    const code = await runMergeLearnings(
      { ours, theirs },
      { error: message => errors.push(message) }
    );
    expect(code).toBe(0);
    expect(await publishedIds()).toEqual([FROM_OURS, FROM_THEIRS]);
  });

  it("treats an empty base file as a genuinely new file", async () => {
    // git materializes %O as an empty file when the path is added on both
    // sides — readable and empty, which is different from unreadable.
    await fs.writeFile(base, "");
    await fs.writeFile(ours, ledger([FROM_OURS]));
    await fs.writeFile(theirs, ledger([FROM_THEIRS]));
    const code = await runMergeLearnings(
      { base, ours, theirs },
      { error: message => errors.push(message) }
    );
    expect(code).toBe(0);
    expect(await publishedIds()).toEqual([FROM_OURS, FROM_THEIRS]);
  });

  it("fails closed when our side cannot be read", async () => {
    await fs.writeFile(base, ledger([SHARED]));
    await fs.writeFile(theirs, ledger([SHARED]));
    const code = await runMergeLearnings(
      { base, ours, theirs },
      { error: message => errors.push(message) }
    );
    expect(code).toBe(1);
  });

  it("fails closed when their side cannot be read", async () => {
    await fs.writeFile(base, ledger([SHARED]));
    await fs.writeFile(ours, ledger([SHARED]));
    const code = await runMergeLearnings(
      { base, ours, theirs },
      { error: message => errors.push(message) }
    );
    expect(code).toBe(1);
  });

  it("leaves our file untouched when the merge conflicts", async () => {
    await fs.writeFile(base, ledger([SHARED]));
    await fs.writeFile(
      ours,
      renderLearningsFile([{ ...entry(SHARED), rule: "Our rewrite." }])
    );
    await fs.writeFile(
      theirs,
      renderLearningsFile([{ ...entry(SHARED), rule: "Their rewrite." }])
    );
    const before = await readFile(ours, "utf8");
    const code = await runMergeLearnings(
      { base, ours, theirs },
      { error: message => errors.push(message) }
    );
    expect(code).toBe(1);
    expect(await readFile(ours, "utf8")).toBe(before);
  });
});
