/**
 * The four control-audit fixtures are what their definitions say they are.
 *
 * Every later control-audit suite builds on these repositories, so a fixture
 * that quietly gained a `package.json`, lost its linter configuration, or
 * picked up the developer's git identity would make those suites prove
 * something other than what they claim. The defining facts are pinned here, by
 * name, once (CodySwannGT/lisa#4974).
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createDetectorRegistry } from "../../../src/detection/index.js";
import {
  CONTROL_AUDIT_FIXTURE_FILES,
  CONTROL_AUDIT_FIXTURE_GIT,
  CONTROL_AUDIT_FIXTURE_NAMES,
  buildControlAuditFixture,
  buildFEmpty,
  buildFMixed,
  buildFNone,
  buildFPaved,
  runControlAuditGit,
  type ControlAuditFixture,
  type ControlAuditFixtureName,
} from "../../helpers/control-audit-fixtures.js";

const PACKAGE_JSON = "package.json";
const TYPESCRIPT = "typescript";
const RUFF_TOML = "ruff.toml";
const SEED_DATE = "2026-01-01T00:00:00Z";

/**
 * The seed commit of each fixture.
 *
 * Comparing two builds on one machine cannot see a leak that is constant on
 * that machine — its timezone, its git identity, its global configuration. A
 * literal can: the same bytes, author, date and message hash to the same commit
 * everywhere, so a build that differs here differs because something ambient
 * got in. Changing a fixture's content changes its line, on purpose and in
 * review.
 */
const SEED_COMMIT: Readonly<Record<ControlAuditFixtureName, string>> = {
  "F-none": "925c5f2cc842fbcd69ff94d2e9cc546cf74e8a14",
  "F-mixed": "9064368dd437ab81a2702c0a4e99f7d3ad10cc36",
  "F-paved": "4e2bf1ba6cf0cf00633cdbffc2fe867ac85d2ed2",
  "F-empty": "d16f0c58aa22c5778fbbefa62bde7bfd78262d9e",
};

let built: readonly ControlAuditFixture[] = [];
let scratch: readonly string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const fixture of built) fixture.cleanup();
  for (const directory of scratch)
    rmSync(directory, { recursive: true, force: true });
  built = [];
  scratch = [];
});

/**
 * Register a fixture for removal after the case.
 * @param fixture - A freshly built fixture
 * @returns The same fixture
 */
function track(fixture: ControlAuditFixture): ControlAuditFixture {
  built = [...built, fixture];
  return fixture;
}

/**
 * Run git in a fixture.
 * @param fixture - The fixture to run in
 * @param args - Arguments to git
 * @returns What git printed
 */
function git(fixture: ControlAuditFixture, ...args: readonly string[]): string {
  return runControlAuditGit(fixture.repoPath, args);
}

/**
 * The commit a fixture's HEAD names.
 * @param fixture - The fixture to read
 * @returns The full commit id
 */
const head = (fixture: ControlAuditFixture): string =>
  git(fixture, "rev-parse", "HEAD");

/**
 * How many commits a fixture holds.
 * @param fixture - The fixture to read
 * @returns The count, as git prints it
 */
const commitCount = (fixture: ControlAuditFixture): string =>
  git(fixture, "rev-list", "--count", "HEAD");

/**
 * Every untracked, modified or ignored path of a fixture.
 * @param fixture - The fixture to read
 * @returns Porcelain status, empty when the tree is clean
 */
const dirt = (fixture: ControlAuditFixture): string =>
  git(fixture, "status", "--porcelain", "--ignored");

/**
 * The paths git tracks in a fixture, in git's own (byte) order.
 * @param fixture - The fixture to list
 * @returns Repository-relative tracked paths
 */
function trackedFiles(fixture: ControlAuditFixture): readonly string[] {
  return git(fixture, "ls-files")
    .split("\n")
    .filter(line => line !== "");
}

/**
 * Hooks git would run in a fixture, ignoring the samples `git init` ships.
 * @param fixture - The fixture to inspect
 * @returns Names of installed hooks
 */
function installedHooks(fixture: ControlAuditFixture): readonly string[] {
  const hooks = path.join(fixture.repoPath, ".git", "hooks");
  if (!existsSync(hooks)) return [];
  return readdirSync(hooks).filter(name => !name.endsWith(".sample"));
}

/**
 * Detect the supported project types of a directory.
 * @param directory - Directory to scan
 * @returns Detected types, parents included, in canonical order
 */
async function detectedTypes(directory: string): Promise<readonly string[]> {
  const registry = createDetectorRegistry();
  return registry.expandAndOrderTypes(await registry.detectAll(directory));
}

/**
 * Write a home directory whose git configuration would change a fixture in
 * three visible ways: a global ignore that drops the TOML files from the seed
 * commit, a template that installs a refusing pre-commit hook, and an identity
 * that is not the fixture's.
 * @returns The home directory
 */
function hostileHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), "lisa-control-audit-home-"));
  scratch = [...scratch, home];
  const templateHooks = path.join(home, "template", "hooks");
  mkdirSync(templateHooks, { recursive: true });
  writeFileSync(path.join(templateHooks, "pre-commit"), "#!/bin/sh\nexit 1\n", {
    mode: 0o755,
  });
  writeFileSync(path.join(home, "ignore"), "*.toml\n");
  writeFileSync(
    path.join(home, ".gitconfig"),
    [
      "[init]",
      "\tdefaultBranch = trunk",
      `\ttemplateDir = ${path.join(home, "template")}`,
      "[user]",
      "\tname = Someone Else",
      "\temail = someone@example.test",
      "[core]",
      `\texcludesFile = ${path.join(home, "ignore")}`,
      "",
    ].join("\n")
  );
  return home;
}

describe("control audit fixtures", () => {
  describe.each(CONTROL_AUDIT_FIXTURE_NAMES)("%s", name => {
    it("is a fresh git repository with one commit and a clean tree", () => {
      const fixture = track(buildControlAuditFixture(name));

      expect(fixture.name).toBe(name);
      expect(git(fixture, "rev-parse", "--show-toplevel")).toBe(
        fixture.repoPath
      );
      expect(git(fixture, "branch", "--show-current")).toBe(
        CONTROL_AUDIT_FIXTURE_GIT.defaultBranch
      );
      expect(commitCount(fixture)).toBe("1");
      expect(dirt(fixture)).toBe("");
      expect(git(fixture, "remote")).toBe("");
    });

    it("tracks exactly the files of its definition, byte for byte", () => {
      const fixture = track(buildControlAuditFixture(name));
      const definition = Object.entries(CONTROL_AUDIT_FIXTURE_FILES[name]);

      expect(new Set(trackedFiles(fixture))).toEqual(
        new Set(definition.map(([relative]) => relative))
      );
      expect(trackedFiles(fixture)).toHaveLength(definition.length);
      for (const [relative, content] of definition) {
        expect(
          readFileSync(path.join(fixture.repoPath, relative), "utf8")
        ).toBe(content);
      }
    });

    it("is committed by the fixed author at the fixed date", () => {
      const fixture = track(buildControlAuditFixture(name));
      const { authorEmail, authorName, commitMessage } =
        CONTROL_AUDIT_FIXTURE_GIT;
      const identity = `${authorName} <${authorEmail}>`;

      expect(
        git(fixture, "log", "--format=%an <%ae>|%cn <%ce>|%aI|%cI|%s")
      ).toBe(
        [identity, identity, SEED_DATE, SEED_DATE, commitMessage].join("|")
      );
    });

    it("builds the same commit in a different directory every time", () => {
      const first = track(buildControlAuditFixture(name));
      const second = track(buildControlAuditFixture(name));

      expect(second.repoPath).not.toBe(first.repoPath);
      expect(head(first)).toBe(SEED_COMMIT[name]);
      expect(head(second)).toBe(SEED_COMMIT[name]);
    });

    it("installs no hook and names no hooks path", () => {
      const fixture = track(buildControlAuditFixture(name));

      expect(installedHooks(fixture)).toEqual([]);
      expect(git(fixture, "config", "--local", "--list")).not.toMatch(
        /hookspath/iu
      );
    });

    it("removes its temporary directory on cleanup, and again harmlessly", () => {
      const fixture = buildControlAuditFixture(name);
      expect(existsSync(fixture.repoPath)).toBe(true);

      fixture.cleanup();
      expect(existsSync(fixture.repoPath)).toBe(false);
      expect(() => fixture.cleanup()).not.toThrow();
    });
  });

  describe("defining facts", () => {
    it("F-none and F-empty contain no package.json", () => {
      for (const fixture of [track(buildFNone()), track(buildFEmpty())]) {
        expect(
          trackedFiles(fixture).filter(
            file => path.basename(file) === PACKAGE_JSON
          )
        ).toEqual([]);
        expect(existsSync(path.join(fixture.repoPath, PACKAGE_JSON))).toBe(
          false
        );
      }
    });

    it("F-none is a Python package with a linter configuration", () => {
      expect(trackedFiles(track(buildFNone()))).toEqual([
        "pyproject.toml",
        RUFF_TOML,
        "src/fixture_none/__init__.py",
        "src/fixture_none/greeting.py",
      ]);
    });

    it("F-mixed contains the folders api and web, and nothing beside them", () => {
      const fixture = track(buildFMixed());
      const entries = readdirSync(fixture.repoPath);

      expect(new Set(entries)).toEqual(new Set([".git", "api", "web"]));
      expect(trackedFiles(fixture)).toEqual([
        "api/pyproject.toml",
        "api/ruff.toml",
        "api/src/api/__init__.py",
        "api/src/api/greeting.py",
        "web/package.json",
        "web/src/index.ts",
        "web/tsconfig.json",
      ]);
    });

    it("F-paved is a TypeScript package at the repository root", () => {
      expect(trackedFiles(track(buildFPaved()))).toEqual([
        PACKAGE_JSON,
        "src/index.ts",
        "tsconfig.json",
      ]);
    });

    it("F-empty holds source files only", () => {
      expect(trackedFiles(track(buildFEmpty()))).toEqual([
        "src/greeting.py",
        "src/main.py",
      ]);
    });

    it("stack detection returns no type for F-none and typescript for F-paved", async () => {
      expect(await detectedTypes(track(buildFNone()).repoPath)).toEqual([]);
      expect(await detectedTypes(track(buildFPaved()).repoPath)).toEqual([
        TYPESCRIPT,
      ]);
    });

    it("stack detection returns no type for F-empty", async () => {
      expect(await detectedTypes(track(buildFEmpty()).repoPath)).toEqual([]);
    });

    it("stack detection sees typescript only inside the web part of F-mixed", async () => {
      const { repoPath } = track(buildFMixed());

      expect(await detectedTypes(repoPath)).toEqual([]);
      expect(await detectedTypes(path.join(repoPath, "api"))).toEqual([]);
      expect(await detectedTypes(path.join(repoPath, "web"))).toEqual([
        TYPESCRIPT,
      ]);
    });
  });

  describe("isolation from the machine it runs on", () => {
    it("ignores the caller's git configuration and hook environment", () => {
      const home = hostileHome();
      vi.stubEnv("HOME", home);
      vi.stubEnv("XDG_CONFIG_HOME", home);
      vi.stubEnv("GIT_DIR", path.join(home, "not-a-repository"));
      vi.stubEnv("GIT_AUTHOR_NAME", "Someone Else");
      vi.stubEnv("GIT_AUTHOR_DATE", "2001-02-03T04:05:06+00:00");
      vi.stubEnv("TZ", "Pacific/Kiritimati");

      const fixture = track(buildFNone());

      expect(head(fixture)).toBe(SEED_COMMIT["F-none"]);
      expect(git(fixture, "rev-parse", "--show-toplevel")).toBe(
        fixture.repoPath
      );
      expect(dirt(fixture)).toBe("");
      expect(installedHooks(fixture)).toEqual([]);
    });

    it("records its identity in the repository, so a plain git commit works", () => {
      const fixture = track(buildFEmpty());
      const local = (key: string): string =>
        git(fixture, "config", "--local", "--get", key);

      expect(local("user.name")).toBe(CONTROL_AUDIT_FIXTURE_GIT.authorName);
      expect(local("user.email")).toBe(CONTROL_AUDIT_FIXTURE_GIT.authorEmail);
      expect(local("commit.gpgsign")).toBe("false");
    });

    it("commits later changes with the same fixed author and date", () => {
      const fixture = track(buildFEmpty());
      writeFileSync(path.join(fixture.repoPath, "src", "extra.py"), "X = 1\n");
      git(fixture, "add", "--all");
      git(fixture, "commit", "--quiet", "--message", "feat: add a constant");

      expect(commitCount(fixture)).toBe("2");
      expect(git(fixture, "log", "-1", "--format=%an|%aI|%cI")).toBe(
        [CONTROL_AUDIT_FIXTURE_GIT.authorName, SEED_DATE, SEED_DATE].join("|")
      );
    });
  });

  describe("extra files", () => {
    it("commits them with the seed, leaving one commit and a clean tree", () => {
      const fixture = track(
        buildFNone({ extraFiles: { "wiki/index.md": "# Wiki\n" } })
      );

      expect(trackedFiles(fixture)).toContain("wiki/index.md");
      expect(commitCount(fixture)).toBe("1");
      expect(dirt(fixture)).toBe("");
    });

    it("replaces a file of the definition when the path matches", () => {
      const fixture = track(
        buildFNone({ extraFiles: { [RUFF_TOML]: "line-length = 100\n" } })
      );

      expect(readFileSync(path.join(fixture.repoPath, RUFF_TOML), "utf8")).toBe(
        "line-length = 100\n"
      );
      expect(trackedFiles(fixture)).toHaveLength(4);
    });

    it.each([
      "../outside.txt",
      "/outside.txt",
      "src/../../outside.txt",
      ".git/hooks/pre-commit",
      ".GIT/config",
      ".",
    ])("refuses %s, and leaves no directory behind", escaping => {
      // A temporary root of this case's own, so "nothing was left behind" is
      // a statement about this build and not about every other worker's.
      const root = mkdtempSync(path.join(tmpdir(), "lisa-control-audit-tmp-"));
      scratch = [...scratch, root];
      vi.stubEnv("TMPDIR", root);

      expect(() =>
        track(buildFEmpty({ extraFiles: { [escaping]: "no\n" } }))
      ).toThrow(/outside the fixture repository's committed tree/u);
      expect(readdirSync(root)).toEqual([]);
    });
  });
});
