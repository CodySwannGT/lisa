/**
 * Regression coverage for the lisa-wiki `ensure-wiki.mjs` resolver.
 *
 * `ensure-wiki` is the single step-0 resolver that `lisa-wiki-query` and
 * `lisa-wiki-ingest` call so they never hardcode `wiki/` and never have to know
 * whether the wiki is local or remote. The mode decision lives in the script:
 *
 *   - LOCAL  — no `wiki.source` in `.lisa.config.json`; resolve the in-repo
 *              `wikiRoot` (default `wiki`) instantly, no network.
 *   - REMOTE — `wiki.source.url` set; maintain a gitignored mirror of that repo
 *              (clone-if-missing, fast-forward when stale subject to a TTL) and
 *              return the wiki root inside it. Offline-tolerant.
 * @module tests/unit/strategies/wiki-ensure-wiki
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** Pinned git binary — resolving `git` via $PATH trips no-os-command-from-path. */
const GIT_BIN = "/usr/bin/git";
/** Filename for the consumer-repo Lisa config. */
const LISA_CONFIG = ".lisa.config.json";
/** Managed-block marker the script keys on when gitignoring the mirror. */
const MIRROR_MARKER = "# BEGIN: AI GUARDRAILS WIKI MIRROR";
/** Wiki entry-point filename, asserted across the suite. */
const INDEX_MD = "index.md";
/** Body written into the fixture wiki's index page. */
const REMOTE_WIKI_BODY = "# Remote Wiki\n";
/** Non-default local wiki dir used by the explicit-path tests. */
const CUSTOM_WIKI = "custom-wiki";
/** Override dir used to prove wiki.source.path beats the convention. */
const OVERRIDE = "override";
/** Absolute path to the script under test. */
const SCRIPT_PATH = path.resolve(
  __dirname,
  "../../../plugins/src/wiki/scripts/ensure-wiki.mjs"
);

/**
 * Git env with no system/global config bleed-through.
 * @returns A process env safe for isolated git fixtures.
 */
function cleanGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1" };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}
const CLEAN_GIT_ENV = cleanGitEnv();

/**
 * Run a git command in `cwd` with the clean env.
 * @param cwd - Working directory for the git invocation.
 * @param args - git arguments.
 */
const git = (cwd: string, args: readonly string[]): void => {
  execFileSync(GIT_BIN, args, { cwd, env: CLEAN_GIT_ENV });
};

/**
 * Run ensure-wiki against `cwd`, returning the parsed `--json` result.
 * @param cwd - Consumer project directory to resolve against.
 * @param extra - Additional CLI flags (e.g. `--ttl 0`, `--offline`).
 * @returns The parsed resolver result.
 */
function run(
  cwd: string,
  extra: readonly string[] = []
): { mode: string; wikiRoot: string; fetched: boolean; stale: boolean } {
  const out = execFileSync(
    process.execPath,
    [SCRIPT_PATH, "--cwd", cwd, "--json", ...extra],
    { encoding: "utf8", env: CLEAN_GIT_ENV }
  );
  return JSON.parse(out.trim().split("\n").pop() as string);
}

/**
 * Create a git wiki repo with `wiki/index.md` and return its path.
 * @param root - Tempdir to create the repo under.
 * @param body - Contents for `wiki/index.md`.
 * @returns Absolute path to the created repo.
 */
function makeRemoteWiki(root: string, body: string): string {
  const repo = path.join(root, "remote-wiki");
  fs.mkdirSync(path.join(repo, "wiki"), { recursive: true });
  fs.writeFileSync(path.join(repo, "wiki", INDEX_MD), body);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "t@t.t"]);
  git(repo, ["config", "user.name", "t"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "init"]);
  return repo;
}

/**
 * Stand up a remote wiki fixture plus a consumer repo pointed at it.
 * @param root - Tempdir to create both repos under.
 * @returns The remote wiki path and the configured consumer path.
 */
function setupRemoteConsumer(root: string): {
  remote: string;
  consumer: string;
} {
  const remote = makeRemoteWiki(root, REMOTE_WIKI_BODY);
  const consumer = path.join(root, "consumer");
  fs.mkdirSync(consumer);
  fs.writeFileSync(
    path.join(consumer, LISA_CONFIG),
    JSON.stringify({ wiki: { source: { url: remote, ref: "main" } } })
  );
  return { remote, consumer };
}

