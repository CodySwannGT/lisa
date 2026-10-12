/**
 * Contract tests for the session manager's repo layout helpers.
 *
 * `resolveRepoDir` picks the directory a bypass-permissions worker starts in,
 * so a key that resolved outside the project, or a single-repo project that
 * accepted a child key, would launch real work in the wrong checkout.
 * `detectRepos` and `buildDefaultBlock` decide what setup writes.
 * @module tests/unit/session-manager/config-repos
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildDefaultBlock,
  detectRepos,
  resolveRepoDir,
  resolveSessionManagerConfig,
  validateSessionManager,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/config.mjs";

/** The manager name every fixture uses. */
const NAME = "repo-a-manager";

/** The project slug setup derives names from. */
const SLUG = "repo-a";

/** The absolute project root every resolution is made against. */
const ROOT = "/work/repo-a";

/** A notify block every valid fixture shares. */
const NOTIFY = {
  provider: "telegram",
  stateDir: "~/.claude/channels/telegram-repo-a",
};

describe("detectRepos", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sm-config-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Create `<root>/projects/<name>`, optionally Lisa-configured.
   * @param name - Child directory name.
   * @param configured - Whether to drop a `.lisa.config.json` in it.
   */
  function child(name: string, configured: boolean): void {
    const dir = join(root, "projects", name);
    mkdirSync(dir, { recursive: true });
    if (configured) writeFileSync(join(dir, ".lisa.config.json"), "{}");
  }

  it("lists only child dirs carrying .lisa.config.json, sorted", () => {
    child("web", true);
    child("api", true);
    child("docs", false);
    writeFileSync(join(root, "projects", "README.md"), "not a dir");
    expect(detectRepos(root)).toEqual(["api", "web"]);
  });

  it("returns an empty list when there is no projects dir", () => {
    expect(detectRepos(root)).toEqual([]);
  });

  it("honours a different repos root", () => {
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    writeFileSync(join(root, "apps", "api", ".lisa.config.json"), "{}");
    expect(detectRepos(root, { reposRoot: "apps" })).toEqual(["api"]);
  });

  it("skips children whose names are not safe path segments", () => {
    child(".hidden", true);
    child("api", true);
    expect(detectRepos(root)).toEqual(["api"]);
  });
});

describe("buildDefaultBlock", () => {
  it("writes a single-repo block with no repos when none are detected", () => {
    const block = buildDefaultBlock({
      projectSlug: SLUG,
      detectedRepos: [],
    });
    expect(block).toEqual({
      name: NAME,
      interval: "5m",
      capacity: {
        maxWorkers: 6,
        gbPerWorker: 3,
        reserveGb: 8,
        cpuFraction: 0.75,
        maxLoadPerCore: 1.5,
      },
      stall: { noOutputMinutes: 60, maxAttempts: 3, requestionHours: 4 },
      notify: {
        provider: "telegram",
        stateDir: "~/.claude/channels/telegram-repo-a",
      },
    });
    expect(block).not.toHaveProperty("repos");
  });

  it("treats an omitted detectedRepos as single-repo", () => {
    expect(buildDefaultBlock({ projectSlug: SLUG })).not.toHaveProperty(
      "repos"
    );
  });

  it("writes a multi-repo block seeding each repo's hints with its own name", () => {
    const block = buildDefaultBlock({
      projectSlug: SLUG,
      detectedRepos: ["web", "api"],
    });
    expect(block.repos).toEqual({
      root: "projects",
      entries: { api: { hints: ["api"] }, web: { hints: ["web"] } },
    });
  });

  it("normalizes the project slug into a valid manager name", () => {
    const block = buildDefaultBlock({
      projectSlug: "My_Project.v2",
      detectedRepos: [],
    });
    expect(block.name).toBe("my-project-v2-manager");
    expect(block.notify.stateDir).toBe(
      "~/.claude/channels/telegram-my-project-v2"
    );
  });

  it("produces a block the validator accepts", () => {
    for (const detectedRepos of [[], ["api", "web"]]) {
      const block = buildDefaultBlock({ projectSlug: SLUG, detectedRepos });
      expect(validateSessionManager(block)).toEqual([]);
    }
  });

  it("refuses a slug with nothing usable in it", () => {
    expect(() =>
      buildDefaultBlock({ projectSlug: "___", detectedRepos: [] })
    ).toThrow(/project slug/i);
  });
});

describe("resolveRepoDir", () => {
  const multi = resolveSessionManagerConfig({
    sessionManager: {
      name: NAME,
      notify: NOTIFY,
      repos: {
        root: "projects",
        entries: { api: { hints: ["API"] }, web: { hints: ["Expo"] } },
      },
    },
  });
  const single = resolveSessionManagerConfig({
    sessionManager: { name: NAME, notify: NOTIFY },
  });

  it("returns <root>/<repos.root>/<key> for a multi-repo project", () => {
    expect(resolveRepoDir(multi, "api", ROOT)).toBe(`${ROOT}/projects/api`);
  });

  it("rejects a key not in entries", () => {
    expect(() => resolveRepoDir(multi, "mobile", ROOT)).toThrow(
      /mobile.*not one of.*api, web/
    );
  });

  it("rejects a missing key on a multi-repo project", () => {
    expect(() => resolveRepoDir(multi, undefined, ROOT)).toThrow(
      /needs a repo key/
    );
  });

  it("rejects inherited object keys rather than resolving them", () => {
    expect(() => resolveRepoDir(multi, "constructor", ROOT)).toThrow(
      /not one of/
    );
  });

  it("returns the project root for a single-repo project", () => {
    expect(resolveRepoDir(single, undefined, ROOT)).toBe(ROOT);
    expect(resolveRepoDir(single, ".", ROOT)).toBe(ROOT);
  });

  it("rejects a repo key on a single-repo project", () => {
    expect(() => resolveRepoDir(single, "api", ROOT)).toThrow(/single-repo/);
  });

  it("accepts a raw, unresolved block too", () => {
    expect(
      resolveRepoDir(
        { repos: { entries: { api: { hints: ["x"] } } } },
        "api",
        ROOT
      )
    ).toBe(`${ROOT}/projects/api`);
  });

  it("refuses a repos.root that escapes the project, even unvalidated", () => {
    expect(() =>
      resolveRepoDir(
        { repos: { root: "..", entries: { api: { hints: ["x"] } } } },
        "api",
        ROOT
      )
    ).toThrow(/outside the project root/);
  });

  it("requires an absolute project root", () => {
    expect(() => resolveRepoDir(single, undefined, "relative")).toThrow(
      /absolute/
    );
  });
});
