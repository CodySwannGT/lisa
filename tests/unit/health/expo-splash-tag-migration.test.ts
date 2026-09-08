/**
 * Renaming the splash plugin's idempotency marker migrates rather than
 * duplicates (CodySwannGT/lisa#3536).
 *
 * ## The defect
 *
 * `mergeContents` finds a block by its exact tag and INSERTS when it does not
 * find one. The tag lived in a bare constant in a copy-overwrite file, so
 * upstream could move it while a consumer held native sources generated under
 * the old value — and the next prebuild appended a SECOND block instead of
 * matching the first. That is the unconditional-insert case the tag was added
 * to prevent, reached by editing the tag itself.
 *
 * It is silent: the snippet is idempotent at runtime, so the build compiles and
 * behaves, accumulating one block per rename. A test asserting "did not throw"
 * passes against the defect and the fix alike, which is why every case here
 * asserts the BLOCK COUNT.
 *
 * ## What is real here and what is a stand-in
 *
 * `@expo/config-plugins` is not a dependency of this repository, so the end-to-
 * end leg drives a stand-in `mergeContents` written to its documented contract
 * (find `@generated begin <tag>` … `@generated end <tag>`, else insert at the
 * anchor). That stand-in proves the PLUGIN's behaviour around the helper; it
 * cannot prove the helper's own. The migration logic under test —
 * `stripPriorBlocks` — is the shipped function itself, driven directly against
 * marker text, so the part this ticket is about is not simulated.
 * @module tests/unit/health/expo-splash-tag-migration
 */
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

/** The plugin exports these cases drive. */
type SplashPlugin = {
  TAG: string;
  isPriorTag: (tag: string) => boolean;
  stripPriorBlocks: (contents: string) => {
    contents: string;
    retired: string[];
  };
};

/** Temp directories holding the CJS copy, removed when the suite ends. */
const loaded: string[] = [];

