/**
 * The call to a carrier, where git names folders by a drive letter.
 *
 * Git for Windows hands a hook `GIT_DIR=C:/…`, and starts a hook that is in
 * git's own hooks folder of a linked working tree, or in a hooks folder
 * named by an absolute `core.hooksPath`, as `C:/…/pre-commit`. The lines
 * added to a repository's hook ask two things of such values: is `GIT_DIR`
 * an absolute path, and is `$0` one. Asked only whether they begin with a
 * slash, both answers were no, the lines could not tell which repository
 * the hook was started for, and every commit and push stopped.
 *
 * Nobody has run this on Windows. What is held here is the shell text
 * itself: the generated lines are run by each shell on this machine, with
 * `GIT_DIR` and `$0` set to drive-letter paths, against a stand-in for git
 * that answers the way Git for Windows does.
 *
 * A machine with no drives is given one: a folder stands for the drive, and
 * the shell is started in a folder that holds a link named `C:` to it, so
 * `C:/repo` leads to the checkout from where the shell is. The checkout
 * itself holds no such link, so `C:/repo/C:/…` leads nowhere, as on
 * Windows.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  carrierCallBlock,
  carrierScriptPath,
} from "../../../src/controls/carrier-script.js";
import {
  CARRIER_HOOKS,
  CARRIER_MOMENTS,
  type CarrierMoment,
} from "../../../src/controls/carrier-types.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** Every shell on this machine a repository's hook may be run by. */
const SHELLS = ["/bin/sh", "/bin/dash", "/bin/bash", "/bin/zsh", "/bin/ksh"]
  .filter(shell => existsSync(shell))
  .flatMap(shell => CARRIER_MOMENTS.map(moment => [shell, moment] as const));

/** The checkout, as the stand-in for git names it. */
const TOP = "C:/repo";

/** The repository of the checkout, as the stand-in for git names it. */
const GIT_FOLDER = "C:/main/.git/worktrees/repo";

/** A hooks folder outside every repository, named by a drive letter. */
const SHARED_HOOKS = "C:/hooks";

/** What the stand-in carrier prints when the hook starts it. */
const CARRIER_RAN = "the carrier ran";

/**
 * A stand-in for git that answers the questions the lines ask, with the
 * values it is handed in the environment. Asked for the repository's folder
 * it gives the one it was named when `GIT_DIR` is set and the one it finds
 * when it is not, as git does; and it writes that folder its own way
 * however `GIT_DIR` was written, as git does.
 */
const STAND_IN_GIT = [
  "#!/bin/sh",
  'case "$*" in',
  '  "rev-parse --show-toplevel") echo "$STAND_IN_TOP" ;;',
  '  "rev-parse --absolute-git-dir")',
  '    if [ -n "${GIT_DIR:-}" ]; then echo "$STAND_IN_NAMED"; else echo "$STAND_IN_FOUND"; fi ;;',
  '  "rev-parse --git-path hooks/"*) echo "$STAND_IN_HOOKS/${3##*/}" ;;',
  "  *) exit 1 ;;",
  "esac",
  "",
].join("\n");

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** How one hook is started. */
interface Start {
  /** The shell that runs the hook. */
  readonly shell: string;
  /** The moment the hook is for. */
  readonly moment: CarrierMoment;
  /** The hook file, as git starts it: what the hook reads as `$0`. */
  readonly started: string;
  /** What git hands the hook as `GIT_DIR`; none when left out. */
  readonly gitDir?: string;
  /**
   * The repository's folder git finds from the top folder; the one it was
   * named when left out.
   */
  readonly found?: string;
  /** The status the stand-in carrier ends with; 0 when left out. */
  readonly carrierStatus?: number;
}

/**
 * Write a file, making its folder first.
 * @param file - The file
 * @param content - What it holds
 */
function put(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  chmodSync(file, 0o755);
}

/**
 * Build the drive a hook is run on: the checkout with its carrier, the
 * stand-in for git, the hook file, and the folder the shell is started in.
 * @param start - How the hook is started
 * @returns The folder to start the shell in, and the folder git is in
 */
