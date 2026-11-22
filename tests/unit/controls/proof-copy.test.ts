/**
 * The disposable copy commit and push proofs run in
 * (CodySwannGT/lisa#4996).
 *
 * A proof plants a change that breaks a rule and commits it. That may only
 * ever happen in a copy that is cut off from the operator's repository: a
 * clone of the last commit in a temporary folder, with no way back to the
 * repository, to its remote or to the machine's settings.
 * @module tests/unit/controls/proof-copy
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCarrierGit } from "../../../src/controls/carrier-git.js";
import { installCarriers } from "../../../src/controls/carriers.js";
import { buildProofCopy } from "../../../src/controls/proof-copy.js";
import {
  CONTROL_AUDIT_FIXTURE_FILES,
  controlAuditGitEnv,
} from "../../helpers/control-audit-fixtures.js";
import {
  ACCEPTS_EVERYTHING,
  buildProofFixture,
  checks,
  F_NONE_SOURCE,
  PROOFS,
  provedGates,
} from "../../helpers/control-proofs.js";
import { configFile } from "../../helpers/control-register.js";
import {
  repositoryState,
  withUncommittedWork,
} from "../../support/repository-state.js";
import {
  copyOf,
  gitIn,
  hookEnvironment,
  removeScratch,
  scratchFolder,
} from "./support/proof-copy-run.js";
import { keep, removeFixtures } from "./support/report-check-run.js";
import { createSymlink } from "../../support/borrowed-node-modules.mjs";

const WORKING = provedGates([{ command: checks(F_NONE_SOURCE) }]);
const COMMITTED_SOURCE = CONTROL_AUDIT_FIXTURE_FILES["F-none"][F_NONE_SOURCE];

/** The file the checks are declared in, from the repository root. */
const DECLARATION = ".lisa.config.json";

/** A remote no test may ever reach: the name does not resolve. */
const OPERATOR_REMOTE = "https://git.example.invalid/team/project.git";

/**
 * Build F-none with a working check declared and committed.
 * @returns The repository's path
 */
function repository(): string {
  return keep(buildProofFixture(WORKING)).repoPath;
}

/**
 * Read this checkout's own git settings, one `name=value` per line.
 * @param directory - The repository
 * @returns The settings
 */
function settings(directory: string): readonly string[] {
  return gitIn(directory, "config", "--list", "--local").split("\n");
}

beforeEach(() => {
  hookEnvironment();
});

afterEach(() => {
  removeScratch();
  removeFixtures();
});

