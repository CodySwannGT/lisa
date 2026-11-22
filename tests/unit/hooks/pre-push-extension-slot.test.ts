/**
 * The pre-push extension slots keep their exit codes and output.
 *
 * Each pre-push copy ends by sourcing `.husky/pre-push.local` (and the
 * template also `.husky/pre-push.verify`) and then checking its status. The
 * check used to read `if [ $? -ne 0 ]`, which ShellCheck reports as SC2181. It
 * now captures `STEP_STATUS=$?` on the next line instead, and the source
 * stays outside any condition (`if ! . file`), so the slot has exactly the
 * shape the `$?` form had and errexit reaches the sourced file the same way.
 * Measured: bash 3.2 (macOS `/bin/sh`) and dash both keep honouring errexit
 * inside a dot script even under `if !`, so on those shells the wrapped form
 * would also agree; the cases below pin the outputs either way.
 *
 * These run the SHIPPED bytes: the tail of each hook, from the first
 * extension slot to its `exit 0`, is sliced out and run with `/bin/sh` both as
 * git runs an extension-less hook and as `sh -e`, against extension files that
 * pass, fail partway, fail on their last command, set errexit themselves, and
 * exit with a code of their own. The expected outputs and codes are the ones
 * the `$?` form gave, measured before the change.
 * @module tests/unit/hooks/pre-push-extension-slot
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Absolute interpreter path: git runs an extension-less hook through sh. */
const SH = "/bin/sh";

/** The project-specific extension file every copy sources. */
const LOCAL = "pre-push.local";

/** The managed verification extension file only the template sources. */
const VERIFY = "pre-push.verify";

/** Every shipped pre-push copy, and the extension files each one sources. */
const HOOKS = [
  { hook: ".husky/pre-push", slots: [LOCAL] },
  { hook: ".claude-pr/.husky/pre-push", slots: [LOCAL] },
  {
    hook: "typescript/copy-contents/.husky/pre-push",
    slots: [VERIFY, LOCAL],
  },
] as const;

/** The banner the local slot prints before it sources the file. */
const LOCAL_BANNER =
  "🔌 Running project-specific pre-push checks (.husky/pre-push.local)...";

/** What each slot prints when its file returns non-zero. */
const FAILURE = {
  [LOCAL]: "❌ Project-specific pre-push checks failed.",
  [VERIFY]: "❌ Verification (UAT) coverage check failed.",
} as const;

/** Extension file bodies, and what the slot does with each. */
const BODIES = {
  passes: "echo start\ntrue\n",
  failsPartway: "echo start\nfalse\necho after\n",
  failsLast: "echo start\nfalse\n",
  failsPartwayUnderErrexit: "set -e\necho start\nfalse\necho unreachable\n",
  exitsWithItsOwnCode: "echo start\nexit 3\necho unreachable\n",
} as const;

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * The hook from its first extension slot to the `exit 0` after the last one.
 * @param hook - Repository-relative hook path
 * @returns A runnable script body
 */
function extensionTail(hook: string): string {
  const source = readFileSync(path.join(REPO_ROOT, hook), "utf8");
  const verify = source.indexOf("# Managed verification (UAT) extension slot");
  const local = source.indexOf("# Project-specific extension slot");
  const start = verify === -1 ? local : verify;
  const end = source.indexOf("\nexit 0\n", local);
  expect(local).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(local);
  return `${source.slice(start, end)}\nexit 0\n`;
}

/**
 * The exit code and non-empty stdout lines of a finished run.
 * @param result - The spawn result
 * @param result.status - Its exit code
 * @param result.stdout - Its standard output
 * @returns Exit code and stdout lines
 */
const outcome = (result: {
  status: number | null;
  stdout: string;
}): { code: number | null; lines: string[] } => ({
  code: result.status,
  lines: result.stdout.split("\n").filter(line => line.length > 0),
});

/**
 * Run a hook's extension tail with one extension file present.
 * @param hook - Repository-relative hook path
 * @param slot - The extension file to write
 * @param body - Its contents
 * @param errexit - Whether to start the shell as `sh -e`, as husky does
 * @returns Exit code and stdout lines
 */
function run(
  hook: string,
  slot: string,
  body: string,
  errexit = false
): { code: number | null; lines: string[] } {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-pre-push-slot-"));
  const script = path.join(root, "tail.sh");
  roots.push(root);
  mkdirSync(path.join(root, ".husky"));
  writeFileSync(path.join(root, ".husky", slot), body);
  writeFileSync(script, extensionTail(hook));
  return outcome(
    boundedSpawnSync({
      label: `${hook} extension slot`,
      command: SH,
      args: errexit ? ["-e", script] : [script],
      cwd: root,
    })
  );
}

/**
 * The banner lines a slot prints before the file's own output.
 * @param slot - The extension file
 * @returns Lines printed ahead of it
 */
const banner = (slot: string): string[] =>
  slot === LOCAL ? [LOCAL_BANNER] : [];

describe.each(
  HOOKS.flatMap(({ hook, slots }) => slots.map(slot => ({ hook, slot })))
)("$hook sourcing $slot", ({ hook, slot }) => {
  it("passes when the file passes", () => {
    expect(run(hook, slot, BODIES.passes)).toEqual({
      code: 0,
      lines: [...banner(slot), "start"],
    });
  });

  it("refuses with its own message when the file's last command fails", () => {
    expect(run(hook, slot, BODIES.failsLast)).toEqual({
      code: 1,
      lines: [...banner(slot), "start", FAILURE[slot]],
    });
  });

  it("stops at the first failure of a file that sets errexit", () => {
    expect(run(hook, slot, BODIES.failsPartwayUnderErrexit)).toEqual({
      code: 1,
      lines: [...banner(slot), "start"],
    });
  });

  it("runs past a mid-file failure when errexit is off, as before", () => {
    expect(run(hook, slot, BODIES.failsPartway)).toEqual({
      code: 0,
      lines: [...banner(slot), "start", "after"],
    });
  });

  it("stops at a mid-file failure under sh -e, as before", () => {
    // Husky's runner starts hooks with `sh -e`; the first failure inside the
    // sourced file still ends the push, with that failure's status.
    expect(run(hook, slot, BODIES.failsPartway, true)).toEqual({
      code: 1,
      lines: [...banner(slot), "start"],
    });
  });

  it("stops at a last-command failure under sh -e, as before", () => {
    expect(run(hook, slot, BODIES.failsLast, true)).toEqual({
      code: 1,
      lines: [...banner(slot), "start"],
    });
  });

  it("keeps an exit code the file chooses", () => {
    expect(run(hook, slot, BODIES.exitsWithItsOwnCode)).toEqual({
      code: 3,
      lines: [...banner(slot), "start"],
    });
  });
});
