/**
 * What a proof's change may not touch, held on real patches planted in a
 * real repository.
 *
 * A proof never changes what the check is. Beside the files that declare
 * and start the checks, that covers the program the check's command starts,
 * the script or target the command runs through a package manager or task
 * runner, and any path the repository ignores: git leaves an ignored file
 * out of a commit, so the check would be shown a change without it while
 * its command finds it on disk.
 */
import { rmSync, symlinkSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  changeFinding,
  type ChangeFinding,
  type CheckCommand,
  type CheckFiles,
} from "../../../src/controls/proof-change-rule.js";
import { copyGit } from "../../../src/controls/proof-copy-git.js";
import { applyProofPatch } from "../../../src/controls/proof-patch.js";
import {
  changeRuleRepository,
  DECLARATION,
  git,
  IGNORE_FILE,
  IGNORED_TOOL,
  MANIFEST,
  manifestOf,
  patchOf,
  SCRIPT,
  SOURCE,
  TRACKED_IN_IGNORED,
  write,
} from "./support/change-rule-repository.js";
import { removeFixtures } from "./support/report-check-run.js";

const RULE: CheckFiles = {
  files: [DECLARATION, ".lisa/controls/carriers.json"],
  folders: [".lisa/hooks"],
};

const NPM: CheckCommand = { argv: ["npm", "run", "lint"], scope: "." };
const DIRECT: CheckCommand = { argv: ["ruff", "check", "."], scope: "." };
const IGNORED = "ignored-path";
const CHECK_FILE = "check-file";
const RUNNER_MANIFEST = "runner-manifest";
const EDITED = "one\nmore\n";
const FAILING_SCRIPT = "#!/bin/sh\nexit 1\n";

/**
 * Plant a change the way a proof's workspace does, and hold it to the rule.
 * @param change - Makes the change in the working copy of a new repository
 * @param command - The check's command, or `null` when there is none
 * @returns What the rule found
 */
function found(
  change: (repo: string) => void,
  command: CheckCommand | null = DIRECT
): ChangeFinding | null {
  const repo = changeRuleRepository();
  const patch = patchOf(repo, () => {
    change(repo);
  });
  const planted = applyProofPatch(repo, patch);
  if (planted.problem !== null) throw new Error(planted.problem);
  git(repo, "add", "--all");
  return changeFinding({
    checkFiles: RULE,
    command,
    directory: repo,
    git: copyGit(repo),
    patch,
  });
}

afterEach(() => {
  removeFixtures();
});

describe("a change that leaves the check alone", () => {
  it.each([
    ["edits a source file", DIRECT],
    ["edits a source file, for a check run through npm", NPM],
    ["edits a source file, for something that is not a command", null],
  ])("is one that %s", (_name, command) => {
    expect(found(repo => write(repo, SOURCE, EDITED), command)).toBeNull();
  });

  it("is one that edits a tracked file at a path an ignore file names: git shows it", () => {
    expect(
      found(repo => write(repo, TRACKED_IN_IGNORED, "kept\nchanged\n"))
    ).toBeNull();
  });

  it("is one that removes a tracked file at a path an ignore file names: git shows it", () => {
    expect(
      found(repo => rmSync(path.join(repo, TRACKED_IN_IGNORED)))
    ).toBeNull();
  });

  it("is one that changes a dependency in package.json and none of its scripts, for a check run through npm", () => {
    const after = manifestOf({
      name: "fixture",
      scripts: { lint: "true" },
      dependencies: { left: "1.0.0" },
    });

    expect(found(repo => write(repo, MANIFEST, after), NPM)).toBeNull();
  });

  it("is one that edits package.json's scripts when the check's command goes through no package manager", () => {
    const after = manifestOf({ scripts: { lint: "false" } });

    expect(found(repo => write(repo, MANIFEST, after), DIRECT)).toBeNull();
  });

  it("is one that edits a script the command only hands to a shell: nothing says the file is the program", () => {
    expect(
      found(repo => write(repo, SCRIPT, FAILING_SCRIPT), {
        argv: ["sh", SCRIPT],
        scope: ".",
      })
    ).toBeNull();
  });
});

