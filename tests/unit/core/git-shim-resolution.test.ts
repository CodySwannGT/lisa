/**
 * No tracked source file may resolve git through Apple's `xcrun` shim.
 *
 * On macOS `/usr/bin/git` is not a git binary. It is `xcrun`, which locates a
 * developer directory and re-executes the real git there. Measured on this
 * machine with `git rev-parse --show-toplevel` — a call that does no work —
 * randomized call order, fixed inter-call gaps, n=30 per binary, load ~40:
 *
 * ```
 *                                                  median    p90    max
 * /usr/bin/git (xcrun shim)                          33ms  100ms  126ms
 * /Library/Developer/CommandLineTools/usr/bin/git     15ms   21ms   34ms
 * /Applications/Xcode.app/.../usr/bin/git             15ms   26ms   40ms
 * /opt/homebrew/bin/git                               17ms   33ms   59ms
 * ```
 *
 * #2889 fixed two call sites by hand and 50 others kept the shim, so this file
 * exists instead of a third hand-fix. The roster is derived from `git ls-files`
 * rather than listed, because a hardcoded roster cannot fail on the file
 * somebody adds next week — which is precisely how the defect got to 50 files.
 *
 * The rule is an ORDERING, asserted in both directions:
 *   - a root-owned developer-directory git must come BEFORE the shim, because
 *     that is the whole point; and
 *   - a user-writable location must stay AFTER it, because the reason these
 *     are fixed absolute paths rather than a `PATH` lookup is that a writeable
 *     directory must not get to choose which binary runs. Speed does not buy
 *     its way past that.
 *
 * @module tests/unit/core/git-shim-resolution
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveGit } from "../../support/git-executable.js";

/**
 * The developer-directory gits the shim itself re-executes.
 *
 * Both are `root:wheel` files in system locations, so preferring them is the
 * same trust class as `/usr/bin/git` — not a relaxation of it.
 */
const DEVELOPER_DIRECTORY = Object.freeze([
  "/Library/Developer/CommandLineTools/usr/bin/git",
  "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
]);

/** The path that is not git. */
const SHIM = "/usr/bin/git";

/** Locations a non-root user can write to, which must stay behind the shim. */
const USER_WRITABLE = Object.freeze([
  "/opt/homebrew/bin/git",
  "/usr/local/bin/git",
]);

/** Extensions whose files can execute a subprocess. */
const EXECUTABLE_SOURCE = Object.freeze([
  ".ts",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".sh",
]);

/** Ways a JavaScript or TypeScript module starts a child process. */
const SPAWNS = Object.freeze(["execFile", "execSync", "spawn", "exec(", "$`"]);

/** This file, which names every path above and must not police itself. */
const OWN_SPEC = "tests/unit/core/git-shim-resolution.test.ts";

/** Opening line of every synthetic source the bite cases feed the checker. */
const LIST_OPEN = "const GIT = [";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

/**
 * The quoted form of a path, as it appears in source.
 * @param candidate - Absolute path to a git binary.
 * @returns The path wrapped in double quotes.
 */
function quoted(candidate: string): string {
  return `"${candidate}"`;
}

/**
 * Why a source file's git resolution is wrong, or nothing when it is right.
 *
 * A file that never names the shim is not this check's business — it either
 * resolves git some other way or does not run git at all.
 * @param source - File contents.
 * @returns One reason per violation; empty when the file is compliant.
 */
export function shimViolations(source: string): string[] {
  const shimAt = source.indexOf(quoted(SHIM));
  if (shimAt === -1) return [];
  const reasons: string[] = [];
  for (const better of DEVELOPER_DIRECTORY) {
    const at = source.indexOf(quoted(better));
    if (at === -1) {
      reasons.push(`names ${SHIM} without offering ${better}`);
    } else if (at > shimAt) {
      reasons.push(`prefers ${SHIM} over ${better}`);
    }
  }
  for (const worse of USER_WRITABLE) {
    const at = source.indexOf(quoted(worse));
    if (at !== -1 && at < shimAt) {
      reasons.push(`prefers user-writable ${worse} over ${SHIM}`);
    }
  }
  return reasons;
}

/** Extensions whose whole purpose is running commands. */
const SHELL_SOURCE = Object.freeze([".sh", ".bash"]);

/**
 * Whether a file can run a command.
 *
 * A file that runs nothing cannot pay the shim, so naming the path as data —
 * a fixture describing where a base image keeps git, say — is not a defect.
 * The exemption is earned by this property rather than granted by a list, so
 * it cannot become the bypass that an allowlist eventually becomes.
 *
 * A shell script always qualifies. Its way of spawning git is to write `git`,
 * which matches no marker a JavaScript scan can look for, so keying on markers
 * alone would silently exempt every `.sh` file in the repository — the exact
 * shape of hole this check exists to close.
 * @param file - Repository-relative path.
 * @param source - File contents.
 * @returns Whether the file can execute a command.
 */
