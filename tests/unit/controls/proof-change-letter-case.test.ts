/**
 * What a proof's change may not touch, when the patch spells a file's name
 * in another letter case than the repository stores it under.
 *
 * On a file system that does not tell letter cases apart, git applies a
 * patch headed `.lisa.config.JSON` to the repository's `.lisa.config.json`.
 * The names the patch writes then match no file the rule knows, while the
 * file that says what the checks are has been rewritten. So the rule is
 * held to the names git reports as changed once the patch is in place as
 * well, and takes two names for one file when the file system says they
 * are.
 *
 * The first group hands the rule a stand-in for git that reports what git
 * reports on such a file system, so it runs on every machine. The second
 * plants the patch with real git and only has something to run where the
 * file system ignores letter case.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  changeFinding,
  STAGED_NAMES,
  type ChangeFinding,
  type CheckCommand,
  type CheckFiles,
} from "../../../src/controls/proof-change-rule.js";
import { copyGit, type RunGit } from "../../../src/controls/proof-copy-git.js";
import { applyProofPatch } from "../../../src/controls/proof-patch.js";
import { temporaryFoldersIgnoreLetterCase } from "../../support/letter-case.js";
import {
  changeRuleRepository,
  DECLARATION,
  git,
  IGNORED_TOOL,
  MANIFEST,
  manifestOf,
  patchOf,
  SCRIPT,
  SOURCE,
  write,
} from "./support/change-rule-repository.js";
import { removeFixtures } from "./support/report-check-run.js";

const RULE: CheckFiles = {
  files: [DECLARATION, ".lisa/controls/carriers.json"],
  folders: [".lisa/hooks"],
};

const NPM: CheckCommand = { argv: ["npm", "run", "lint"], scope: "." };
const DIRECT: CheckCommand = { argv: ["ruff", "check", "."], scope: "." };
const STARTS_SCRIPT: CheckCommand = { argv: [`./${SCRIPT}`], scope: "." };
const CHECK_FILE = "check-file";
const RUNNER_MANIFEST = "runner-manifest";
const PACKAGE_SCRIPTS = "package-scripts";
const HOOK = ".lisa/hooks/pre-commit";
const HOOK_RESPELLED = ".lisa/Hooks/pre-commit";
const MANIFEST_RESPELLED = "Package.json";
const FAILING_SCRIPT = "#!/bin/sh\nexit 1\n";
const SCRIPTS_SWAPPED = manifestOf({
  name: "fixture",
  scripts: { lint: "echo 'Found 1 error'; exit 1" },
  dependencies: {},
});
const DEPENDENCY_ADDED = manifestOf({
  name: "fixture",
  scripts: { lint: "true" },
  dependencies: { left: "1.0.0" },
});

/** Why the planted cases do not run where letter cases are told apart. */
const NOT_HERE =
  "the temporary folder is on a file system that tells letter cases apart, where git does not apply a patch to a file under another spelling of its name";

/** Whether the repositories these cases build ignore letter case. */
const IGNORES_CASE = temporaryFoldersIgnoreLetterCase();

/**
 * A patch that changes one line of a file, under the name it is given.
 * @param file - The name the patch writes
 * @returns The patch
 */
function editOf(file: string): string {
  return [`--- a/${file}`, `+++ b/${file}`, "@@ -1 +1 @@", "-a", "+b", ""].join(
    "\n"
  );
}

/**
 * A stand-in for git in a folder where a change is staged.
 * @param staged - The names git reports as changed
 * @param sides - What `revision:file` holds, for each one that is there
 * @returns Answers the two questions the rule asks of git
 */