describe("a change that puts something else where a folder was", () => {
  it("is one that leaves the check alone when a file takes the folder's place: nothing is at the paths under it", () => {
    expect(
      found(repo => {
        rmSync(path.join(repo, "src"), { recursive: true });
        write(repo, "src", "now a file\n");
      })
    ).toBeNull();
  });

  it("is one that leaves the check alone when a link takes the folder's place, to a folder that holds a file of the same name", () => {
    expect(
      found(repo => {
        write(repo, "lib/app.txt", "one\n");
        rmSync(path.join(repo, "src"), { recursive: true });
        symlinkSync("lib", path.join(repo, "src"));
      })
    ).toBeNull();
  });

  it("is still found to put a file at an ignored path beside the file that takes the folder's place", () => {
    expect(
      found(repo => {
        rmSync(path.join(repo, "src"), { recursive: true });
        write(repo, "src", "now a file\n");
        write(repo, IGNORED_TOOL, "x\n");
      })
    ).toEqual({ kind: IGNORED, file: IGNORED_TOOL });
  });
});

describe("a change that puts a file where the repository ignores it", () => {
  it("is found when the file is a program under node_modules/.bin, beside an honest edit", () => {
    expect(
      found(repo => {
        write(repo, SOURCE, EDITED);
        write(repo, IGNORED_TOOL, "#!/bin/sh\necho planted\n");
      })
    ).toEqual({ kind: IGNORED, file: IGNORED_TOOL });
  });

  it("is found when the same patch adds the ignore rule that hides the file", () => {
    expect(
      found(repo => {
        write(repo, ".gitignore", `${IGNORE_FILE}tools/\n`);
        write(repo, "tools/lint", FAILING_SCRIPT);
      })
    ).toEqual({ kind: IGNORED, file: "tools/lint" });
  });

  it("is found when the ignore rule is added in a folder's own ignore file", () => {
    expect(
      found(repo => {
        write(repo, "src/.gitignore", "generated/\n");
        write(repo, "src/generated/out.txt", "x\n");
      })
    ).toEqual({ kind: IGNORED, file: "src/generated/out.txt" });
  });

  it("is found for something that is not a command too", () => {
    expect(found(repo => write(repo, ".cache/state", "x\n"), null)).toEqual({
      kind: IGNORED,
      file: ".cache/state",
    });
  });
});

describe("a change that edits what the check is", () => {
  it("is found when it renames the declaration, by the name the file had", () => {
    expect(
      found(repo => {
        git(repo, "mv", DECLARATION, "config.json");
      })
    ).toEqual({ kind: CHECK_FILE, file: DECLARATION });
  });

  it("is found when it removes the declaration", () => {
    expect(found(repo => rmSync(path.join(repo, DECLARATION)))).toEqual({
      kind: CHECK_FILE,
      file: DECLARATION,
    });
  });

  it("is found when it adds a file to the hooks folder", () => {
    const hook = ".lisa/hooks/pre-commit";

    expect(found(repo => write(repo, hook, "#!/bin/sh\nexit 0\n"))).toEqual({
      kind: CHECK_FILE,
      file: hook,
    });
  });

  it("is found when it edits the program the command starts", () => {
    expect(
      found(repo => write(repo, SCRIPT, FAILING_SCRIPT), {
        argv: [`./${SCRIPT}`, "--all"],
        scope: ".",
      })
    ).toEqual({ kind: "program", file: SCRIPT });
  });

  it("is found when it swaps a script in package.json, for a check run through npm", () => {
    const after = manifestOf({
      name: "fixture",
      scripts: { lint: "echo 'Found 1 error'; exit 1" },
      dependencies: {},
    });

    expect(found(repo => write(repo, MANIFEST, after), NPM)).toEqual({
      kind: RUNNER_MANIFEST,
      file: MANIFEST,
      runner: "package-scripts",
    });
  });

  it("is found when it adds a package.json nearer the check's folder, for a check run through npm", () => {
    const nearer = "src/package.json";

    expect(
      found(
        repo => write(repo, nearer, manifestOf({ scripts: { lint: "false" } })),
        { argv: NPM.argv, scope: "src" }
      )
    ).toEqual({
      kind: RUNNER_MANIFEST,
      file: nearer,
      runner: "package-scripts",
    });
  });

  it("is found when it adds a rules file, for a check run through make", () => {
    const rules = "build/rules.mk";

    expect(
      found(repo => write(repo, rules, "lint:\n\tfalse\n"), {
        argv: ["make", "lint"],
        scope: ".",
      })
    ).toEqual({ kind: RUNNER_MANIFEST, file: rules, runner: "make" });
  });

  it("is found first when the same change also puts a file at an ignored path", () => {
    expect(
      found(repo => {
        write(repo, DECLARATION, '{ "gates": { "x": {} } }\n');
        write(repo, IGNORED_TOOL, "x\n");
      })
    ).toEqual({ kind: CHECK_FILE, file: DECLARATION });
  });
});
