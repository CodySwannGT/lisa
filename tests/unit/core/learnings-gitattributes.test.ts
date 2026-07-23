/**
 * The shipped `.gitattributes` files are the half of the merge driver that
 * lives in the repository. They are inert without a registered driver command,
 * but a drifted or missing attribute silently disables the union entirely — so
 * both the Lisa repository's own file and the host-project template are pinned
 * against the same constants the driver and installer use.
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GITATTRIBUTES_BEGIN_MARKER,
  GITATTRIBUTES_END_MARKER,
  LEARNINGS_MERGE_DRIVER_NAME,
  buildLearningsAttributeLine,
  renderLearningsGitattributesBlock,
} from "../../../src/core/learnings-merge-driver.js";
import { mergeCopyContents } from "../../../src/strategies/copy-contents.js";

const DEFAULT_LEDGER = ".lisa/PROJECT_LEARNINGS.md";
/** A host-authored attribute Lisa must never clobber. */
const HOST_ATTRIBUTE = "*.png binary";
const HOST_AUTHORED = `${HOST_ATTRIBUTE}\n`;
const SHIPPED = [".gitattributes", "all/copy-contents/.gitattributes"] as const;

/**
 * Read one shipped attributes file.
 * @param relative - Repo-relative path
 * @returns File contents
 */
async function shipped(relative: string): Promise<string> {
  return readFile(path.resolve(relative), "utf8");
}

describe("shipped .gitattributes", () => {
  it.each(SHIPPED)("%s binds the ledger to the union driver", async file => {
    expect(await shipped(file)).toContain(
      buildLearningsAttributeLine(DEFAULT_LEDGER)
    );
  });

  it.each(SHIPPED)(
    "%s matches the canonical rendered block exactly",
    async file => {
      expect(await shipped(file)).toBe(
        renderLearningsGitattributesBlock(DEFAULT_LEDGER)
      );
    }
  );

  it.each(SHIPPED)("%s carries the guardrail markers", async file => {
    const contents = await shipped(file);
    expect(contents).toContain(GITATTRIBUTES_BEGIN_MARKER);
    expect(contents).toContain(GITATTRIBUTES_END_MARKER);
  });

  it("preserves host-authored attributes when first applied", async () => {
    // copy-contents appends the marked block on first run, so a host project's
    // own attributes (LFS, linguist, eol) survive adoption.
    const merged = mergeCopyContents(
      renderLearningsGitattributesBlock(DEFAULT_LEDGER),
      HOST_AUTHORED
    );
    expect(merged).toContain(HOST_ATTRIBUTE);
    expect(merged).toContain(`merge=${LEARNINGS_MERGE_DRIVER_NAME}`);
  });

  it("replaces only its own block when Lisa's template changes", async () => {
    const adopted = mergeCopyContents(
      renderLearningsGitattributesBlock(DEFAULT_LEDGER),
      HOST_AUTHORED
    );
    const reapplied = mergeCopyContents(
      renderLearningsGitattributesBlock(".lisa/RELOCATED.md"),
      adopted
    );
    expect(reapplied).toContain(HOST_ATTRIBUTE);
    expect(reapplied).toContain(".lisa/RELOCATED.md merge=");
    expect(reapplied).not.toContain(`${DEFAULT_LEDGER} merge=`);
  });
});
