/**
 * `block-host-name-leak` must refuse an outbound tracker write that names a
 * host project — and must find the name where agents actually put it.
 *
 * The detector this guard consults shipped on 2026-08-20 and has been consumed
 * since by the evidence manifest and the attribution body, which scan tracked
 * files and constructed upstream filings. Nothing ran it over an issue body, a
 * pull-request body, or a comment before that text was posted. Across the full
 * tracker on 2026-09-03 that gap had produced 513 items carrying a host
 * identity, at a daily rate that ranged 1.8%–28.5% over the preceding week and
 * never reached zero. So the interesting assertions here are not "does the
 * matcher work" — that was settled by #2783 — but **is it reachable from the
 * channel agents publish through**.
 *
 * THE LOAD-BEARING TEST IS THE FILE ONE
 *
 * The convention in this repository is `--body-file <path>`; the prose never
 * appears in the command string. A guard that inspects argv alone reports clean
 * on every real call while permitting every real leak — #3484's defect exactly,
 * and the reason `readsTheFileNotTheCommand` is the case to protect if any of
 * these are ever trimmed.
 *
 * NO REAL NAME APPEARS IN THIS FILE
 *
 * Fixtures use `LISA_DOWNSTREAM_NAMES`, the documented out-of-tree extension,
 * to load a name that is not a host identity. Writing a real one here to prove
 * the guard catches real ones would publish the very thing the guard exists to
 * keep unpublished — in the test for that guard.
 * @module tests/unit/hooks/block-host-name-leak
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  boundedExecFileSync,
  boundedSpawnSync,
} from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";

/** git, resolved to a fixed path rather than through a writeable PATH. */
const GIT = resolveGit();

/** The executable guard filename. */
const HOOK_BASENAME = "block-host-name-leak.sh";

/** The guard under test, as it lives in the plugin source. */
const SCRIPT_PATH = path.resolve(
  "plugins/src/base/hooks/block-host-name-leak.sh"
);
/** Claude's refusal code. Anything else lets the command through. */
const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;
/** A name that is not a host identity, supplied through the documented env. */
const FIXTURE_NAME = "notarealhostproject";
/** The repository root, where the compiled detector lives. */
const PROJECT_DIR = process.cwd();

/**
 * A throwaway directory for body fixtures.
 * @returns The directory path.
 */
const scratch = (): string => mkdtempSync(path.join(tmpdir(), "lisa-hnl-"));

/**
 * Write a body file and return its path.
 * @param contents - The body text.
 * @returns The file path.
 */
const bodyFile = (contents: string): string => {
  const file = path.join(scratch(), "body.md");
  writeFileSync(file, contents, "utf-8");
  return file;
};

/**
 * Isolate temporary repositories and local gh routing from the parent hook.
 * @returns The fixture child environment.
 */
const fixtureEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(?:GIT_|GH_|GITHUB_)/u.test(key)
    )
  );

/**
 * Run the hook against one command.
 * @param command - The command the agent is about to run.
 * @param names - Names to load into the denylist for this run.
 * @param projectDir - The project the hook governs (its cwd and CLAUDE_PROJECT_DIR).
 * @returns Exit status and combined output.
 */
const runHook = (
  command: string,
  names: string = FIXTURE_NAME,
  projectDir: string = PROJECT_DIR
): { status: number; output: string } => {
  const result = boundedSpawnSync({
    label: HOOK_BASENAME,
    command: "/bin/bash",
    args: [SCRIPT_PATH],
    cwd: projectDir,
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    env: {
      ...fixtureEnv(),
      GH_TOKEN: "local-fixture-no-network-token",
      GH_PROMPT_DISABLED: "1",
      CLAUDE_PROJECT_DIR: projectDir,
      LISA_DOWNSTREAM_NAMES: names,
    },
  });
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
};

describe("it finds the name where agents actually put it", () => {
  it("reads the body file rather than the command string", () => {
    // The case that decides whether this guard is real. Every other assertion
    // here passes on a guard that only inspects argv.
    const file = bodyFile(
      `Context.\nProved in ${FIXTURE_NAME} during rollout.`
    );
    const result = runHook(
      `gh issue create --title "fix it" --body-file ${file}`
    );
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.output).toContain(FIXTURE_NAME);
  });

  it("names the file and line so the fix is mechanical", () => {
    const file = bodyFile(`line one\nline two\nleaked ${FIXTURE_NAME} here`);
    const result = runHook(`gh issue create --title t --body-file ${file}`);
    expect(result.output).toContain(`${file}:3`);
  });

  it("checks the title, which is what listings and notifications show", () => {
    const file = bodyFile("a clean body");
    const result = runHook(
      `gh issue create --title "regressed in ${FIXTURE_NAME}" --body-file ${file}`
    );
    expect(result.status).toBe(EXIT_BLOCKED);
  });

  it("reads an inline body", () => {
    const result = runHook(
      `gh issue create --title t --body "broke in ${FIXTURE_NAME}"`
    );
    expect(result.status).toBe(EXIT_BLOCKED);
  });

  it("reads a gh api prose field", () => {
    const result = runHook(
      `gh api -X POST repos/CodySwannGT/lisa/issues -f body="${FIXTURE_NAME} broke"`
    );
    expect(result.status).toBe(EXIT_BLOCKED);
  });

  it("reads a gh api -F field that points at a file (#4462)", () => {
    // `-F` is `--field` on gh api. `body=@file` used to be read as the path
    // "body=@file", which names nothing, so the body was never checked.
    const file = bodyFile(`Context.\nProved in ${FIXTURE_NAME}.`);
    const result = runHook(
      `gh api -X POST repos/CodySwannGT/lisa/issues -F body=@${file}`
    );
    expect(result.status).toBe(EXIT_BLOCKED);
  });
});