function gitReporting(
  staged: readonly string[],
  sides: Readonly<Record<string, string>> = {}
): RunGit {
  return args => {
    if (args.join(" ") === STAGED_NAMES.join(" ")) {
      return {
        code: 0,
        stderr: "",
        stdout: staged.map(name => `${name}\0`).join(""),
      };
    }
    const text = args[0] === "cat-file" ? sides[args[2] ?? ""] : undefined;
    return text === undefined
      ? { code: 128, stderr: "not there", stdout: "" }
      : { code: 0, stderr: "", stdout: text };
  };
}

/**
 * Hold a patch to the rule where git reports other names than it writes.
 * @param patch - The patch
 * @param reported - What the stand-in for git reports
 * @param command - The check's command
 * @returns What the rule found
 */
function foundWhere(
  patch: string,
  reported: RunGit,
  command: CheckCommand = DIRECT
): ChangeFinding | null {
  return changeFinding({
    checkFiles: RULE,
    command,
    directory: changeRuleRepository(),
    git: reported,
    patch,
  });
}

/**
 * Build a repository whose hooks folder is there before any change, as in a
 * repository whose carriers are installed.
 * @returns The repository's root
 */
function repositoryWithHooks(): string {
  const repo = changeRuleRepository();
  write(repo, ".lisa/hooks/pre-push", "#!/bin/sh\nexit 0\n");
  git(repo, "add", "--all");
  git(repo, "commit", "--quiet", "-m", "hooks");
  return repo;
}

/**
 * Plant a change with real git under other names than the change was made
 * under, and hold it to the rule.
 * @param change - Makes the change in the working copy of a new repository
 * @param respell - Rewrites the names in the patch
 * @param command - The check's command
 * @returns What the rule found
 */
