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
import { resolveLearningsOverflowFile } from "../../../src/core/learnings-overflow.js";
import { mergeCopyContents } from "../../../src/strategies/copy-contents.js";

const DEFAULT_LEDGER = ".lisa/PROJECT_LEARNINGS.md";
/** A host-authored attribute Lisa must never clobber. */
const HOST_ATTRIBUTE = "*.png binary";
const HOST_AUTHORED = `${HOST_ATTRIBUTE}\n`;
const OWN = ".gitattributes";
const TEMPLATE = "all/copy-contents/.gitattributes";
const SHIPPED = [OWN, TEMPLATE] as const;

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

  it.each(SHIPPED)("%s binds the overflow to the union driver", async file => {
    // The overflow is written by the same concurrent learner passes on the same
    // per-fingerprint branches, so it has the ledger's exact merge problem and
    // must not be left on git's default text merge (CodySwannGT/lisa#1996).
    expect(await shipped(file)).toContain(
      buildLearningsAttributeLine(resolveLearningsOverflowFile(DEFAULT_LEDGER))
    );
  });

  it("all/copy-contents/.gitattributes is the canonical block and nothing else", async () => {
    // Whole-file equality, and only here. This file is what a host RECEIVES, so
    // anything Lisa leaves in it is something Lisa imposed on every consumer.
    expect(await shipped(TEMPLATE)).toBe(
      renderLearningsGitattributesBlock(DEFAULT_LEDGER)
    );
  });

  it("the repo's own .gitattributes OPENS with the canonical block, byte for byte", async () => {
    // Deliberately weaker than whole-file equality, and the difference is the
    // point. `ensure-learnings-gitattributes` rewrites the marked block
    // verbatim on every apply, so anything added INSIDE the markers is erased —
    // which is why the generated-artifact driver's mapping
    // (CodySwannGT/lisa#3084) sits after the END marker. Pinning the prefix
    // still catches every drift in the managed block, which is what this case
    // was for, while letting the source repository carry attributes that are
    // its own and are never shipped.
    expect(
      (await shipped(OWN)).startsWith(
        renderLearningsGitattributesBlock(DEFAULT_LEDGER)
      )
    ).toBe(true);
  });

  it("the repo's own .gitattributes maps the generated artifacts, outside the managed block", async () => {
    const contents = await shipped(OWN);
    const managed = renderLearningsGitattributesBlock(DEFAULT_LEDGER);
    const beyond = contents.slice(managed.length);
    expect(beyond).toContain(
      "src/core/upstream-evidence-manifest.ts merge=lisa-generated-artifact"
    );
    expect(beyond).toContain(
      "src/core/lisa-owned-hash-ledger.ts merge=lisa-generated-artifact"
    );
    // The template must not inherit it: these two paths exist only here.
    expect(await shipped(TEMPLATE)).not.toContain("lisa-generated-artifact");
  });

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
