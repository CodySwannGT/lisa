/**
 * Proves no tracked source file carries a raw NUL byte.
 *
 * A NUL is not merely ugly: it makes the file INVISIBLE to the searches an
 * audit actually runs, and visible to the ones it does not. Measured against
 * the one source file that carried two of them:
 *
 * ```
 * rg <pattern> <that file>   -> 23 matches
 * rg <pattern> <its dir>/    -> silence
 * grep -r <pattern> <dir>/   -> silence
 * rg --text <pattern> <dir>/ -> 23 matches
 * ```
 *
 * Directory-mode search sniffs for a NUL, decides the file is binary, and skips
 * it WITHOUT saying so; file-mode search reads it fine. So the same tool gives
 * two different answers depending on how it was invoked, and the silent form is
 * the one a codebase sweep uses. Several sweeps reported "clean" on searches
 * that never opened the file.
 *
 * The escape (`\u0000`) is byte-for-byte equivalent at runtime and costs
 * nothing, so there is no case in which a source file needs the raw byte.
 *
 * Scoped to source: genuine binaries are excluded by extension, and the scan
 * asserts its own reach so a narrowed filter cannot pass by examining nothing.
 *
 * @module tests/integration/tracked-source-nul-bytes
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Pinned git binary — resolving `git` via $PATH trips no-os-command-from-path. */
const GIT_BIN = "/usr/bin/git";

/**
 * Extensions whose files are legitimately binary.
 *
 * A denylist rather than a source allowlist, deliberately: a new source
 * extension nobody listed would otherwise be skipped silently, which is the
 * same "reported clean without looking" failure this test exists to catch. A
 * new BINARY extension merely trips the test once and is added here on
 * purpose.
 */
const BINARY_EXTENSIONS = new Set([
  ".bin",
  ".class",
  ".dll",
  ".dylib",
  ".eot",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jks",
  ".jpeg",
  ".jpg",
  ".keystore",
  ".mov",
  ".mp3",
  ".mp4",
  ".otf",
  ".p12",
  ".pdf",
  ".png",
  ".so",
  ".tgz",
  ".ttf",
  ".wasm",
  ".wav",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);

/** The byte under test, never written literally into this file. */
const NUL = String.fromCharCode(0);

/**
 * Every file git tracks, as repo-relative paths.
 * @returns The tracked paths.
 */
function trackedFiles(): string[] {
  // -z, because a path may contain a newline and a split on "\n" would then
  // invent two paths that do not exist and miss the one that does.
  return execFileSync(GIT_BIN, ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
}

/**
 * The tracked files this test is responsible for reading.
 * @returns Repo-relative paths, binaries removed.
 */
function scannedFiles(): string[] {
  return trackedFiles().filter(
    file => !BINARY_EXTENSIONS.has(path.extname(file).toLowerCase())
  );
}

/**
 * The offender predicate itself, with reading injected.
 *
 * Extracted so the control case can drive THIS function rather than a
 * hand-rolled `includes` beside it. A control that re-implements the predicate
 * proves the re-implementation works and says nothing about the one in use:
 * mutate the real predicate to return no offenders and such a control still
 * passes, which is the failure mode this whole file exists to catch.
 * @param files Repo-relative paths to examine.
 * @param read How to obtain a file's bytes as a latin1 string.
 * @returns The subset carrying a raw NUL.
 */
function nulOffenders(
  files: readonly string[],
  read: (file: string) => string
): string[] {
  return files.filter(file => read(file).includes(NUL));
}

/**
 * Reads a tracked file as bytes, one char per byte.
 * @param file Repo-relative path.
 * @returns The file's contents.
 */
function readTracked(file: string): string {
  return readFileSync(path.join(REPO_ROOT, file), "latin1");
}

describe("🕳️ raw NUL bytes in tracked source", () => {
  it("scans essentially every tracked file, so a clean result means something", () => {
    const tracked = trackedFiles();
    const scanned = scannedFiles();

    // Anti-vacuity. Without this the whole suite passes if the filter starts
    // excluding everything — a green check that read no files at all.
    expect(tracked.length).toBeGreaterThan(1000);
    expect(scanned.length).toBeGreaterThan(tracked.length * 0.95);
  });

  it("includes .mjs scripts in the scan", () => {
    // The one file that carried the byte was a shipped .mjs. If the filter
    // ever stops covering that extension, the regression returns unobserved.
    const scanned = scannedFiles();

    expect(
      scanned.some(file => file.endsWith(".mjs")),
      "the scan must cover .mjs sources"
    ).toBe(true);
    expect(scanned).toContain(
      "typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs"
    );
  });

  it("finds no raw NUL byte in any tracked source file", () => {
    const offenders = nulOffenders(scannedFiles(), readTracked);

    expect(
      offenders,
      `These tracked source files contain a raw NUL byte, which makes them ` +
        `invisible to recursive grep/rg. Write it as the \\u0000 escape ` +
        `instead — the runtime string is identical.\n${offenders.join("\n")}`
    ).toEqual([]);
  });

  it("still reports a source file that does carry one", () => {
    // Bite control, driving the SAME predicate the scan uses. Without it,
    // "no offenders" is indistinguishable from a predicate that can never be
    // true — and a mutation returning `[]` would pass every other case here.
    const offenders = nulOffenders(
      ["carries-one.mjs"],
      () => `const separator = "a${NUL}b";\n`
    );

    expect(offenders).toEqual(["carries-one.mjs"]);
  });

  it("does not report the escape that replaces it", () => {
    // The other half of the control: the fix must not merely move the byte.
    const offenders = nulOffenders(
      ["carries-the-escape.mjs"],
      () => "const separator = `a\\u0000b`;\n"
    );

    expect(offenders).toEqual([]);
  });
});