describe("the disposable copy of a repository", () => {
  it("is the last commit on the operator's branch, without any work that is not committed", async () => {
    const repoPath = repository();
    const work = withUncommittedWork(repoPath, F_NONE_SOURCE);
    const before = repositoryState(repoPath);

    const copy = await copyOf(repoPath);

    expect(copy.source).toEqual({
      branch: "main",
      commit: gitIn(repoPath, "rev-parse", "HEAD"),
      dirty: true,
    });
    expect(readFileSync(path.join(copy.clone, F_NONE_SOURCE), "utf8")).toBe(
      COMMITTED_SOURCE
    );
    expect(existsSync(path.join(copy.clone, work.staged))).toBe(false);
    expect(existsSync(path.join(copy.clone, work.untracked))).toBe(false);
    expect(gitIn(copy.clone, "stash", "list")).toBe("");
    expect(gitIn(copy.clone, "symbolic-ref", "--short", "HEAD")).toBe("main");
    expect(gitIn(copy.clone, "status", "--porcelain")).toBe("");
    expect(repositoryState(repoPath)).toEqual(before);
  });

  it("is a clone in its own folder, never a linked working copy of the repository", async () => {
    const repoPath = repository();

    const copy = await copyOf(repoPath);

    expect(gitIn(copy.clone, "rev-parse", "--git-common-dir")).toBe(".git");
    expect(gitIn(repoPath, "worktree", "list").split("\n")).toHaveLength(1);
    expect(copy.clone.startsWith(`${copy.folder}${path.sep}`)).toBe(true);
    expect(copy.remote.startsWith(`${copy.folder}${path.sep}`)).toBe(true);
    expect(copy.folder.startsWith(`${repoPath}${path.sep}`)).toBe(false);
  });

  it("has no remote outside its own folder, no credential helper, and a hooks folder set only by installing the carriers", async () => {
    const repoPath = repository();
    gitIn(repoPath, "remote", "add", "origin", OPERATOR_REMOTE);
    gitIn(repoPath, "config", "credential.helper", "store");
    gitIn(repoPath, "config", "core.hooksPath", "hooks-of-my-own");

    const copy = await copyOf(repoPath);

    const everything = [...settings(copy.clone), ...settings(copy.remote)];
    const remotes = everything.filter(line => /^remote\..*\.url=/u.test(line));
    expect(remotes).toEqual([`remote.origin.url=${copy.remote}`]);
    expect(everything.join("\n")).not.toContain("example.invalid");
    expect(everything.join("\n")).not.toContain(repoPath);
    expect(everything.filter(line => line.startsWith("credential."))).toEqual(
      []
    );
    expect(
      settings(copy.clone).filter(line => line.startsWith("core.hookspath="))
    ).toEqual(["core.hookspath=.lisa/hooks"]);
    expect(copy.unwired).toEqual({ commit: null, push: null });
  });

  it("takes the declaration, the proof files and the files Lisa placed from the working copy, and nothing else", async () => {
    const { repoPath } = keep(
      buildProofFixture(provedGates([{ command: ACCEPTS_EVERYTHING }]))
    );
    const declaration = configFile(WORKING);
    const extraProof = `${PROOFS}/extra.violation.patch`;
    writeFileSync(path.join(repoPath, DECLARATION), declaration);
    writeFileSync(path.join(repoPath, extraProof), "not committed yet\n");
    writeFileSync(path.join(repoPath, "notes.txt"), "the operator's own\n");
    await installCarriers(
      repoPath,
      {},
      { git: createCarrierGit(controlAuditGitEnv()) }
    );
    gitIn(repoPath, "config", "--unset", "core.hooksPath");

    const copy = await copyOf(repoPath);

    expect(readFileSync(path.join(copy.clone, DECLARATION), "utf8")).toBe(
      declaration
    );
    expect(existsSync(path.join(copy.clone, extraProof))).toBe(true);
    expect(existsSync(path.join(copy.clone, "notes.txt"))).toBe(false);
    expect(copy.carried).toEqual(
      expect.arrayContaining([
        DECLARATION,
        ".lisa/controls/carriers.json",
        ".lisa/hooks/pre-commit",
        extraProof,
        "scripts/lisa-run-gates.mjs",
      ])
    );
    expect(copy.carried).not.toContain("notes.txt");
    expect(gitIn(copy.clone, "status", "--porcelain")).toBe("");
  });

  it("keeps the operator on no branch on no branch, and pushes to a branch of its own", async () => {
    const repoPath = repository();
    gitIn(repoPath, "checkout", "--quiet", "--detach");

    const copy = await copyOf(repoPath);

    expect(copy.source.branch).toBeNull();
    expect(copy.pushBranch).toBe("lisa-proof");
    expect(gitIn(copy.clone, "rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD");
    expect(gitIn(copy.remote, "rev-parse", "refs/heads/lisa-proof")).toBe(
      copy.base
    );
  });
});

describe("a disposable copy is refused", () => {
  /**
   * Expect no copy, for a reason, and the repository left as it was.
   * @param repoPath - The repository
   * @param saying - Text the reason must contain
   */
  async function expectNoCopy(repoPath: string, saying: string): Promise<void> {
    const before = repositoryState(repoPath);

    const built = await buildProofCopy(repoPath, scratchFolder());

    expect(built.problem).toContain(saying);
    expect(repositoryState(repoPath)).toEqual(before);
  }

  it("when the record of Lisa's files lists a path outside the repository", async () => {
    const repoPath = repository();
    const outside = path.join(path.dirname(scratchFolder()), "outside.txt");
    writeFileSync(outside, "not the repository's\n");
    mkdirSync(path.join(repoPath, ".lisa", "controls"), { recursive: true });
    writeFileSync(
      path.join(repoPath, ".lisa", "controls", "carriers.json"),
      JSON.stringify({ files: [path.relative(repoPath, outside)] })
    );

    await expectNoCopy(repoPath, "is not a path inside this repository");
    expect(readFileSync(outside, "utf8")).toBe("not the repository's\n");
  });

  it("when a file to take would be read through a link", async () => {
    const repoPath = repository();
    const elsewhere = path.dirname(scratchFolder());
    writeFileSync(path.join(elsewhere, "lisa-run-gates.mjs"), "// elsewhere\n");
    createSymlink(elsewhere, path.join(repoPath, "scripts"));
    writeFileSync(
      path.join(repoPath, ".lisa", "controls", "carriers.json"),
      JSON.stringify({ files: ["scripts/lisa-run-gates.mjs"] })
    );

    await expectNoCopy(repoPath, "scripts is not an ordinary folder");
  });

  it("when its folder would be inside the repository, before anything is created there", async () => {
    const repoPath = repository();
    const before = repositoryState(repoPath);
    const inside = path.join(repoPath, "tmp", "run");

    const built = await buildProofCopy(repoPath, inside);

    expect(built.problem).toContain("is inside this repository");
    expect(existsSync(path.join(repoPath, "tmp"))).toBe(false);
    expect(repositoryState(repoPath)).toEqual(before);
  });

  it("when the repository has no commit yet", async () => {
    const empty = path.dirname(scratchFolder());
    gitIn(empty, "init", "--quiet");

    const built = await buildProofCopy(empty, scratchFolder());

    expect(built.problem).toContain("has no commit yet");
  });

  it("when the folder is not the top of a repository", async () => {
    const repoPath = repository();

    const built = await buildProofCopy(
      path.join(repoPath, "src"),
      scratchFolder()
    );

    expect(built.problem).toContain(
      "is not the top folder of a git repository"
    );
  });
});
