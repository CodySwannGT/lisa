/**
 * `|&` (pipe stdout and stderr) is a command boundary for block-no-verify.sh.
 *
 * shlex emits `|&` as one token, and glues it to neighbouring punctuation
 * (e.g. `)|&`). It was in no separator set, so the git invocation after it
 * read as printed arguments of the command before it — while bash still ran
 * `git --no-verify` (CodySwannGT/lisa#4393).
 * @module tests/unit/hooks/block-no-verify-pipe-stderr
 */
import path from "path";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const HOOK_PATH = path.resolve("plugins/lisa/hooks/block-no-verify.sh");
const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;

const runHook = (command: string): number | null =>
  boundedSpawnSync({
    label: "block-no-verify.sh",
    command: "/bin/bash",
    args: [HOOK_PATH],
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
  }).status;

describe("block-no-verify.sh treats |& as a command boundary", () => {
  it.each([
    "echo hi |& git commit --no-verify -m x",
    "(echo hi)|&git commit --no-verify -m x",
    "echo hi ;|& git commit --no-verify -m x",
    "echo hi |& git commit -n -m x",
    // Quoted, `|&` is an argument (a path can be named so), not a boundary.
    "git commit -m x '|&' -n",
    'git commit -m x "|&" -n',
  ])("blocks %s", (command: string) => {
    expect(runHook(command)).toBe(EXIT_BLOCKED);
  });

  it.each([
    "make 2>&1 |& tee build.log",
    "git commit -m x 2>&1 | grep -n foo",
    "git commit -m x 2>&1 |& grep -n foo",
    'git commit -m ";|&" -m y',
  ])("allows %s", (command: string) => {
    expect(runHook(command)).toBe(EXIT_ALLOWED);
  });

  it("keeps a redirection inside the commit argv, so -n after 2>&1 still blocks", () => {
    expect(runHook("git commit 2>&1 -n -m x")).toBe(EXIT_BLOCKED);
  });
});
