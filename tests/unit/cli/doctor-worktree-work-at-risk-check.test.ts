/**
 * `checkWorktreeWorkAtRisk` end to end against a scripted `git`: enumeration
 * failure, clean fleets, unreadable worktrees (never reported clean), detached
 * heads, report truncation, and the commit advice the report gives.
 * See `doctor-worktree-work-at-risk.test.ts` for why the check exists.
 */
import { execFile } from "node:child_process";
import type { ExecFileException } from "node:child_process";
import { beforeEach, vi } from "vitest";
import { checkWorktreeWorkAtRisk } from "../../../src/cli/doctor-worktree-work-at-risk.js";

vi.mock("node:child_process", () => {
  const execFileMock = vi.fn();
  Object.assign(execFileMock, {
    [Symbol.for("nodejs.util.promisify.custom")]: (
      command: string,
      args: readonly string[],
      options: Record<string, unknown>
    ) =>
      new Promise((resolve, reject) => {
        execFileMock(
          command,
          args,
          options,
          (error: ExecFileException | null, stdout: string, stderr: string) => {
            if (error) {
              reject(error);
              return;
            }
            resolve({ stdout, stderr });
          }
        );
      }),
  });
  return { execFile: execFileMock };
});

const execFileMock = execFile as unknown as {
  mockImplementation: (implementation: (...args: unknown[]) => unknown) => void;
  mockReset: () => void;
};

/** Node's `execFile` completion callback. */
type ExecFileCallback = (
  error: ExecFileException | null,
  stdout: string,
  stderr: string
) => void;

/** The scripted outcome of one git invocation. */
interface GitResult {
  readonly stdout?: string;
  readonly error?: ExecFileException;
}

/** One scripted git invocation: working directory, arguments, outcome. */
type GitEntry = readonly [string, readonly string[], GitResult];

/** The main checkout every case enumerates worktrees from. */
const REPO = "/repo";
/** Worktree enumeration arguments. */
const WORKTREE_LIST = ["worktree", "list", "--porcelain"];
/** Working-tree status arguments. */
const STATUS = ["status", "--porcelain"];
/** Current branch arguments. */
const CURRENT_BRANCH = ["rev-parse", "--abbrev-ref", "HEAD"];
/** Commits reachable from HEAD but from no remote. */
const UNPUSHED_COUNT = ["rev-list", "--count", "HEAD", "--not", "--remotes"];
/** Upstream branch arguments. */
const UPSTREAM = ["rev-parse", "--abbrev-ref", "@{u}"];
/** A risk worktree path several cases share. */
const RISK_WORKTREE = "/w/risk";
/** A worktree whose status cannot be read. */
const UNREADABLE_WORKTREE = "/w/unreadable";
/** A worktree with a detached HEAD. */
const DETACHED_WORKTREE = "/w/detached";

beforeEach(() => {
  execFileMock.mockReset();
});

/**
 * Key one git invocation by working directory and arguments.
 * @param cwd - Working directory of the invocation
 * @param args - Git arguments
 * @returns Lookup key for the scripted responses
 */
function commandKey(cwd: string, args: readonly string[]): string {
  return `${cwd}\0${args.join("\0")}`;
}

/**
 * Script `execFile` so each expected git invocation yields its response and
 * any other invocation fails loudly.
 * @param responses - Scripted outcomes keyed by {@link commandKey}
 */
function mockGit(responses: ReadonlyMap<string, GitResult>) {
  execFileMock.mockImplementation((...callArgs) => {
    const [command, args, optionsOrCallback, callbackMaybe] = callArgs;
    const options =
      typeof optionsOrCallback === "function" ? undefined : optionsOrCallback;
    const callback =
      typeof optionsOrCallback === "function"
        ? optionsOrCallback
        : callbackMaybe;
    const cwd =
      options && typeof options === "object" && "cwd" in options
        ? String(options.cwd)
        : "";
    const key = commandKey(cwd, Array.isArray(args) ? args.map(String) : []);
    const result: GitResult =
      command === "git"
        ? (responses.get(key) ?? {
            error: Object.assign(new Error(`Unexpected git call: ${key}`), {
              code: 1,
            }),
          })
        : {
            error: Object.assign(new Error(`Unexpected command: ${command}`), {
              code: 1,
            }),
          };
    const done = callback as ExecFileCallback;
    queueMicrotask(() => {
      done(result.error ?? null, result.stdout ?? "", "");
    });
    return undefined as never;
  });
}

/**
 * Index scripted git invocations for {@link mockGit}.
 * @param entries - Scripted invocations
 * @returns Responses keyed by {@link commandKey}
 */
function gitResponses(entries: readonly GitEntry[]) {
  return new Map(
    entries.map(([cwd, args, result]) => [commandKey(cwd, args), result])
  );
}

/**
 * Script the enumeration of the main checkout's worktrees.
 * @param stdout - Porcelain `git worktree list` output
 * @returns The enumeration entry
 */
function worktreeList(stdout: string): GitEntry {
  return [REPO, WORKTREE_LIST, { stdout }];
}

/**
 * Script a pushed worktree with an upstream and the given status output.
 * @param cwd - Worktree path
 * @param branch - Checked-out branch, also its upstream's name on origin
 * @param status - Porcelain `git status` output
 * @returns The four inspection entries for the worktree
 */
