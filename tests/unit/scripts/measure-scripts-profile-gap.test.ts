/**
 * Tests for the `scripts/` profile-gap measurement.
 *
 * The property under test is not "the number is 1,115". That number is a fact
 * about today's tree and will move on the next commit. What must hold is that
 * the report DERIVES its subject rather than restating a list somebody typed
 * into it — a hardcoded rule roster would go stale the first time
 * `getScriptsFilesOverride()` is edited, and would then report a gap that no
 * longer exists with the same confident formatting.
 *
 * So the derivation is fed synthetic configs containing rule names that appear
 * nowhere in this repository. A measurement that answered from a constant could
 * not pass those cases.
 *
 * `main()` itself is not exercised here. It lints the whole `scripts/` tree
 * through the repository's real typed config, which takes minutes — the wrong
 * cost for a unit suite, and the reason `--root` exists on the script.
 * @module tests/unit/scripts/measure-scripts-profile-gap
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ESLint } from "eslint";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  divergentRules,
  severityOf,
  tally,
  trackedScripts,
} from "../../../scripts/measure-scripts-profile-gap.mjs";
import {
  cleanGitEnv,
  cleanupTempDir,
  createTempDir,
} from "../../helpers/test-utils.js";

/** Sort without a bare `.sort()`, which is `sonarjs/no-alphabetical-sort`. */
const alphabetically = (left: string, right: string): number =>
  left.localeCompare(right);

describe("severityOf", () => {
  it("reads every form ESLint resolves a rule to", () => {
    expect(severityOf(2)).toBe("error");
    expect(severityOf(1)).toBe("warn");
    expect(severityOf(0)).toBe("off");
    expect(severityOf("error")).toBe("error");
    expect(severityOf([2, { allow: [] }])).toBe("error");
    expect(severityOf(["warn", "always"])).toBe("warn");
  });

  it("treats an absent or unreadable entry as off rather than guessing", () => {
    // A rule present in one probe and absent from the other must compare as
    // "off" on the missing side. Anything else would invent a divergence.
    expect(severityOf(undefined)).toBe("off");
    expect(severityOf("nonsense")).toBe("off");
  });
});

describe("divergentRules", () => {
  it("reports a rule the inside profile relaxes", () => {
    const result = divergentRules(
      { "made-up/never-in-this-repo": 2 },
      { "made-up/never-in-this-repo": 0 }
    );

    expect(result.weaker).toEqual([
      { rule: "made-up/never-in-this-repo", outside: "error", inside: "off" },
    ]);
    expect(result.stricter).toEqual([]);
  });

  it("reports a rule the inside profile PROMOTES, in the other column", () => {
    // The direction that makes the report worth reading. A measurement that
    // could only ever confirm "scripts/ is weaker" is a measurement that could
    // not fail, and this repository does promote one rule inside `scripts/`.
    const result = divergentRules(
      { "made-up/promoted-inside": 1 },
      { "made-up/promoted-inside": 2 }
    );

    expect(result.stricter).toEqual([
      { rule: "made-up/promoted-inside", outside: "warn", inside: "error" },
    ]);
    expect(result.weaker).toEqual([]);
  });

  it("reports nothing when the two profiles agree", () => {
    const result = divergentRules(
      { "made-up/same": 2, "made-up/also-same": [1, "opt"] },
      { "made-up/same": "error", "made-up/also-same": 1 }
    );

    expect(result.weaker).toEqual([]);
    expect(result.stricter).toEqual([]);
    expect(result.compared).toBe(2);
  });

  it("counts the union of both rule sets as what was compared", () => {
    // `compared === 0` is the report's refusal condition: two configs that
    // resolved nothing look exactly like two identical configs.
    expect(divergentRules({}, {}).compared).toBe(0);
    expect(divergentRules({ a: 2 }, { b: 2 }).compared).toBe(2);
  });

  it("orders each column by rule name so two runs diff cleanly", () => {
    const result = divergentRules(
      { "zz/last": 2, "aa/first": 2, "mm/middle": 2 },
      { "zz/last": 0, "aa/first": 0, "mm/middle": 0 }
    );

    expect(result.weaker.map(row => row.rule)).toEqual([
      "aa/first",
      "mm/middle",
      "zz/last",
    ]);
  });
});

