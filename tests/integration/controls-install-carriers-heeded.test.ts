/**
 * `lisa controls install-carriers` and a hook in which the added lines run,
 * or would run, and still cannot stop a commit (CodySwannGT/lisa#4989).
 *
 * Two hooks did that while the command reported them as wired. A `return`
 * outside every function ends a hook that dash, ksh or zsh runs, with
 * success, before the added lines. A `trap` on the end of the hook runs after
 * the added lines have failed, and an `exit 0` in it is what git sees. Each
 * is shown here with a real commit that goes through, and then the command
 * is asked what it makes of that hook.
 *
 * The other half is a hook the command would not add to although nothing in
 * it is left open. It is wired where the hook can be read, and where it
 * cannot the reason names the line and carries the lines to add by hand.
 * @module tests/integration/controls-install-carriers-heeded
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { carrierCallBlock } from "../../src/controls/carrier-script.js";
import { CARRIERS_BLOCKED_EXIT_CODE } from "../../src/controls/commands/install-carriers.js";
import {
  gitHooksFolder,
  type OwnedRepository,
  ownedRepository,
  writeExecutable,
} from "../support/carrier-hook-owners.js";
import {
  commitInstalled,
  commitLine,
  installCarriers,
  LINT_SHAPE,
  PLANTED,
  runs,
} from "../support/carrier-install.js";

/** A shell in which a `return` outside every function ends the script. */
const RETURN_LEAVES = ["/bin/dash", "/bin/ksh", "/bin/zsh"].find(shell =>
  existsSync(shell)
);

/** A way of quoting bash follows and this command does not. */
const NOT_FOLLOWED = "x=$'it\\'s'";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Build F-none with a declared check, removed when the case ends.
 * @returns The repository and its commit hook file
 */
function repository(): {
  readonly owned: OwnedRepository;
  readonly hook: string;
} {
  const owned = ownedRepository();
  cleanups.push(owned.repository.cleanup);
  return { hook: path.join(gitHooksFolder(owned.root), "pre-commit"), owned };
}

/**
 * Wire a repository, then write its commit hook by hand with the call at its
 * end: what a run that judged the hook's end reachable left behind.
 * @param first - The hook's first line
 * @param lines - The hook's own lines, above the call
 * @returns The repository
 */
async function wiredByHand(
  first: string,
  lines: readonly string[]
): Promise<OwnedRepository> {
  const { hook, owned } = repository();
  writeExecutable(hook, `#!/bin/sh\n${owned.hostCommand}\n`);
  await installCarriers(owned.root);
  commitInstalled(owned.root);
  writeExecutable(
    hook,
    [first, ...lines, carrierCallBlock("commit"), ""].join("\n")
  );
  return owned;
}