function pushedWorktree(
  cwd: string,
  branch: string,
  status: string
): GitEntry[] {
  return [
    [cwd, STATUS, { stdout: status }],
    [cwd, CURRENT_BRANCH, { stdout: `${branch}\n` }],
    [cwd, UNPUSHED_COUNT, { stdout: "0\n" }],
    [cwd, UPSTREAM, { stdout: `origin/${branch}\n` }],
  ];
}

describe("checkWorktreeWorkAtRisk", () => {
  it("reports unassessed when worktree enumeration fails", async () => {
    mockGit(
      gitResponses([
        [
          REPO,
          WORKTREE_LIST,
          { error: Object.assign(new Error("not a git repo"), { code: 128 }) },
        ],
      ])
    );

    const result = await checkWorktreeWorkAtRisk(REPO);

    expect(result.status).toBe("warn");
    expect(result.detail).toContain("NOT assessed");
    expect(result.detail).not.toContain("No worktree holds");
  });

  it("reports clean with the inspected worktree count", async () => {
    mockGit(
      gitResponses([
        worktreeList(
          "worktree /repo\nHEAD abc\n\nworktree /w/clean\nHEAD def\n"
        ),
        ...pushedWorktree(REPO, "main", ""),
        ...pushedWorktree("/w/clean", "main", ""),
      ])
    );

    const result = await checkWorktreeWorkAtRisk(REPO);

    expect(result.status).toBe("ok");
    expect(result.detail).toContain("2 inspected");
  });

  it("excludes unreadable worktrees instead of reporting them clean", async () => {
    mockGit(
      gitResponses([
        worktreeList(
          "worktree /repo\n\nworktree /w/unreadable\n\nworktree /w/risk\n"
        ),
        ...pushedWorktree(REPO, "main", ""),
        [
          UNREADABLE_WORKTREE,
          STATUS,
          { error: Object.assign(new Error("permission denied"), { code: 1 }) },
        ],
        [UNREADABLE_WORKTREE, CURRENT_BRANCH, { stdout: "main\n" }],
        ...pushedWorktree(RISK_WORKTREE, "risk", " M src/risk.ts\n"),
      ])
    );

    const result = await checkWorktreeWorkAtRisk(REPO);

    expect(result.status).toBe("warn");
    expect(result.detail).toContain("1 worktree");
    expect(result.detail).toContain(RISK_WORKTREE);
    expect(result.detail).not.toContain(UNREADABLE_WORKTREE);
  });

  it("reports detached worktrees with unpushed commits", async () => {
    mockGit(
      gitResponses([
        worktreeList("worktree /w/detached\nHEAD abc\n"),
        [DETACHED_WORKTREE, STATUS, { stdout: "" }],
        [DETACHED_WORKTREE, CURRENT_BRANCH, { stdout: "HEAD\n" }],
        [DETACHED_WORKTREE, UNPUSHED_COUNT, { stdout: "1\n" }],
      ])
    );

    const result = await checkWorktreeWorkAtRisk(REPO);

    expect(result.status).toBe("warn");
    expect(result.detail).toContain("/w/detached [(detached)]");
    expect(result.detail).toContain("1 unpushed commit");
    expect(result.detail).not.toContain(
      "/w/detached [(detached)] — 1 unpushed commit, no remote branch"
    );
  });

  it("limits the report to five entries and appends the remainder count", async () => {
    const paths = [1, 2, 3, 4, 5, 6].map(index => `/w/risk-${index}`);
    mockGit(
      gitResponses([
        worktreeList(
          paths.map(path => `worktree ${path}\nHEAD abc\n`).join("\n")
        ),
        ...paths.flatMap((path, index) =>
          pushedWorktree(path, `risk-${index}`, ` M src/${index}.ts\n`)
        ),
      ])
    );

    const result = await checkWorktreeWorkAtRisk(REPO);

    expect(result.status).toBe("warn");
    expect(result.detail).toContain("6 worktrees hold work");
    expect(result.detail).toContain("/w/risk-5");
    expect(result.detail).not.toContain("/w/risk-6");
    expect(result.detail).toContain("and 1 more");
  });

  // CodySwannGT/lisa#3722: this check fires at the exact moment an agent is
  // holding work that exists nowhere else, and its advice is read as an
  // instruction. It used to say "commit with `git add -A`", which is the one
  // sweep that is unsafe here — with concurrent agents the index can already
  // hold a different worktree's staged changes, so the sweep commits theirs
  // into this branch. Both halves are asserted: the unsafe form is gone AND a
  // safe one is named, because the negative alone is satisfied by saying
  // nothing about how to commit at all.
  it("advises explicit pathspecs, never a bare -A sweep", async () => {
    mockGit(
      gitResponses([
        worktreeList(
          "worktree /repo\nHEAD abc\n\nworktree /w/risk\nHEAD def\n"
        ),
        ...pushedWorktree(RISK_WORKTREE, "risk", " M src/a.ts\n"),
      ])
    );

    const result = await checkWorktreeWorkAtRisk(REPO);

    // The absence assertion targets the RECOMMENDING spelling, not the bare
    // command: the replacement names `git add -A` in order to warn against it,
    // so forbidding the substring would forbid the warning too.
    expect(result.detail).not.toContain("Commit with `git add -A`");
    expect(result.detail).toContain("Never sweep with `git add -A`");
    expect(result.detail).toContain("git commit -- <paths>");
    expect(result.detail).toContain("git show --stat HEAD");
  });
});
