/**
 * Running a small shell hook for real, with a line added at its end, to see
 * whether that line is reached and how the hook ends
 * (CodySwannGT/lisa#4989).
 *
 * The reader in `src/controls/carrier-hook-reach.ts` judges a hook by its
 * text. Every case a suite states about it is also run here, under the shell
 * the case is about, so a judgement is never held only to itself.
 * @module tests/support/carrier-hook-run
 */
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

/** The shell a hook is run by when a case names none. */
export const SH = "/bin/sh";

/**
 * The shells on this machine in which a `return` outside every function ends
 * the script. Bash does not: it reports the `return` and carries on.
 */
export const RETURN_LEAVES = ["/bin/dash", "/bin/ksh", "/bin/zsh"].filter(
  shell => existsSync(shell)
);

/** Every shell on this machine a hook's first line may name. */
export const EVERY_SHELL = [
  SH,
  "/bin/dash",
  "/bin/bash",
  "/bin/ksh",
  "/bin/zsh",
].filter(shell => existsSync(shell));

/** How a hook with a line added at its end ran. */
export interface HookRun {
  /** Whether the added line was reached. */
  readonly reached: boolean;
  /** The hook's exit status. */
  readonly status: number | null;
}

/**
 * Join the lines of a hook.
 * @param lines - The lines
 * @returns The hook's text
 */
export function hook(...lines: readonly string[]): string {
  return `${lines.join("\n")}\n`;
}

/**
 * Run a hook with lines added at its end, and say whether they were reached.
 *
 * The added lines record that they ran. With `failing` they then fail the way
 * the call to a carrier does when a declared check fails (`|| exit $?`), so
 * the hook's exit status says whether that failure reaches git.
 * @param text - The hook
 * @param options - How to run it
 * @param options.shell - The shell that runs it
 * @param options.failing - Whether the added lines fail after recording
 * @param cleanups - Where to put the removal of the folder it ran in
 * @returns Whether the added lines were reached, and how the hook ended
 */
export function ranToTheEnd(
  text: string,
  options: { readonly shell?: string; readonly failing?: boolean },
  cleanups: Array<() => void>
): HookRun {
  const folder = mkdtempSync(path.join(tmpdir(), "lisa-carrier-reach-"));
  const file = path.join(folder, "hook");
  const mark = path.join(folder, "reached");
  const added = [
    `echo reached > "${mark}"`,
    ...(options.failing === true ? ["false || exit $?"] : []),
    "",
  ].join("\n");
  cleanups.push(() => rmSync(folder, { force: true, recursive: true }));
  writeFileSync(file, `${text}${added}`);
  chmodSync(file, 0o755);
  // Worked out in the order written: the hook runs, then the mark is looked
  // for.
  return {
    status: boundedSpawnSync({
      args: [file],
      command: options.shell ?? SH,
      cwd: folder,
      env: { PATH: "/usr/bin:/bin" },
      input: "",
      label: "a hook with a line added at its end",
    }).status,
    reached: existsSync(mark),
  };
}
