/**
 * The push carrier tells the gate runner what is being pushed, where it can
 * know (CodySwannGT/lisa#4989, CodySwannGT/lisa#4988).
 *
 * The runner leaves out a part a push does not touch, and it can only work
 * that out from what git writes on the push hook's standard input. So the
 * carrier hands that over exactly where it is sure to be whole, and nowhere
 * else. Held here with real git pushing to a real remote, in F-mixed, which
 * has a check for `api` and one for `web`:
 *
 * - Where the carrier is git's own hook, a push that touches `api` only runs
 *   the `api` check and reports `web` as not applicable. A branch the remote
 *   has never seen runs both, because there is nothing to compare it with.
 * - Where a hook of the repository runs first and reads one of the pushed
 *   refs, both checks run. The same repository with a call that trusts
 *   standard input leaves out the check for the ref that was read: that is
 *   the mistake the rule exists to prevent.
 * - A caller that gives the carrier an empty standard input, as the
 *   pre-commit framework does, gets both checks.
 * @module tests/integration/controls-push-carrier-refs
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { carrierCallLine } from "../../src/controls/carrier-script.js";
import {
  gitHooksFolder,
  writeExecutable,
} from "../support/carrier-hook-owners.js";
import {
  commitInstalled,
  installCarriers,
  operatorEnv,
} from "../support/carrier-install.js";
import {
  API,
  API_FILE,
  commitChange,
  forgetRuns,
  git,
  NOT_APPLICABLE_API,
  NOT_APPLICABLE_WEB,
  push,
  PUSH_CALL_LINE_BEFORE,
  type PushRepository,
  pushRepository,
  said,
  startedParts,
  WEB,
  WEB_FILE,
} from "../support/carrier-push.js";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

const MAIN = "main";
const OTHER = "other";
const EVERY_PART = "Every part runs at push";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Build F-mixed with a remote, removed when the case ends.
 * @returns The repository
 */
function built(): PushRepository {
  const repository = pushRepository();
  cleanups.push(repository.cleanup);
  return repository;
}

/**
 * Build F-mixed whose remote already holds `main`, with the carriers
 * installed and committed on top of it.
 * @returns The repository
 */
async function installedOnPushedMain(): Promise<PushRepository> {
  const repository = built();
  git(repository.root, ["push", "--quiet", "origin", MAIN]);
  await installCarriers(repository.root);
  commitInstalled(repository.root);
  return repository;
}

describe.skipIf(process.platform === "win32")(
  "a push through the carrier git itself runs",
  () => {
    it("runs the part the push touches and reports the other as not applicable", async () => {
      const { root } = await installedOnPushedMain();
      commitChange(root, API_FILE);

      const pushed = push(root, [MAIN]);

      expect(pushed.status).toBe(0);
      expect(startedParts(root)).toEqual([API]);
      expect(said(pushed)).toMatch(NOT_APPLICABLE_WEB);
      expect(said(pushed)).toMatch(/This push changes \d+ path\(s\)\./u);
      expect(git(root, ["rev-parse", `origin/${MAIN}`])).toBe(
        git(root, ["rev-parse", MAIN])
      );
    });

    it("runs every part when the remote has no commit to compare with", async () => {
      const { root } = built();
      await installCarriers(root);
      commitInstalled(root);

      const pushed = push(root, [MAIN]);

      expect(pushed.status).toBe(0);
      expect(startedParts(root)).toEqual([API, WEB]);
      expect(said(pushed)).toContain(
        `${EVERY_PART}: "refs/heads/${MAIN}" is new on the remote`
      );
      expect(said(pushed)).not.toContain("NOT APPLICABLE");
    });

    it("runs every part when it is started with an empty standard input", async () => {
      const { remote, root } = await installedOnPushedMain();
      commitChange(root, API_FILE);

      // The pre-commit framework starts a hook this way: nothing git wrote
      // reaches it, only an input that is already at its end.
      const started = boundedSpawnSync({
        args: [".lisa/hooks/pre-push", "origin", remote],
        command: "/bin/sh",
        cwd: root,
        env: operatorEnv(),
        input: "",
        label: "the push carrier with an empty standard input",
      });

      expect(started.status).toBe(0);
      expect(startedParts(root)).toEqual([API, WEB]);
      expect(said(started)).toContain(
        `${EVERY_PART}: the list of pushed refs is empty`
      );
    });
  }
);