describe("it covers edits and comments, not only creation", () => {
  it.each([
    ["gh issue comment", `gh issue comment 42 --body "${FIXTURE_NAME}"`],
    ["gh issue edit", `gh issue edit 42 --body "${FIXTURE_NAME}"`],
    ["gh pr create", `gh pr create --title t --body "${FIXTURE_NAME}"`],
    ["gh pr comment", `gh pr comment 42 --body "${FIXTURE_NAME}"`],
    ["gh pr edit", `gh pr edit 42 --body "${FIXTURE_NAME}"`],
  ])("refuses %s", (_label, command) => {
    expect(runHook(command).status).toBe(EXIT_BLOCKED);
  });
});

describe("it stays quiet where a false positive would get it disabled", () => {
  it.each([
    ["a read", `gh issue view 42 --repo CodySwannGT/lisa`],
    ["a search naming the term", `gh issue list --search ${FIXTURE_NAME}`],
    ["a non-prose write", `gh label create ${FIXTURE_NAME}`],
    ["a GET through gh api", `gh api repos/o/r/issues`],
    ["a command that is not gh", `echo ${FIXTURE_NAME}`],
  ])("allows %s", (_label, command) => {
    expect(runHook(command).status).toBe(EXIT_ALLOWED);
  });

  it("allows a clean body", () => {
    const file = bodyFile("No identities appear anywhere in this text.");
    expect(
      runHook(`gh issue create --title t --body-file ${file}`).status
    ).toBe(EXIT_ALLOWED);
  });

  it("allows a vendor API endpoint quoted from guard source", () => {
    const file = bodyFile(
      "The access layer posts to https://api.linear.app/graphql today."
    );
    const result = runHook(
      `gh issue create --title t --body-file ${file}`,
      "linear"
    );
    expect(result.status).toBe(EXIT_ALLOWED);
  });

  it("allows this repository's own org slug", () => {
    const file = bodyFile("Tracked at CodySwannGT/lisa#3695 and fixed there.");
    expect(
      runHook(`gh issue create --title t --body-file ${file}`).status
    ).toBe(EXIT_ALLOWED);
  });
});

/**
 * A host project's checkout: a git repository whose origin is not this one,
 * with Lisa installed the way hosts install it — `dist/` reachable under
 * `node_modules/@codyswann/lisa`, which is exactly what lets the guard load its
 * denylist inside a host (#4462).
 * @param origin - The origin remote URL, or undefined for no git repository.
 * @returns The checkout directory.
 */
const hostCheckout = (origin: string | undefined): string => {
  const dir = scratch();
  mkdirSync(path.join(dir, "node_modules", "@codyswann", "lisa"), {
    recursive: true,
  });
  symlinkSync(
    path.join(PROJECT_DIR, "dist"),
    path.join(dir, "node_modules", "@codyswann", "lisa", "dist")
  );
  if (origin !== undefined) {
    const git = (args: string[]): string =>
      boundedExecFileSync({
        label: "git (host checkout fixture)",
        command: GIT,
        args: ["-C", dir, ...args],
        env: fixtureEnv(),
      });
    git(["init", "-q"]);
    git(["remote", "add", "origin", origin]);
  }
  return dir;
};

it("isolates the actual host fixture from inherited Git repository locations", () => {
  const untouched = hostCheckout("git@github.com:acme/fixture-only.git");
  const config = path.join(untouched, ".git", "config");
  const before = readFileSync(config, "utf8");
  try {
    vi.stubEnv("GIT_DIR", path.join(untouched, ".git"));
    vi.stubEnv("GIT_WORK_TREE", untouched);
    const isolated = hostCheckout("git@github.com:acme/isolated-fixture.git");
    expect(existsSync(path.join(isolated, ".git", "config"))).toBe(true);
    expect(readFileSync(config, "utf8")).toBe(before);
  } finally {
    vi.unstubAllEnvs();
  }
});

