/**
 * What `lisa controls install-carriers` refuses to do, and what it leaves
 * behind (CodySwannGT/lisa#4989).
 *
 * - It never replaces a file it did not write, and then writes nothing.
 * - A push through the installed hook runs the declared check and leaves the
 *   working tree clean, although the runner records its timings in the
 *   repository.
 * - A new clone, which has the committed files but not the setting, is
 *   reported by `--check` and wired by one run.
 * - A linked worktree, where `.git` is a file, is wired through git's own
 *   answer to where hooks live.
 * - A hook file that lines cannot safely be added to is left as it is, with
 *   the reason.
 * @module tests/integration/controls-install-carriers-safety
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CARRIER_RECORD_PATH } from "../../src/controls/carrier-types.js";
import {
  CARRIERS_BLOCKED_EXIT_CODE,
  CHECK_WOULD_CHANGE_EXIT_CODE,
} from "../../src/controls/commands/install-carriers.js";
import { buildFNone } from "../helpers/control-audit-fixtures.js";
import {
  gitHooksFolder,
  writeExecutable,
} from "../support/carrier-hook-owners.js";
import {
  type CarrierRepository,
  carrierRepository,
  commitInstalled,
  commitLine,
  dirt,
  head,
  installCarriers,
  operatorGit,
  PLANTED,
  runs,
} from "../support/carrier-install.js";

const HOOKS_PATH = "core.hooksPath";
const FOREIGN = "scripts/lisa-gates.mjs";
const FOREIGN_CONTENT = "// The repository's own file of this name.\n";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Build F-none with a declared check, removed when the case ends.
 * @returns The repository
 */
function declared(): CarrierRepository {
  const built = carrierRepository();
  cleanups.push(built.repository.cleanup);
  return built;
}

/**
 * A folder outside every repository, removed when the case ends.
 * @param name - What the folder is for
 * @returns The folder
 */
function outside(name: string): string {
  const folder = mkdtempSync(path.join(tmpdir(), `lisa-carrier-${name}-`));
  cleanups.push(() => rmSync(folder, { force: true, recursive: true }));
  return folder;
}

/**
 * Run git and require it to succeed.
 * @param root - The repository
 * @param args - Arguments to git
 * @returns What git printed
 */
function git(root: string, args: readonly string[]): string {
  const child = operatorGit(root, args);
  if (child.status !== 0) throw new Error(`${child.stdout}${child.stderr}`);
  return child.stdout.trim();
}

describe("install-carriers and files it did not write", () => {
  it("refuses to replace one, and then writes nothing at all", async () => {
    const fixture = buildFNone({ extraFiles: { [FOREIGN]: FOREIGN_CONTENT } });
    cleanups.push(fixture.cleanup);

    const run = await installCarriers(fixture.repoPath);

    expect(run.code).toBe(CARRIERS_BLOCKED_EXIT_CODE);
    expect(run.result?.runner.outcome).toBe("blocked");
    expect(run.result?.runner.reason).toMatch(
      /^scripts\/lisa-gates\.mjs is already in this repository and was not written by this command/u
    );
    expect(run.result?.enforcement_points.map(point => point.outcome)).toEqual([
      "blocked",
      "blocked",
    ]);
    expect(run.result?.changes).toEqual([]);
    expect(readFileSync(path.join(fixture.repoPath, FOREIGN), "utf8")).toBe(
      FOREIGN_CONTENT
    );
    expect(dirt(fixture.repoPath)).toBe("");
    expect(operatorGit(fixture.repoPath, ["config", HOOKS_PATH]).stdout).toBe(
      ""
    );
  });

  it("replaces a file of its own that has changed, and says updated", async () => {
    const built = declared();
    await installCarriers(built.root);
    commitInstalled(built.root);
    writeFileSync(path.join(built.root, FOREIGN), "// edited by hand\n");

    const run = await installCarriers(built.root);

    expect(run.code).toBe(0);
    expect(run.result?.runner.outcome).toBe("updated");
    expect(run.result?.changes).toEqual([{ action: "update", path: FOREIGN }]);
    expect(run.result?.outcome).toBe("updated");
  });

  it("leaves a hook that is not a shell script as it is, and says why", async () => {
    const built = declared();
    const hook = path.join(gitHooksFolder(built.root), "pre-commit");
    const program = "#!/usr/bin/env python3\nprint('host check')\n";
    writeExecutable(hook, program);

    const run = await installCarriers(built.root);
    const [commit, push] = run.result?.enforcement_points ?? [];

    expect(run.code).toBe(CARRIERS_BLOCKED_EXIT_CODE);
    expect(commit?.outcome).toBe("blocked");
    expect(commit?.reason).toMatch(/is not a shell script/u);
    expect(push?.outcome).toBe("installed");
    expect(readFileSync(hook, "utf8")).toBe(program);
  });

  it("leaves a hook that hands over to another program as it is, and says why", async () => {
    const built = declared();
    const hook = path.join(gitHooksFolder(built.root), "pre-commit");
    const script = '#!/bin/sh\nexec some-other-program "$@"\n';
    writeExecutable(hook, script);

    const run = await installCarriers(built.root);

    expect(run.result?.enforcement_points[0]?.reason).toMatch(
      /can leave at line 2 before its end \(an "exec" there hands over to another program\), so lines added at its end might never run/u
    );
    expect(readFileSync(hook, "utf8")).toBe(script);
  });
});