describe("lisa-wiki ensure-wiki.mjs", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-ensure-wiki-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("LOCAL: resolves the in-repo wiki root with no network and no config", () => {
    fs.mkdirSync(path.join(tmp, "wiki"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "wiki", INDEX_MD), "# Index\n");
    const res = run(tmp);
    expect(res.mode).toBe("local");
    expect(res.wikiRoot).toBe(path.join(tmp, "wiki"));
    expect(res.fetched).toBe(false);
    // No mirror, no gitignore churn.
    expect(fs.existsSync(path.join(tmp, LISA_CONFIG))).toBe(false);
  });

  it("LOCAL: honors a non-default wikiRoot from lisa-wiki.config.json", () => {
    fs.mkdirSync(path.join(tmp, "wiki", "docs"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "wiki", "lisa-wiki.config.json"),
      JSON.stringify({ wikiRoot: "wiki/docs" })
    );
    fs.writeFileSync(path.join(tmp, "wiki", "docs", INDEX_MD), "# Index\n");
    const res = run(tmp);
    expect(res.wikiRoot).toBe(path.join(tmp, "wiki", "docs"));
  });

  it("LOCAL: an explicit wiki.source.path resolves in place (still mode 'local', no mirror)", () => {
    fs.mkdirSync(path.join(tmp, CUSTOM_WIKI), { recursive: true });
    fs.writeFileSync(path.join(tmp, CUSTOM_WIKI, INDEX_MD), "# Index\n");
    fs.writeFileSync(
      path.join(tmp, LISA_CONFIG),
      JSON.stringify({ wiki: { source: { path: CUSTOM_WIKI } } })
    );
    const res = run(tmp);
    expect(res.mode).toBe("local");
    expect(res.wikiRoot).toBe(path.join(tmp, CUSTOM_WIKI));
    expect(res.fetched).toBe(false);
    // Pure no-op: no gitignore churn, no mirror dir.
    expect(fs.existsSync(path.join(tmp, ".gitignore"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, ".lisa"))).toBe(false);
  });

  it("LOCAL: wiki.source.path wins over a lisa-wiki.config.json wikiRoot", () => {
    fs.mkdirSync(path.join(tmp, "wiki"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "wiki", "lisa-wiki.config.json"),
      JSON.stringify({ wikiRoot: "wiki" })
    );
    fs.writeFileSync(path.join(tmp, "wiki", INDEX_MD), "# convention\n");
    fs.mkdirSync(path.join(tmp, OVERRIDE), { recursive: true });
    fs.writeFileSync(path.join(tmp, OVERRIDE, INDEX_MD), "# override\n");
    fs.writeFileSync(
      path.join(tmp, LISA_CONFIG),
      JSON.stringify({ wiki: { source: { path: OVERRIDE } } })
    );
    expect(run(tmp).wikiRoot).toBe(path.join(tmp, OVERRIDE));
  });

  it("REMOTE: clones the mirror, resolves its wiki/ root, and gitignores it", () => {
    const { consumer } = setupRemoteConsumer(tmp);
    const res = run(consumer);
    expect(res.mode).toBe("remote");
    expect(res.fetched).toBe(true);
    expect(res.wikiRoot).toBe(path.join(consumer, ".lisa", "wiki", "wiki"));
    expect(
      fs.readFileSync(path.join(res.wikiRoot, INDEX_MD), "utf8")
    ).toContain("Remote Wiki");
    // Mirror path is kept out of version control.
    const ignore = fs.readFileSync(path.join(consumer, ".gitignore"), "utf8");
    expect(ignore).toContain(MIRROR_MARKER);
    expect(ignore).toContain("/.lisa/wiki/");
  });

  it("REMOTE: skips the fetch within the TTL, then refetches when forced", () => {
    const { consumer } = setupRemoteConsumer(tmp);
    expect(run(consumer).fetched).toBe(true); // initial clone
    expect(run(consumer).fetched).toBe(false); // within default TTL → skipped
    expect(run(consumer, ["--ttl", "0"]).fetched).toBe(true); // forced refetch
  });

  it("REMOTE: tolerates an unreachable remote by serving the existing mirror", () => {
    const { remote, consumer } = setupRemoteConsumer(tmp);
    run(consumer); // establish the mirror

    fs.rmSync(remote, { recursive: true, force: true }); // remote disappears
    const res = run(consumer, ["--ttl", "0"]); // forced fetch against dead remote
    expect(res.stale).toBe(true);
    expect(res.fetched).toBe(false);
    expect(fs.existsSync(path.join(res.wikiRoot, INDEX_MD))).toBe(true);
  });

  it("REMOTE: fails when offline with no mirror yet on disk", () => {
    const { consumer } = setupRemoteConsumer(tmp);
    expect(() => run(consumer, ["--offline"])).toThrow();
  });
});
