/**
 * A placeholder cannot outlive its stated unblocking condition.
 *
 * The gate inventory recorded the on-edit hooks at `pre-tool` under a comment
 * that named its own expiry — "blocked on the registry gaining `post-tool`".
 * A later pull request added that moment, which satisfied the condition and
 * falsified the placeholder's premise in the same commit, and nothing failed.
 * The shipped CLI then reported a moment those scripts do not fire at.
 *
 * This suite proves the mechanism BITES rather than merely existing: the
 * checker is exercised against synthetic sources whose conditions have and
 * have not arrived, so a zero-finding sweep over the real tree is a
 * measurement rather than a suite that quietly stopped running.
 *
 * @module tests/unit/scripts/placeholder-expiry
 */

import * as fs from "fs-extra";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  MOMENTS,
  REGISTRY,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  expiredPlaceholders,
  isWellFormedKey,
  PLACEHOLDER_MARKER,
  placeholderKeys,
} from "../../../all/copy-overwrite/scripts/lib/placeholder-expiry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The shipped script tree a consumer installs. */
const SHIPPED_SCRIPTS = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  "scripts"
);

/**
 * Every executable condition a shipped placeholder may name.
 *
 * A key with no entry here fails the sweep. That is deliberate: a value
 * declared provisional on a condition nobody can evaluate is the prose
 * situation with extra ceremony.
 *
 * `registry-has-post-tool` is kept after its placeholder was retired, as the
 * worked example. It returns true today, so re-introducing that marker
 * anywhere fails immediately rather than waiting for a reviewer to notice.
 */
const CONDITIONS: Readonly<Record<string, () => boolean>> = Object.freeze({
  "registry-has-post-tool": (): boolean =>
    (MOMENTS as string[]).includes("post-tool") &&
    (REGISTRY as Record<string, { moments: string[] }>)[
      "code-style"
    ]?.moments.includes("post-tool") === true,
});

/**
 * Every shipped `.mjs` under the installed script tree, with its contents.
 * @returns One entry per file.
 */
const shippedSources = (): { file: string; source: string }[] => {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith(".mjs") ? [full] : [];
    });
  return walk(SHIPPED_SCRIPTS).map(file => ({
    file: path.relative(REPO_ROOT, file),
    source: fs.readFileSync(file, "utf8"),
  }));
};

describe("placeholderKeys", () => {
  it("reads the condition a marker names", () => {
    expect(
      placeholderKeys(`  // ${PLACEHOLDER_MARKER} registry-has-post-tool\n`)
    ).toEqual(["registry-has-post-tool"]);
  });

  it("finds nothing in a source that declares nothing", () => {
    expect(placeholderKeys("const answer = 42;\n")).toEqual([]);
  });
});

describe("expiredPlaceholders", () => {
  it("fails a placeholder whose condition has arrived", () => {
    const { expired, unchecked } = expiredPlaceholders({
      files: [{ file: "demo.mjs", source: `// ${PLACEHOLDER_MARKER} arrived` }],
      conditions: { arrived: () => true },
    });

    expect(expired).toEqual([{ file: "demo.mjs", key: "arrived" }]);
    expect(unchecked).toEqual([]);
  });

  it("leaves a placeholder alone while its condition has not arrived", () => {
    // The other direction. Without it the checker could satisfy the test above
    // by failing everything, which would make the sweep unusable and get it
    // deleted.
    const { expired } = expiredPlaceholders({
      files: [{ file: "demo.mjs", source: `// ${PLACEHOLDER_MARKER} waiting` }],
      conditions: { waiting: () => false },
    });

    expect(expired).toEqual([]);
  });

  it("refuses a condition nothing can evaluate", () => {
    const { expired, unchecked } = expiredPlaceholders({
      files: [{ file: "demo.mjs", source: `// ${PLACEHOLDER_MARKER} unknown` }],
      conditions: {},
    });

    expect(unchecked).toEqual([{ file: "demo.mjs", key: "unknown" }]);
    expect(expired).toEqual([]);
  });
});

describe("a token that only STARTS like a key", () => {
  it("keeps trailing punctuation, so the marker cannot borrow a real key", () => {
    // `PLACEHOLDER-UNTIL: ready!` used to capture `ready`. A predicate named
    // `ready` then answered for a marker nobody wrote, and when it answered
    // `false` the marker produced neither `expired` nor `unchecked` — it
    // passed the gate in silence, which is the fail-open shape this module
    // exists to close.
    const { expired, unchecked } = expiredPlaceholders({
      files: [{ file: "demo.mjs", source: `// ${PLACEHOLDER_MARKER} ready!` }],
      conditions: { ready: () => false },
    });

    expect(expired).toEqual([]);
    expect(unchecked).toEqual([{ file: "demo.mjs", key: "ready!" }]);
  });

  it("keeps an over-long token long enough to be rejected", () => {
    // Cutting the capture at the longest LEGAL key turns any longer token into
    // a valid-looking one. The bound is one character higher for that reason.
    const long = "a".repeat(80);
    const { expired, unchecked } = expiredPlaceholders({
      files: [{ file: "demo.mjs", source: `// ${PLACEHOLDER_MARKER} ${long}` }],
      conditions: {},
    });

    expect(expired).toEqual([]);
    expect(unchecked).toHaveLength(1);
    expect(unchecked[0].key.length).toBeGreaterThan(64);
    expect(isWellFormedKey(unchecked[0].key)).toBe(false);
  });

  it("still reads a well-formed key ending at whitespace or end of line", () => {
    expect(placeholderKeys(`// ${PLACEHOLDER_MARKER} ready`)).toEqual([
      "ready",
    ]);
    expect(
      placeholderKeys(`// ${PLACEHOLDER_MARKER} ready and then more`)
    ).toEqual(["ready"]);
  });
});

describe("the shipped script tree", () => {
  it("carries no placeholder whose condition has arrived", () => {
    const { expired, unchecked } = expiredPlaceholders({
      files: shippedSources(),
      conditions: CONDITIONS,
    });

    expect(expired).toEqual([]);
    expect(unchecked).toEqual([]);
  });

  it("would fail if the retired post-tool placeholder came back", () => {
    // The worked example, run against the real predicate rather than a stub:
    // the condition the retired placeholder waited for is satisfied TODAY, so
    // reintroducing the marker fails at once. This is what turns a currently
    // empty sweep into a measurement.
    const { expired } = expiredPlaceholders({
      files: [
        {
          file: "would-be-lisa-gates.mjs",
          source: `// ${PLACEHOLDER_MARKER} registry-has-post-tool`,
        },
      ],
      conditions: CONDITIONS,
    });

    expect(expired).toEqual([
      { file: "would-be-lisa-gates.mjs", key: "registry-has-post-tool" },
    ]);
  });
});