describe.skipIf(process.platform === "win32")(
  "a push through a hook of the repository that reads a pushed ref first",
  () => {
    /** Where the repository's own hook writes the ref it read. */
    const READ_REF = ".git/lisa-test-host-read-ref";

    /** Where a hook that keeps a whole copy of standard input puts it. */
    const WHOLE_COPY = ".git/lisa-test-host-pushed-refs";

    /**
     * Write the repository's own push hook: it reads one line of standard
     * input and writes it down.
     * @param root - The repository
     * @param keepsCopy - Whether it first keeps a whole copy of standard
     *   input and names it for the runner
     * @returns The hook file
     */
    function writeHostHook(root: string, keepsCopy: boolean): string {
      const hook = path.join(gitHooksFolder(root), "pre-push");
      writeExecutable(
        hook,
        [
          "#!/bin/sh",
          ...(keepsCopy
            ? [
                `cat > ${WHOLE_COPY}`,
                `exec < ${WHOLE_COPY}`,
                `export LISA_PUSHED_REFS_FILE=${WHOLE_COPY}`,
              ]
            : []),
          "# The repository's own check looks at the first ref being pushed.",
          "read -r first_ref",
          `echo "$first_ref" > ${READ_REF}`,
          "",
        ].join("\n")
      );
      return hook;
    }

    /**
     * Build F-mixed with a push hook of its own that reads one line of
     * standard input, the carriers installed after it, and two branches the
     * remote already holds: `main` then changes `web` only, and `other`
     * changes `api` only.
     * @param trusting - Whether the call is rewritten to hand the carrier
     *   whatever is left of standard input, as a caller that trusted it would
     * @param keepsCopy - Whether the repository's hook first keeps a whole
     *   copy of standard input and names it for the runner
     * @returns The repository, with `other` checked out
     */
    async function twoBranches(
      trusting: boolean,
      keepsCopy = false
    ): Promise<PushRepository> {
      const repository = built();
      const { root } = repository;
      const hook = writeHostHook(root, keepsCopy);
      const installed = await installCarriers(root);
      const wired = readFileSync(hook, "utf8");
      if (
        installed.result?.hook_owner !== "git-hooks" ||
        !wired.includes(carrierCallLine("push"))
      ) {
        throw new Error(`the call was not added to the hook:\n${wired}`);
      }
      if (trusting) {
        writeFileSync(
          hook,
          wired.replace(carrierCallLine("push"), PUSH_CALL_LINE_BEFORE)
        );
      }
      commitInstalled(root);
      git(root, ["branch", OTHER]);
      // The first push of each branch: new on the remote, so nothing about
      // it is narrowed whichever call is in the hook.
      git(root, ["push", "--quiet", "origin", MAIN, OTHER]);
      commitChange(root, WEB_FILE);
      forgetRuns(root);
      git(root, ["checkout", "--quiet", OTHER]);
      commitChange(root, API_FILE);
      forgetRuns(root);
      return repository;
    }

    /**
     * The folder the ref the repository's own hook read is about.
     * @param root - The repository
     * @returns `web` when it read the line for `main`, `api` for `other`
     */
    function folderOfReadRef(root: string): string {
      const line = readFileSync(path.join(root, READ_REF), "utf8");
      return line.startsWith(`refs/heads/${MAIN} `) ? WEB : API;
    }

    it("runs every part, because the carrier is not handed what is left", async () => {
      const { root } = await twoBranches(false);

      const pushed = push(root, [MAIN, OTHER]);

      expect(pushed.status).toBe(0);
      expect(startedParts(root)).toEqual([API, WEB]);
      expect(said(pushed)).toContain(EVERY_PART);
      expect(said(pushed)).not.toContain("NOT APPLICABLE");
    });

    it("would leave out the part of the ref that was read, were it handed what is left", async () => {
      const { root } = await twoBranches(true);

      const pushed = push(root, [MAIN, OTHER]);
      const consumed = folderOfReadRef(root);

      // The control for the case above: the same repository and the same
      // push, with a call that passes standard input on. The runner sees one
      // ref of two, and nothing checks the folder the other one changed.
      expect(pushed.status).toBe(0);
      expect(startedParts(root)).toEqual([consumed === API ? WEB : API]);
      expect(said(pushed)).toMatch(
        consumed === API ? NOT_APPLICABLE_API : NOT_APPLICABLE_WEB
      );
      expect(said(pushed)).toContain("This push changes 1 path(s).");
    });

    it("is told what is pushed again when the hook kept a whole copy and names it", async () => {
      const { root } = await twoBranches(false, true);
      // One more commit on `other`, pushed alone: `api` only.
      git(root, ["push", "--quiet", "origin", MAIN, OTHER]);
      forgetRuns(root);
      commitChange(root, "api/src/fixture_mixed_api/another_module.py");

      const pushed = push(root, [OTHER]);

      expect(pushed.status).toBe(0);
      expect(startedParts(root)).toEqual([API]);
      expect(said(pushed)).toMatch(NOT_APPLICABLE_WEB);
    });
  }
);