function driveFor(start: Start): {
  readonly from: string;
  readonly tools: string;
} {
  const { moment, started } = start;
  const drive = realpathSync(mkdtempSync(path.join(tmpdir(), "lisa-drive-")));
  const top = path.join(drive, "repo");
  const tools = path.join(drive, "tools");
  const from = path.join(drive, "started-in");
  const [first = ""] = started.split("/");
  cleanups.push(() => rmSync(drive, { force: true, recursive: true }));
  put(path.join(tools, "git"), STAND_IN_GIT);
  put(
    path.join(top, carrierScriptPath(moment)),
    `#!/bin/sh\necho "${CARRIER_RAN}"\nexit ${String(start.carrierStatus ?? 0)}\n`
  );
  // `C:/…` leads to the drive from the folder the shell is started in.
  mkdirSync(from);
  symlinkSync("..", path.join(from, "C:"));
  if (first !== "C:") {
    // A hook git starts by its path from the top folder is in the checkout.
    mkdirSync(path.join(top, first));
    symlinkSync(path.join(top, first), path.join(from, first));
  }
  put(path.join(from, started), `#!/bin/sh\n${carrierCallBlock(moment)}\n`);
  return { from, tools };
}

/**
 * Run the generated lines as a hook, the way Git for Windows would start
 * them.
 * @param start - How the hook is started
 * @returns The hook's exit status and everything it printed
 */
function hookRun(start: Start): {
  readonly status: number | null;
  readonly said: string;
} {
  const { shell, started, gitDir, found = GIT_FOLDER } = start;
  const { from, tools } = driveFor(start);
  const finished = boundedSpawnSync({
    label: `${shell} on a hook started as ${started}`,
    command: shell,
    args: [started],
    cwd: from,
    env: {
      PATH: `${tools}:/usr/bin:/bin`,
      STAND_IN_TOP: TOP,
      STAND_IN_NAMED: GIT_FOLDER,
      STAND_IN_FOUND: found,
      STAND_IN_HOOKS: SHARED_HOOKS,
      ...(gitDir === undefined ? {} : { GIT_DIR: gitDir }),
    },
  });
  return {
    status: finished.status,
    said: `${finished.stdout ?? ""}${finished.stderr ?? ""}`,
  };
}

describe.each(SHELLS)(
  "the call to the carrier, run by %s at the %s moment where git names folders by a drive letter",
  (shell, moment) => {
    const inGitFolder = `C:/main/.git/hooks/${CARRIER_HOOKS[moment]}`;
    const inSharedFolder = `${SHARED_HOOKS}/${CARRIER_HOOKS[moment]}`;

    it.each([
      ["with forward slashes", GIT_FOLDER],
      ["with backslashes", String.raw`C:\main\.git\worktrees\repo`],
      ["with a small drive letter", "c:/main/.git/worktrees/repo"],
    ])(
      "starts the carrier when git names the repository %s and the hook is in git's own hooks folder",
      (_name, gitDir) => {
        const run = hookRun({ shell, moment, started: inGitFolder, gitDir });

        expect(run).toEqual({ status: 0, said: `${CARRIER_RAN}\n` });
      }
    );

    it("starts the carrier when git names no repository and starts the hook by a drive-letter path", () => {
      const run = hookRun({ shell, moment, started: inSharedFolder });

      expect(run).toEqual({ status: 0, said: `${CARRIER_RAN}\n` });
    });

    it("ends with the carrier's status when the carrier fails", () => {
      const run = hookRun({
        shell,
        moment,
        started: inGitFolder,
        gitDir: GIT_FOLDER,
        carrierStatus: 7,
      });

      expect(run.status).toBe(7);
    });

    it("still stops when the repository git finds from the top folder is not the one it named", () => {
      const run = hookRun({
        shell,
        moment,
        started: inGitFolder,
        gitDir: GIT_FOLDER,
        found: "C:/other/.git",
      });

      expect(run.status).toBe(1);
      expect(run.said).toMatch(/stopped: this hook can no longer tell/u);
      expect(run.said).not.toContain(CARRIER_RAN);
    });

    it("still stops when the hook git started by a drive-letter path is not the one git would run there", () => {
      const run = hookRun({
        shell,
        moment,
        started: `C:/elsewhere/${CARRIER_HOOKS[moment]}`,
      });

      expect(run.status).toBe(1);
      expect(run.said).not.toContain(CARRIER_RAN);
    });

    it.each(["C:main/.git", "C:", "CD:/main/.git", "1:/main/.git", ".git"])(
      "does not take GIT_DIR=%s for a drive-letter path: the hook file decides",
      gitDir => {
        // The hook is found under its own name in the top folder, which is
        // what counts when git named no repository by an absolute path.
        const started = `.husky/${CARRIER_HOOKS[moment]}`;
        const run = hookRun({
          shell,
          moment,
          started,
          gitDir,
          found: "C:/other/.git",
        });

        expect(run).toEqual({ status: 0, said: `${CARRIER_RAN}\n` });
      }
    );
  }
);
