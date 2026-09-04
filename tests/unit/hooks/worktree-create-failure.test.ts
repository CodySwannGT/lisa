/**
 * Failure semantics for the managed WorktreeCreate hook.
 * @module tests/unit/hooks/worktree-create-failure
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";

const HOOK = path.resolve(
  "typescript/copy-overwrite/.claude/hooks/worktree-create.sh"
);
const GIT = resolveGit();
const SHELL = "/bin/sh";
const IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};
const hasJq =
  boundedSpawnSync({
    label: "command -v jq",
    command: SHELL,
    args: ["-c", "command -v jq"],
  }).status === 0;
let roots: string[] = [];

afterEach(() => {
  roots.forEach(root => rmSync(root, { force: true, recursive: true }));
  roots = [];
});

describe.skipIf(!hasJq)("WorktreeCreate git failure", () => {
  it("fails even when a failed git command left the target directory behind", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-worktree-failure-"));
    roots.push(root);
    boundedSpawnSync({
      label: "git init",
      command: GIT,
      args: ["init", "-q"],
      cwd: root,
    });
    boundedSpawnSync({
      label: "git commit",
      command: GIT,
      args: ["commit", "-q", "--allow-empty", "-m", "init"],
      cwd: root,
      env: { ...process.env, ...IDENTITY },
    });
    const target = path.join(root, ".claude", "worktrees", "partial");
    const fakeBin = path.join(root, "fake-bin");
    const fakeGit = path.join(fakeBin, "git");
    mkdirSync(fakeBin);
    writeFileSync(
      fakeGit,
      `#!/bin/sh\nif [ "$3" = worktree ] && [ "$4" = add ]; then\n  mkdir -p "${target}"\n  echo deliberate-worktree-add-failure >&2\n  exit 42\nfi\nexec "${GIT}" "$@"\n`
    );
    chmodSync(fakeGit, 0o755);

    const result = boundedSpawnSync({
      label: "worktree-create.sh",
      command: SHELL,
      args: [HOOK],
      cwd: root,
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
      input: JSON.stringify({ name: "partial", cwd: root }),
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("deliberate-worktree-add-failure");
  });
});
