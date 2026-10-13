/**
 * Contract tests for which children of `projects/` setup proposes as routed
 * repos, and the hints it drafts for them (CodySwannGT/lisa#4465).
 *
 * A host's `projects/` holds linked worktrees and second clones next to each
 * real clone, all carrying the repo's `.lisa.config.json`. Counting config
 * files alone proposed 110 routed repos for a project with 4, and a worker
 * routed into a stale ticket worktree builds on the wrong branch. Imported
 * through config.mjs, the module setup and the CLI use.
 * @module tests/unit/session-manager/repo-detect
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildDefaultBlock,
  detectRepos,
  draftHints,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/config.mjs";
import { normalizeRemote } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/repo-detect.mjs";

const SSH_APP = "git@github.com:acme/app.git";
const HTTPS_APP = "https://github.com/acme/app";
const LISA_CONFIG = ".lisa.config.json";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sm-detect-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * A Lisa-configured clone under `projects/`, with its own `.git` directory.
 * @param name - Child directory name
 * @param origin - Origin URL to record, or null for none
 * @returns The child directory
 */
function clone(name: string, origin: string | null): string {
  const dir = join(root, "projects", name);
  const remote =
    origin === null
      ? ""
      : `[remote "upstream"]\n\turl = git@github.com:someone/else.git\n` +
        `[remote "origin"]\n\turl = ${origin}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`;
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, LISA_CONFIG), "{}");
  writeFileSync(
    join(dir, ".git", "config"),
    `[core]\n\tbare = false\n${remote}`
  );
  return dir;
}

/**
 * A Lisa-configured linked worktree: `.git` is a file pointing elsewhere.
 * @param name - Child directory name
 */
function linkedWorktree(name: string): void {
  const dir = join(root, "projects", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, LISA_CONFIG), "{}");
  writeFileSync(join(dir, ".git"), "gitdir: /elsewhere/.git/worktrees/x\n");
}

describe("detectRepos", () => {
  it("leaves out linked worktrees", () => {
    clone("app", SSH_APP);
    linkedWorktree("app-wt-SE-1");
    expect(detectRepos(root)).toEqual(["app"]);
  });

  it("keeps a .git-file checkout that is not a worktree (a submodule)", () => {
    const dir = join(root, "projects", "lib");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, LISA_CONFIG), "{}");
    writeFileSync(join(dir, ".git"), "gitdir: ../../.git/modules/lib\n");
    expect(detectRepos(root)).toEqual(["lib"]);
  });

  it("keeps the clone named after the repo when two clones share an origin", () => {
    clone("app-se1", HTTPS_APP);
    clone("app", SSH_APP);
    clone("web", "git@github.com:acme/web.git");
    expect(detectRepos(root)).toEqual(["app", "web"]);
  });

  it("keeps the lexically first clone when none is named after the repo", () => {
    clone("b-one", SSH_APP);
    clone("a-two", `${HTTPS_APP}.git`);
    expect(detectRepos(root)).toEqual(["a-two"]);
  });

  it("keeps every clone with no readable origin", () => {
    clone("tool", null);
    clone("tool-copy", null);
    expect(detectRepos(root)).toEqual(["tool", "tool-copy"]);
  });

  it("still requires .lisa.config.json", () => {
    clone("app", SSH_APP);
    mkdirSync(join(root, "projects", "plain", ".git"), { recursive: true });
    expect(detectRepos(root)).toEqual(["app"]);
  });
});

describe("normalizeRemote", () => {
  it.each([
    SSH_APP,
    HTTPS_APP,
    "https://user@GitHub.com/Acme/App.git/",
    "ssh://git@github.com:22/acme/app.git",
  ])("normalizes %s", url => {
    expect(normalizeRemote(url)).toBe("github.com/acme/app");
  });

  it.each(["", "not a url", "/local/path/app"])("returns null for %j", url => {
    expect(normalizeRemote(url)).toBeNull();
  });
});

describe("draftHints", () => {
  it("adds a hint per well-known dependency, name first", () => {
    const dir = clone("api", null);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { "@nestjs/core": "1", typeorm: "1", lodash: "1" },
        devDependencies: { "@nestjs/testing": "1" },
      })
    );
    expect(draftHints(dir, "api")).toEqual(["api", "NestJS", "TypeORM"]);
  });

  it("keeps just the name with no package.json", () => {
    expect(draftHints(clone("tool", null), "tool")).toEqual(["tool"]);
  });

  it("keeps just the name with an unparseable package.json", () => {
    const dir = clone("broken", null);
    writeFileSync(join(dir, "package.json"), "{ not json");
    expect(draftHints(dir, "broken")).toEqual(["broken"]);
  });
});

describe("buildDefaultBlock hints", () => {
  it("uses drafted hints when given and the name otherwise", () => {
    const block = buildDefaultBlock({
      projectSlug: "demo",
      detectedRepos: ["api", "web"],
      hints: { api: ["api", "NestJS"], web: [] },
    });
    expect(block.repos?.entries).toEqual({
      api: { hints: ["api", "NestJS"] },
      web: { hints: ["web"] },
    });
  });
});
