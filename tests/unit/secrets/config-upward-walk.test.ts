/**
 * `.lisa.config.json` must be found from anywhere inside the project.
 *
 * Looking only in `cwd` made every session started below the repository root —
 * a worktree subdirectory, a package folder, a parent wrapper directory — fall
 * through to the environment defaults and resolve `provider: "env"`. The
 * secrets preflight then consulted the environment, the materialized file and
 * the "env" grant, found nothing, and reported the credential as resolving
 * NOWHERE, having never contacted the vault the project actually declares.
 *
 * That is a false negative wearing a definite answer's clothes. The message it
 * produced instructed the reader to route the work to blocked, so an obedient
 * agent abandoned work over a credential that was sitting in Bitwarden the
 * whole time — and unlike a crash, nothing downstream ever re-derived it.
 * @module tests/unit/secrets/config-upward-walk
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readConfig } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/surfaces.mjs";

/** The vault a project declares, which must survive a nested cwd. */
const DECLARED = "bitwarden";
/** The fallback that a missed config silently substituted for it. */
const DEFAULTED = "env";

const roots: string[] = [];

/**
 * Build a repository whose config sits at the root.
 * @param withConfig - Whether to write a `.lisa.config.json`.
 * @returns The repository root path.
 */
const makeRepo = (withConfig: boolean): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-walk-"));
  roots.push(root);
  // A worktree's `.git` is a FILE, not a directory — the boundary check must
  // treat both as a boundary, or the walk escapes the worktree entirely.
  fs.writeFileSync(path.join(root, ".git"), "gitdir: /elsewhere\n");
  if (withConfig) {
    fs.writeFileSync(
      path.join(root, ".lisa.config.json"),
      JSON.stringify({
        tracker: "linear",
        secrets: {
          provider: DECLARED,
          namespace: "tunnl",
          require: ["LINEAR_API_KEY"],
        },
      })
    );
  }
  return root;
};

describe("locating .lisa.config.json from a nested working directory", () => {
  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  it("finds the project's config from a deeply nested directory", () => {
    const root = makeRepo(true);
    const deep = path.join(root, "src", "features", "chat");
    fs.mkdirSync(deep, { recursive: true });

    expect(readConfig(root, {}).provider).toBe(DECLARED);
    // The reported failure: identical project, three levels down.
    expect(readConfig(deep, {}).provider).toBe(DECLARED);
  });

  it("reports whether the provider was declared or defaulted", () => {
    // A defaulted `env` was indistinguishable from a project that genuinely
    // uses `env`, which is what let the wrong answer look like a real one.
    const root = makeRepo(true);
    expect(readConfig(root, {}).configPath).toBeTruthy();

    const bare = makeRepo(false);
    const resolved = readConfig(bare, {});
    expect(resolved.provider).toBe(DEFAULTED);
    expect(resolved.configPath).toBeNull();
  });

  it("stops at a repository boundary rather than adopting a stranger's config", () => {
    const outer = makeRepo(true);
    const nested = path.join(outer, "vendored");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, ".git"), "gitdir: /other\n");

    // The outer config is NOT this project's. Walking past the boundary would
    // point a session at another project's vault, which is worse than the bug.
    expect(readConfig(nested, {}).provider).toBe(DEFAULTED);
  });

  it("resolves when the hook's cwd is outside the project entirely", () => {
    // The failure that actually shipped. The SessionStart hook never changes
    // directory, so its cwd is wherever the harness spawned it — $HOME, a
    // plugin cache — and a walk from there finds nothing no matter how many
    // configs sit in the project. A cwd walk alone would NOT have caught this.
    const root = makeRepo(true);
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-elsewhere-"));
    roots.push(elsewhere);

    expect(readConfig(elsewhere, {}).provider).toBe(DEFAULTED);
    expect(readConfig(elsewhere, { CLAUDE_PROJECT_DIR: root }).provider).toBe(
      DECLARED
    );
    expect(readConfig(elsewhere, { LISA_PROJECT_DIR: root }).provider).toBe(
      DECLARED
    );
  });

  it("prefers an explicit working directory over the harness hint", () => {
    // cwd is intent; the project variable is only ever a hint about the
    // session. A caller that named a directory must not be redirected.
    const inProject = makeRepo(true);
    const other = makeRepo(false);
    expect(readConfig(inProject, { CLAUDE_PROJECT_DIR: other }).provider).toBe(
      DECLARED
    );
  });

  it("ignores a blank project variable rather than resolving it to cwd", () => {
    // An unset shell variable expands to "", and resolve("") is the current
    // directory — which would silently re-search a path already searched.
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-blank-"));
    roots.push(elsewhere);
    expect(readConfig(elsewhere, { CLAUDE_PROJECT_DIR: "  " }).provider).toBe(
      DEFAULTED
    );
  });

  it("keeps no-repository as a supported state, not an error", () => {
    // A Claude Tag channel session has no checkout and still needs
    // credentials, so a missing config must resolve rather than throw.
    const resolved = readConfig(path.join(os.tmpdir(), "lisa-no-such-dir"), {
      LISA_TENANT: "tunnl",
    });
    expect(resolved.namespace).toBe("tunnl");
    expect(resolved.configPath).toBeNull();
  });
});