describe("tally", () => {
  /** The one rule id these cases restore. */
  const RESTORED = "restored/one";

  const result = (filePath: string, ruleIds: readonly (string | null)[]) =>
    ({
      filePath,
      messages: ruleIds.map(ruleId => ({ ruleId })),
    }) as unknown as ESLint.LintResult;

  it("counts only the rules that were restored", () => {
    // Everything else ESLint reports is the tree's state under the profile as
    // it already stands, which is not what this measures. Counting it would
    // inflate the gap with findings the profile never suppressed.
    const counted = tally(
      "/repo",
      [result("/repo/scripts/a.mjs", [RESTORED, "other/rule", null])],
      new Set([RESTORED])
    );

    expect(counted.total).toBe(1);
    expect([...counted.byRule]).toEqual([[RESTORED, 1]]);
  });

  it("counts a file once however many findings it carries", () => {
    const counted = tally(
      "/repo",
      [
        result("/repo/scripts/a.mjs", [RESTORED, RESTORED]),
        result("/repo/scripts/b.mjs", [RESTORED]),
        result("/repo/scripts/c.mjs", []),
      ],
      new Set([RESTORED])
    );

    expect(counted.total).toBe(3);
    expect([...counted.touched].sort(alphabetically)).toEqual([
      "scripts/a.mjs",
      "scripts/b.mjs",
    ]);
  });

  it("reports an empty tally rather than throwing on a clean set", () => {
    const counted = tally("/repo", [], new Set([RESTORED]));

    expect(counted.total).toBe(0);
    expect(counted.touched.size).toBe(0);
  });
});

describe("trackedScripts", () => {
  /** A tracked, lintable file that is NOT under `scripts/`. */
  const OUTSIDE = "outside.mjs";

  let root = "";

  beforeAll(async () => {
    root = await createTempDir();
    await fs.mkdir(path.join(root, "scripts", "lib"), { recursive: true });
    await fs.writeFile(path.join(root, "scripts", "tracked.mjs"), "\n");
    await fs.writeFile(path.join(root, "scripts", "lib", "nested.ts"), "\n");
    await fs.writeFile(path.join(root, "scripts", "shell.sh"), "\n");
    await fs.writeFile(path.join(root, "scripts", "data.json"), "{}\n");
    await fs.writeFile(path.join(root, OUTSIDE), "\n");

    const env = cleanGitEnv(process.env);
    const git = (...args: readonly string[]) =>
      execFileSync("git", [...args], { cwd: root, env, stdio: "ignore" });
    git("init");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("add", "scripts", OUTSIDE);
    git("commit", "-m", "fixture");

    // Written AFTER the commit on purpose: this is the untracked scratch file
    // whose presence must not change another agent's reported number.
    await fs.writeFile(path.join(root, "scripts", "untracked.mjs"), "\n");
  });

  afterAll(async () => {
    if (root !== "") await cleanupTempDir(root);
  });

  it("returns the tracked lintable files under scripts/", () => {
    expect([...trackedScripts(root)].sort(alphabetically)).toEqual([
      "scripts/lib/nested.ts",
      "scripts/tracked.mjs",
    ]);
  });

  it("excludes an untracked file that exists on disk", () => {
    expect(trackedScripts(root)).not.toContain("scripts/untracked.mjs");
  });

  it("excludes files ESLint has no opinion about", () => {
    expect(trackedScripts(root)).not.toContain("scripts/shell.sh");
    expect(trackedScripts(root)).not.toContain("scripts/data.json");
  });

  it("excludes tracked files outside scripts/", () => {
    expect(trackedScripts(root)).not.toContain(OUTSIDE);
  });

  it("drops a tracked path with no file behind it", async () => {
    // `git ls-files` still lists a path staged for deletion, and handing ESLint
    // a path with no file turns a clean tree into an error about the harness.
    const removed = path.join(root, "scripts", "tracked.mjs");
    await fs.rm(removed);
    try {
      expect(trackedScripts(root)).not.toContain("scripts/tracked.mjs");
    } finally {
      await fs.writeFile(removed, "\n");
    }
  });
});