export function canRunACommand(file: string, source: string): boolean {
  if (SHELL_SOURCE.includes(path.extname(file))) return true;
  return SPAWNS.some(marker => source.includes(marker));
}

/**
 * Every tracked file that could execute git.
 * @returns Repository-relative paths, derived from git rather than listed.
 */
function roster(): string[] {
  const stdout = execFileSync(resolveGit(), ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout
    .split("\0")
    .filter(Boolean)
    .filter(file => EXECUTABLE_SOURCE.includes(path.extname(file)))
    .filter(file => file !== OWN_SPEC);
}

describe("git is resolved to a binary, not to a dispatcher (#2898)", () => {
  it("no tracked file that spawns a process prefers the xcrun shim", () => {
    const offenders = roster().flatMap(file => {
      const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
      if (!canRunACommand(file, source)) return [];
      return shimViolations(source).map(reason => `${file}: ${reason}`);
    });
    expect(offenders).toEqual([]);
  });

  it("scans a roster derived from git, not a list somebody maintains", () => {
    // A hardcoded roster cannot fail on the file added next week, which is
    // exactly how one call site became fifty.
    const files = roster();
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain("plugins/src/base/hooks/threshold-ratchet.mjs");
    expect(files).toContain(
      "typescript/copy-overwrite/scripts/check-threshold-ratchet.mjs"
    );
    expect(files).toContain("expo/copy-overwrite/scripts/bdd/baseline.mjs");
  });

  describe("the check bites", () => {
    it("reports a list that puts the shim first", () => {
      const source = [
        LIST_OPEN,
        `  "${SHIM}",`,
        `  "${DEVELOPER_DIRECTORY[0]}",`,
        "];",
      ].join("\n");
      expect(shimViolations(source)).toEqual([
        `prefers ${SHIM} over ${DEVELOPER_DIRECTORY[0]}`,
        `names ${SHIM} without offering ${DEVELOPER_DIRECTORY[1]}`,
      ]);
    });

    it("reports a lone shim with no alternative at all", () => {
      expect(shimViolations(`const GIT = "${SHIM}";`)).toHaveLength(
        DEVELOPER_DIRECTORY.length
      );
    });

    it("reports a user-writable path promoted ahead of the shim", () => {
      const source = [
        LIST_OPEN,
        ...DEVELOPER_DIRECTORY.map(candidate => `  "${candidate}",`),
        `  "${USER_WRITABLE[0]}",`,
        `  "${SHIM}",`,
        "];",
      ].join("\n");
      expect(shimViolations(source)).toEqual([
        `prefers user-writable ${USER_WRITABLE[0]} over ${SHIM}`,
      ]);
    });

    it("passes the ordering every fixed call site now uses", () => {
      const source = [
        LIST_OPEN,
        ...DEVELOPER_DIRECTORY.map(candidate => `  "${candidate}",`),
        `  "${SHIM}",`,
        ...USER_WRITABLE.map(candidate => `  "${candidate}",`),
        "];",
      ].join("\n");
      expect(shimViolations(source)).toEqual([]);
    });

    it("ignores a file that names no shim", () => {
      expect(shimViolations('const GIT = "git";')).toEqual([]);
    });
  });

  describe("running a command is what forfeits the exemption", () => {
    it("exempts a fixture that only names the path as data", () => {
      const source = `export const SYSTEM_GIT = "${SHIM}";\n`;
      expect(canRunACommand("tests/unit/workstation/fixtures.ts", source)).toBe(
        false
      );
      expect(shimViolations(source)).not.toEqual([]);
    });

    it("refuses the exemption the moment the file spawns anything", () => {
      const source = [
        `const GIT = "${SHIM}";`,
        'execFileSync(GIT, ["status"]);',
      ].join("\n");
      expect(canRunACommand("tests/probe.ts", source)).toBe(true);
    });

    it("never exempts a shell script, whose git call matches no marker", () => {
      // A `.sh` file spawns git by writing `git`. Keying the exemption on
      // JavaScript spawn markers alone would exempt every shell script in the
      // repository, which is the same hole in a different file extension.
      const source = `GIT="${SHIM}"\n"$GIT" status\n`;
      expect(SPAWNS.some(marker => source.includes(marker))).toBe(false);
      expect(canRunACommand("scripts/probe.sh", source)).toBe(true);
    });
  });
});