describe("install-carriers and what it leaves in the repository", () => {
  it("leaves the tree clean after a push that ran the declared check", async () => {
    const built = declared();
    const remote = outside("remote");
    git(remote, ["init", "--quiet", "--bare", "."]);
    git(built.root, ["remote", "add", "origin", remote]);
    await installCarriers(built.root);
    commitInstalled(built.root);

    const push = operatorGit(built.root, ["push", "origin", "main"]);
    const timings = path.join(built.root, ".lisa/push-timing");

    expect(push.status).toBe(0);
    expect(runs(built.pushRan)).toBe(1);
    expect(existsSync(timings) ? readdirSync(timings) : []).toHaveLength(1);
    expect(dirt(built.root)).toBe("");
    expect(git(remote, ["rev-parse", "main"])).toBe(head(built.root));
  });

  it("is reported by --check in a new clone, and wired there by one run", async () => {
    const built = declared();
    await installCarriers(built.root);
    commitInstalled(built.root);
    const clone = path.join(outside("clone"), "clone");
    git(built.root, ["clone", "--quiet", built.root, clone]);

    const check = await installCarriers(clone, { check: true });
    const run = await installCarriers(clone);
    const rejected = commitLine(clone, `# ${PLANTED}`);

    expect(check.code).toBe(CHECK_WOULD_CHANGE_EXIT_CODE);
    expect(check.result?.changes).toEqual([
      { action: "set", path: HOOKS_PATH },
    ]);
    expect(run.code).toBe(0);
    expect(run.result?.changes).toEqual([{ action: "set", path: HOOKS_PATH }]);
    expect(run.said.join("\n")).toMatch(
      /In each new checkout, run "lisa controls install-carriers" once/u
    );
    expect(existsSync(path.join(clone, CARRIER_RECORD_PATH))).toBe(true);
    expect(rejected.status).not.toBe(0);
  });

  it("wires a linked worktree, where .git is a file", async () => {
    const built = declared();
    const worktree = path.join(outside("worktree"), "linked");
    git(built.root, ["worktree", "add", "--quiet", "-b", "linked", worktree]);

    const run = await installCarriers(worktree);
    commitInstalled(worktree);
    const rejected = commitLine(worktree, `# ${PLANTED}`);

    expect(readFileSync(path.join(worktree, ".git"), "utf8")).toMatch(
      /^gitdir: /u
    );
    expect(run.code).toBe(0);
    expect(run.result?.outcome).toBe("installed");
    expect(rejected.status).not.toBe(0);
    expect(dirt(built.root)).toBe("");
  });

  it("refuses a folder that is not the top of a repository", async () => {
    const built = declared();

    const run = await installCarriers(path.join(built.root, "src"));

    expect(run.code).toBe(1);
    expect(run.result).toBeNull();
    expect(run.said.join("\n")).toMatch(
      /is not the top folder of a git repository/u
    );
  });
});