describe("it guards writes into this repository, not a host's own tracker (#4462)", () => {
  // The rule protects THIS public repository. A host writing its own name into
  // its own tracker is normal — and gate 4 requires it, since a PR body must
  // carry `Work-Item: <owner>/<repo>#<n>`. Refusing that made the two guards
  // contradict each other in every host.
  it.each([
    ["--repo", `--repo acme/${FIXTURE_NAME}`],
    ["-R", `-R acme/${FIXTURE_NAME}`],
    ["--repo=", `--repo=acme/${FIXTURE_NAME}`],
    ["a URL", `--repo https://github.com/acme/${FIXTURE_NAME}`],
  ])(
    "allows a host naming itself in its own tracker via %s",
    (_label, flag) => {
      const result = runHook(
        `gh pr create ${flag} --title t --body "Work-Item: acme/${FIXTURE_NAME}#1"`
      );
      expect(result.status).toBe(EXIT_ALLOWED);
    }
  );

  it("allows a gh api write into a host's own repository", () => {
    const result = runHook(
      `gh api -X POST repos/acme/${FIXTURE_NAME}/issues -f body="${FIXTURE_NAME} broke"`
    );
    expect(result.status).toBe(EXIT_ALLOWED);
  });

  it("allows a write with no --repo from a host checkout", () => {
    const host = hostCheckout(`git@github.com:acme/${FIXTURE_NAME}.git`);
    const result = runHook(
      `gh issue create --title t --body "seen in ${FIXTURE_NAME}"`,
      FIXTURE_NAME,
      host
    );
    expect(result.status).toBe(EXIT_ALLOWED);
  });

  it.each([
    ["--repo", "--repo CodySwannGT/lisa"],
    ["a differently cased --repo", "--repo codyswanngt/LISA"],
    ["a URL", "--repo https://github.com/CodySwannGT/lisa.git"],
  ])(
    "still refuses a host name written into this repository via %s from a host checkout",
    (_label, flag) => {
      // The case that keeps the guard worth having: an upstream filing made from
      // inside a host is the most likely way a host name reaches this repository.
      const host = hostCheckout(`git@github.com:acme/${FIXTURE_NAME}.git`);
      const result = runHook(
        `gh issue create ${flag} --title t --body "seen in ${FIXTURE_NAME}"`,
        FIXTURE_NAME,
        host
      );
      expect(result.status).toBe(EXIT_BLOCKED);
    }
  );

  it("still refuses when the target cannot be determined", () => {
    // No --repo, no repos/ path, no git origin: fail toward the protection.
    const unknown = hostCheckout(undefined);
    const result = runHook(
      `gh issue create --title t --body "seen in ${FIXTURE_NAME}"`,
      FIXTURE_NAME,
      unknown
    );
    expect(result.status).toBe(EXIT_BLOCKED);
  });
});

describe("it never fails open silently", () => {
  it.each(["-f", "--field", "-F"])("refuses unread %s files", flag => {
    expect(runHook(`cd "$D"; gh $N ${flag} body=@b`)).toMatchObject({
      status: EXIT_BLOCKED,
      output: expect.stringContaining("BLOCKED: the working directory"),
    });
  });

  it("announces a missing command-context companion instead of a silent hook error", () => {
    const plugin = scratch();
    for (const file of [HOOK_BASENAME, "block-host-name-leak.mjs"])
      copyFileSync(
        path.join(PROJECT_DIR, "plugins/src/base/hooks", file),
        path.join(plugin, file)
      );
    const result = boundedSpawnSync({
      label: "host-name guard missing companion",
      command: "/bin/bash",
      args: [path.join(plugin, HOOK_BASENAME)],
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: {
          command: "gh issue create --repo CodySwannGT/lisa --body x",
        },
      }),
      env: fixtureEnv(),
    });
    expect(result.status).toBe(EXIT_ALLOWED);
    expect(String(result.stderr)).toContain("command-context helper missing");
    expect(String(result.stderr)).toContain("NOT active");
  });

  it("permits the write but announces itself when the detector is absent", () => {
    // Failing closed would block every tracker write on a machine with no built
    // dist/. Failing open quietly is worse than either: a guard that is
    // silently absent reads exactly like a guard that is passing.
    const file = bodyFile(`leaked ${FIXTURE_NAME}`);
    const result = boundedSpawnSync({
      label: HOOK_BASENAME,
      command: "/bin/bash",
      args: [SCRIPT_PATH],
      cwd: PROJECT_DIR,
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: {
          command: `gh issue create --title t --body-file ${file}`,
        },
      }),
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: scratch(),
        LISA_DOWNSTREAM_NAMES: FIXTURE_NAME,
      },
    });
    expect(result.status).toBe(EXIT_ALLOWED);
    expect(`${result.stderr ?? ""}`).toContain("NOT active");
  });

  it("says what it does not cover, so a clean result is not read as safe", () => {
    const result = runHook(
      `gh issue create --title "${FIXTURE_NAME}" --body x`
    );
    expect(result.output).toContain("rate reduction, not a");
  });
});