describe("a commit hook that holds the call and is not stopped by it", () => {
  it("is reported as not wired when a return above the call ends it first", async () => {
    // Dash is `sh` on most Linux systems, so one of these is always here.
    expect(RETURN_LEAVES).toBeDefined();
    const owned = await wiredByHand(`#!${RETURN_LEAVES ?? ""}`, [
      '[ -n "${RUN_ALL:-}" ] || return 0',
    ]);
    const before = runs(owned.commitRan);

    const passes = commitLine(owned.root, `# ${PLANTED}`);
    const check = await installCarriers(owned.root, { check: true });

    // The hook left with success at line 2: no check ran, the commit is in.
    expect(passes.status).toBe(0);
    expect(runs(owned.commitRan)).toBe(before);
    expect(check.code).toBe(CARRIERS_BLOCKED_EXIT_CODE);
    expect(check.result?.enforcement_points[0]?.outcome).toBe("blocked");
    expect(check.result?.enforcement_points[0]?.reason).toMatch(
      /can leave at line 2 before its end \(a "return" there is neither given.*outside every function it ends a hook that dash, ksh or zsh runs.*above line 2 by hand/su
    );
  });

  it("is reported as not wired when a trap above the call undoes its failure", async () => {
    const owned = await wiredByHand("#!/bin/sh", ['trap "exit 0" EXIT']);
    const before = runs(owned.commitRan);

    const passes = commitLine(owned.root, `# ${PLANTED}`);
    const check = await installCarriers(owned.root, { check: true });

    // The declared check ran and failed, and the commit is in all the same.
    expect(runs(owned.commitRan)).toBe(before + 1);
    expect(`${passes.stdout}${passes.stderr}`).toContain(LINT_SHAPE);
    expect(passes.status).toBe(0);
    expect(check.code).toBe(CARRIERS_BLOCKED_EXIT_CODE);
    expect(check.result?.enforcement_points[0]?.reason).toMatch(
      /can leave at line 2 before its end \(a "trap" there.*above line 2 by hand/su
    );
  });

  it("stops the commit once the lines stand above the trap", async () => {
    const { hook, owned } = repository();
    writeExecutable(hook, `#!/bin/sh\n${owned.hostCommand}\n`);
    await installCarriers(owned.root);
    commitInstalled(owned.root);
    writeExecutable(
      hook,
      [
        "#!/bin/sh",
        carrierCallBlock("commit"),
        'trap "exit 0" EXIT',
        owned.hostCommand,
        "",
      ].join("\n")
    );

    const check = await installCarriers(owned.root, { check: true });
    const rejected = commitLine(owned.root, `# ${PLANTED}`);

    expect(check.code).toBe(0);
    expect(check.result?.outcome).toBe("already-wired");
    expect(rejected.status).not.toBe(0);
    expect(`${rejected.stdout}${rejected.stderr}`).toContain(LINT_SHAPE);
  });
});

describe("a commit hook written in a way that is hard to read", () => {
  it("is wired, and stops a commit, when nothing in it is left open", async () => {
    const { hook, owned } = repository();
    writeExecutable(
      hook,
      [
        "#!/bin/sh",
        "shifted=$((1<<2))",
        `quoted="$(printf '%s' 'a"b')"`,
        "# usage: tool <<EOF",
        owned.hostCommand,
        "",
      ].join("\n")
    );

    const run = await installCarriers(owned.root);
    commitInstalled(owned.root);
    const rejected = commitLine(owned.root, `# ${PLANTED}`);

    expect(run.code).toBe(0);
    expect(run.result?.enforcement_points[0]?.outcome).toBe("installed");
    expect(rejected.status).not.toBe(0);
    expect(`${rejected.stdout}${rejected.stderr}`).toContain(LINT_SHAPE);
  });

  it("is left as it is where it cannot be read, with the line and the lines to add by hand", async () => {
    const { hook, owned } = repository();
    const script = ["#!/bin/bash", owned.hostCommand, NOT_FOLLOWED, ""].join(
      "\n"
    );
    writeExecutable(hook, script);

    const run = await installCarriers(owned.root);
    const reason = run.result?.enforcement_points[0]?.reason ?? "";

    expect(run.code).toBe(CARRIERS_BLOCKED_EXIT_CODE);
    expect(reason).toMatch(/could not be read from line 3 on/u);
    expect(reason).not.toMatch(/Close it/u);
    expect(reason).toMatch(/Add these lines to it by hand above line 3/u);
    expect(reason.endsWith(carrierCallBlock("commit"))).toBe(true);
    expect(readFileSync(hook, "utf8")).toBe(script);
  });

  it("is wired by the lines a person added above the line that cannot be read", async () => {
    const { hook, owned } = repository();
    const script = ["#!/bin/bash", owned.hostCommand, NOT_FOLLOWED, ""].join(
      "\n"
    );
    writeExecutable(hook, script);
    const blocked = await installCarriers(owned.root);
    const reason = blocked.result?.enforcement_points[0]?.reason ?? "";
    const block = reason.slice(reason.indexOf("# >>> lisa-carrier commit"));
    // A function, because `$'` in a replacement text means something else.
    writeFileSync(
      hook,
      script.replace(NOT_FOLLOWED, () => `${block}\n${NOT_FOLLOWED}`)
    );

    const run = await installCarriers(owned.root);
    commitInstalled(owned.root);
    const rejected = commitLine(owned.root, `# ${PLANTED}`);

    expect(run.code).toBe(0);
    expect(run.result?.enforcement_points[0]?.outcome).not.toBe("blocked");
    expect(rejected.status).not.toBe(0);
    expect(`${rejected.stdout}${rejected.stderr}`).toContain(LINT_SHAPE);
  });
});