afterAll(() => {
  for (const dir of loaded.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/**
 * Load the shipped plugin under CommonJS semantics.
 *
 * The file is CommonJS, as every Expo config plugin is, but THIS repository
 * declares `"type": "module"`, so importing the `.js` directly fails here while
 * it works perfectly in the consumer projects it ships to. Copying the exact
 * bytes to a `.cjs` and requiring that runs the real shipped source, rather
 * than changing the file's module format to suit its own test — which would
 * break every consumer to make a test convenient.
 *
 * The Expo packages are not installed here and are deliberately not stubbed:
 * the migration logic depends on neither, and the plugin defers its `require`
 * until the mod actually runs. If that regressed to a top-level require, this
 * loader would fail loudly instead of quietly testing a stub.
 * @returns The plugin's exports
 */
function loadPlugin(): SplashPlugin {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-splash-plugin-"));
  const copy = path.join(dir, "withAndroidSplashNoClientExit.cjs");
  const shipped = path.resolve(
    "expo/copy-overwrite/plugins/withAndroidSplashNoClientExit.js"
  );
  loaded.push(dir);
  copyFileSync(shipped, copy);
  return createRequire(import.meta.url)(copy) as SplashPlugin;
}

const PLUGIN = loadPlugin();

const CURRENT = PLUGIN.TAG;
const PREVIOUS = "lisa-splash-no-exit-listener";
const ANCHOR = "    super.onCreate(null)";
const COMMENT = "    //";

/**
 * A generated block in the shape `mergeContents` writes.
 * @param tag - The marker tag
 * @param body - The block's payload line
 * @returns The block, newline-joined
 */
function block(tag: string, body = "    doTheThing()"): string {
  return [
    `${COMMENT} @generated begin ${tag} - expo1a2b3c4d`,
    body,
    `${COMMENT} @generated end ${tag}`,
  ].join("\n");
}

/**
 * A MainActivity carrying the given blocks after the anchor.
 * @param blocks - Generated blocks to embed
 * @returns Kotlin source
 */
function mainActivity(...blocks: string[]): string {
  return [
    "class MainActivity : ReactActivity() {",
    "  override fun onCreate(savedInstanceState: Bundle?) {",
    ANCHOR,
    ...blocks,
    "  }",
    "}",
    "",
  ].join("\n");
}

/**
 * How many generated blocks the source carries, by begin marker.
 * @param source - Kotlin source
 * @returns The count
 */
function blockCount(source: string): number {
  return (source.match(/@generated begin /g) ?? []).length;
}

/**
 * A stand-in for `@expo/config-plugins`' `mergeContents`, to its documented
 * contract: replace a block bearing this exact tag, else insert at the anchor.
 * @param source - Current source
 * @param tag - The tag to match and write
 * @returns The merged source
 */
function mergeContentsStandIn(source: string, tag: string): string {
  const lines = source.split("\n");
  const begin = lines.findIndex(line =>
    line.includes(`@generated begin ${tag} `)
  );
  if (begin >= 0) {
    const end = lines.findIndex(line => line.includes(`@generated end ${tag}`));
    return [...lines.slice(0, begin), block(tag), ...lines.slice(end + 1)].join(
      "\n"
    );
  }
  const anchor = lines.findIndex(line => /super\.onCreate\(null\)/.test(line));
  if (anchor < 0) throw new Error("anchor not found");
  return [
    ...lines.slice(0, anchor + 1),
    block(tag),
    ...lines.slice(anchor + 1),
  ].join("\n");
}

/**
 * Apply the plugin's merge step the way the mod does: retire prior blocks,
 * then merge under the current tag.
 * @param source - Current source
 * @param tag - The tag being written this run
 * @returns The resulting source
 */
function apply(source: string, tag: string): string {
  return mergeContentsStandIn(PLUGIN.stripPriorBlocks(source).contents, tag);
}

describe("the marker's stable identity, not its exact tag, decides a match", () => {
  it("claims a block written under a previous tag in the family", () => {
    expect(PLUGIN.isPriorTag(PREVIOUS)).toBe(true);
  });

  it("never claims the tag it writes today", () => {
    // Retiring the current block would delete what mergeContents is about to
    // match, turning every run into a remove-then-insert.
    expect(PLUGIN.isPriorTag(CURRENT)).toBe(false);
  });

  it("never claims another plugin's block", () => {
    // The identity boundary. Without it `lisa-splash` prefixes everything and
    // this plugin deletes blocks it did not write.
    expect(PLUGIN.isPriorTag("lisa-splashdown-thing")).toBe(false);
    expect(PLUGIN.isPriorTag("expo-splash-screen")).toBe(false);
    expect(PLUGIN.isPriorTag("some-other-plugin")).toBe(false);
  });
});

describe("applying under a renamed tag leaves exactly one block", () => {
  it("migrates sources generated under a previous marker", () => {
    // The scenario the ticket is about. Against the unfixed plugin this is
    // TWO: the old block is invisible to the tag match, so a second is
    // appended.
    const generated = mainActivity(block(PREVIOUS));
    const applied = apply(generated, CURRENT);

    expect(blockCount(applied)).toBe(1);
    expect(applied).toContain(`@generated begin ${CURRENT} `);
    expect(applied).not.toContain(PREVIOUS);
  });

  it("does not insert a second block under the current marker", () => {
    const generated = mainActivity(block(CURRENT));

    expect(blockCount(apply(generated, CURRENT))).toBe(1);
  });

  it("inserts exactly once into sources that carry no block", () => {
    expect(blockCount(apply(mainActivity(), CURRENT))).toBe(1);
  });

  it("converges a consumer already carrying duplicates from this bug", () => {
    // A consumer that already ran the unfixed plugin holds one block per tag.
    // A fix that stopped the bleeding but matched only the first would leave
    // the other orphaned forever, so this asserts the count falls to one
    // rather than merely stopping at two.
    const damaged = mainActivity(block(PREVIOUS), block(CURRENT));

    expect(blockCount(damaged)).toBe(2);
    expect(blockCount(apply(damaged, CURRENT))).toBe(1);
  });

  it("retires several previous tags at once", () => {
    const damaged = mainActivity(
      block("lisa-splash-v1"),
      block("lisa-splash-v2"),
      block(CURRENT)
    );

    expect(blockCount(apply(damaged, CURRENT))).toBe(1);
  });

  it("is stable when applied repeatedly after a rename", () => {
    const once = apply(mainActivity(block(PREVIOUS)), CURRENT);

    expect(apply(once, CURRENT)).toBe(once);
  });
});

describe("retiring blocks does not become a licence to delete", () => {
  it("leaves another plugin's block untouched", () => {
    const foreign = block("expo-splash-screen", "    other()");
    const generated = mainActivity(foreign, block(PREVIOUS));
    const stripped = PLUGIN.stripPriorBlocks(generated);

    expect(stripped.contents).toContain(foreign);
    expect(stripped.retired).toEqual([PREVIOUS]);
  });

  it("keeps the file intact when a marker is never closed", () => {
    // An unterminated block would otherwise swallow everything after it.
    // Losing MainActivity to a truncated marker is far worse than leaving a
    // stale block in place, so this must fail closed.
    const truncated = [
      "class MainActivity : ReactActivity() {",
      `${COMMENT} @generated begin ${PREVIOUS} - expo1a2b3c4d`,
      "    doTheThing()",
      "}",
      "",
    ].join("\n");
    const stripped = PLUGIN.stripPriorBlocks(truncated);

    expect(stripped.contents).toBe(truncated);
    expect(stripped.retired).toEqual([]);
  });

  it("reports nothing retired when there is nothing of ours to retire", () => {
    const clean = mainActivity(block(CURRENT));

    expect(PLUGIN.stripPriorBlocks(clean).retired).toEqual([]);
    expect(PLUGIN.stripPriorBlocks(clean).contents).toBe(clean);
  });
});