function planted(
  change: (repo: string) => void,
  respell: (patch: string) => string,
  command: CheckCommand = DIRECT
): ChangeFinding | null {
  const repo = repositoryWithHooks();
  const patch = respell(
    patchOf(repo, () => {
      change(repo);
    })
  );
  const put = applyProofPatch(repo, patch);
  if (put.problem !== null) throw new Error(put.problem);
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

describe("a change git reports under another name than the patch writes", () => {
  it("is found to edit the declaration", () => {
    expect(
      foundWhere(editOf(".lisa.config.JSON"), gitReporting([DECLARATION]))
    ).toEqual({ kind: CHECK_FILE, file: DECLARATION });
  });

  it("is found to edit a file in the hooks folder", () => {
    expect(foundWhere(editOf(HOOK_RESPELLED), gitReporting([HOOK]))).toEqual({
      kind: CHECK_FILE,
      file: HOOK,
    });
  });

  it("is found to edit the program the command starts", () => {
    expect(
      foundWhere(
        editOf("scripts/Lint.SH"),
        gitReporting([SCRIPT]),
        STARTS_SCRIPT
      )
    ).toEqual({ kind: "program", file: SCRIPT });
  });

  it("is found to swap a script in package.json, for a check run through npm", () => {
    const reported = gitReporting([MANIFEST], {
      [`HEAD:${MANIFEST}`]: DEPENDENCY_ADDED,
      [`:${MANIFEST}`]: SCRIPTS_SWAPPED,
    });

    expect(foundWhere(editOf(MANIFEST_RESPELLED), reported, NPM)).toEqual({
      kind: RUNNER_MANIFEST,
      file: MANIFEST,
      runner: PACKAGE_SCRIPTS,
    });
  });

  it("is still found to put a file at an ignored path, which git reports under no name", () => {
    const repo = changeRuleRepository();
    const patch = patchOf(repo, () => {
      write(repo, IGNORED_TOOL, "x\n");
    });
    write(repo, IGNORED_TOOL, "x\n");

    expect(
      changeFinding({
        checkFiles: RULE,
        command: DIRECT,
        directory: repo,
        git: gitReporting([]),
        patch,
      })
    ).toEqual({ kind: "ignored-path", file: IGNORED_TOOL });
  });

  it("leaves the check alone when neither the patch nor git names a file that says what the check is", () => {
    expect(
      foundWhere(editOf("src/App.txt"), gitReporting([SOURCE]), NPM)
    ).toBeNull();
  });
});

describe("a change planted where the file system ignores letter case", () => {
  it.for([
    {
      name: "edits the declaration as .lisa.config.JSON",
      change: (repo: string) => {
        write(repo, DECLARATION, '{ "gates": { "x": {} } }\n');
      },
      respell: [DECLARATION, ".lisa.config.JSON"],
      command: DIRECT,
      found: { kind: CHECK_FILE, file: DECLARATION },
    },
    {
      name: "removes the declaration as .LISA.config.json",
      change: (repo: string) => {
        git(repo, "rm", "--quiet", DECLARATION);
      },
      respell: [DECLARATION, ".LISA.config.json"],
      command: DIRECT,
      found: { kind: CHECK_FILE, file: DECLARATION },
    },
    {
      name: "adds a file to the hooks folder as .lisa/Hooks/pre-commit",
      change: (repo: string) => {
        write(repo, HOOK, "#!/bin/sh\nexit 0\n");
      },
      respell: [HOOK, HOOK_RESPELLED],
      command: DIRECT,
      found: { kind: CHECK_FILE, file: HOOK },
    },
    {
      name: "edits the program the command starts as scripts/Lint.SH",
      change: (repo: string) => {
        write(repo, SCRIPT, FAILING_SCRIPT);
      },
      respell: [SCRIPT, "scripts/Lint.SH"],
      command: STARTS_SCRIPT,
      found: { kind: "program", file: SCRIPT },
    },
    {
      name: "edits the program a command starts as ./Scripts/LINT.sh",
      change: (repo: string) => {
        write(repo, SCRIPT, FAILING_SCRIPT);
      },
      respell: [SCRIPT, SCRIPT],
      command: { argv: ["./Scripts/LINT.sh"], scope: "." },
      found: { kind: "program", file: "Scripts/LINT.sh" },
    },
    {
      name: "swaps a script in Package.json, for a check run through npm",
      change: (repo: string) => {
        write(repo, MANIFEST, SCRIPTS_SWAPPED);
      },
      respell: [MANIFEST, MANIFEST_RESPELLED],
      command: NPM,
      found: { kind: RUNNER_MANIFEST, file: MANIFEST, runner: PACKAGE_SCRIPTS },
    },
    {
      name: "adds src/Package.json nearer the check's folder, for a check run through npm",
      change: (repo: string) => {
        write(repo, "src/package.json", SCRIPTS_SWAPPED);
      },
      respell: ["src/package.json", "src/Package.json"],
      command: { argv: NPM.argv, scope: "src" },
      found: {
        kind: RUNNER_MANIFEST,
        file: "src/Package.json",
        runner: PACKAGE_SCRIPTS,
      },
    },
    {
      name: "adds a rules file as build/Rules.MK, for a check run through make",
      change: (repo: string) => {
        write(repo, "build/rules.mk", "lint:\n\tfalse\n");
      },
      respell: ["build/rules.mk", "build/Rules.MK"],
      command: { argv: ["make", "lint"], scope: "." },
      found: { kind: RUNNER_MANIFEST, file: "build/Rules.MK", runner: "make" },
    },
  ])("is found when it $name", (each, context) => {
    context.skip(!IGNORES_CASE, NOT_HERE);
    const [from = "", to = ""] = each.respell;

    expect(
      planted(each.change, patch => patch.replaceAll(from, to), each.command)
    ).toEqual(each.found);
  });

  it("is taken for the file it is: a dependency changed in Package.json leaves a check run through npm alone", context => {
    context.skip(!IGNORES_CASE, NOT_HERE);

    expect(
      planted(
        repo => {
          write(repo, MANIFEST, DEPENDENCY_ADDED);
        },
        patch => patch.replaceAll(MANIFEST, MANIFEST_RESPELLED),
        NPM
      )
    ).toBeNull();
  });
});
