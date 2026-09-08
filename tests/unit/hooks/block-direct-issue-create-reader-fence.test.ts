/**
 * Naming a file is not running it, pinned against the shapes actually measured
 * (CodySwannGT/lisa#3683).
 *
 * ## Why a fence rather than a fix
 *
 * The narrowing already landed: `file_operands` returns only
 * `executed_operand(argv)`, so a path in argument position is data. Verified
 * against `origin/main` before writing this — every shape below already
 * answers ALLOW. What did NOT land is coverage of the measured shapes. The
 * sibling suite's "allows what reaching further must not start refusing" block
 * pins RUNNER arguments (`python3 -m`, `node -e`, `bash -c`); the instances
 * this ticket recorded were plain readers, and none of them is asserted
 * anywhere.
 *
 * That gap is the whole reason to write this. The reported failure mode was not
 * one refusal but a PROPAGATING one: a file that quotes a creation becomes
 * unnameable in any later bash command, for every agent and for CI, so a
 * regression here is not a nuisance — it takes a path out of service. The
 * measured population is large: 111 tracked files fail to lex while carrying a
 * coarse token, 13 of them shell scripts, including this guard's own shipped
 * copies.
 *
 * ## The fixture genuinely files
 *
 * Per the ticket: assert against a file that really contains the string, or the
 * fence proves nothing. `filer.mjs` posts to the issues endpoint and declares
 * no readiness — running it is still refused, and that pairing is what stops
 * this suite reading as a read-only exemption.
 * @module tests/unit/hooks/block-direct-issue-create-reader-fence
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bash,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  projectWithTracker,
  runHook,
} from "./support/direct-issue-create.js";

const CONFIG = {
  tracker: "github",
  github: {
    org: "acme",
    repo: "widgets",
    labels: { build: { ready: "status:ready" } },
  },
};

/**
 * A file whose legitimate job is to file issues, and which does not lex.
 *
 * The apostrophe is deliberate: it drives the coarse fallback, which is the
 * branch every measured refusal came through.
 */
const FILER = [
  "// The caller's guard must not make this file unreadable.",
  'await fetch("https://api.github.com/repos/acme/widgets/issues", {',
  '  method: "POST",',
  '  body: JSON.stringify({ title: "nightly failed" }),',
  "});",
  "",
].join("\n");

/**
 * Write the filing fixture into a throwaway project.
 * @param cwd - The project directory
 * @returns The file's basename
 */
function filer(cwd: string): string {
  writeFileSync(path.join(cwd, "filer.mjs"), FILER, "utf-8");
  return "filer.mjs";
}

describe("a reader naming a filing file is not refused", () => {
  it.each([
    ["grep", "grep -n fetch"],
    ["a line count", "wc -l"],
    ["cat", "cat"],
    ["a linter", "npx eslint"],
    ["a test run", "bun run lisa-test-run -- vitest run"],
    ["a copy", "cp"],
    ["a move", "mv"],
    ["a link", "ln -s"],
    ["a listing", "ls -la"],
  ])("allows %s", (_label, reader) => {
    const cwd = projectWithTracker(CONFIG);
    const file = filer(cwd);

    expect(runHook(bash(`${reader} ${file}`), { cwd }).status).toBe(
      EXIT_ALLOWED
    );
  });
});

describe("searching FOR the pattern is not filing", () => {
  it.each([
    ["ripgrep", "rg -n 'gh issue create' ."],
    ["recursive grep", "grep -rn 'gh issue create' ."],
  ])("allows %s", (_label, command) => {
    // The diagnostic path: you must be able to enumerate instances in order to
    // clean them up, and to search for the pattern you are trying to fix.
    const cwd = projectWithTracker(CONFIG);

    expect(runHook(bash(command), { cwd }).status).toBe(EXIT_ALLOWED);
  });
});

describe("the coverage this must not trade away", () => {
  it("still refuses RUNNING the same file", () => {
    // The pairing that stops this being a read-only exemption. Same file, same
    // contents; only the command position differs.
    const cwd = projectWithTracker(CONFIG);
    const file = filer(cwd);

    expect(runHook(bash(`node ${file}`), { cwd }).status).toBe(EXIT_BLOCKED);
  });

  it("still refuses an undeclared creation typed directly", () => {
    const cwd = projectWithTracker(CONFIG);

    expect(
      runHook(bash("gh issue create --title x --repo acme/widgets"), { cwd })
        .status
    ).toBe(EXIT_BLOCKED);
  });

  it("still allows a creation carrying the build-ready role", () => {
    const cwd = projectWithTracker(CONFIG);

    expect(
      runHook(
        bash(
          "gh issue create --title x --repo acme/widgets --label status:ready"
        ),
        { cwd }
      ).status
    ).toBe(EXIT_ALLOWED);
  });
});
