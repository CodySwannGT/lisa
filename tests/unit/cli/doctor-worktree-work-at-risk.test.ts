/**
 * The check exists because "no remote branch" and "abandoned" are
 * indistinguishable from outside a worktree. On 2026-08-17 seven sessions in one
 * fleet reached the same ticket in turn, each ran `git ls-remote`, each got a
 * true negative, and five worktrees held real work at the time — one of them
 * 1,031 uncommitted lines. These pin the classification, the ordering, and the
 * one property that matters most: an unreadable worktree is never reported clean.
 */
/* eslint-disable jsdoc/require-jsdoc, max-lines, sonarjs/no-duplicate-string -- Fixture-heavy doctor tests are clearer as direct git command tables. */
import { execFile } from "node:child_process";
import type { ExecFileException } from "node:child_process";
import { beforeEach, vi } from "vitest";
import {
  compareExposureSeverity,
  checkWorktreeWorkAtRisk,
  describeExposure,
  holdsWorkAtRisk,
  isTrackedChange,
  type WorktreeExposure,
} from "../../../src/cli/doctor-worktree-work-at-risk.js";

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
type ExecFileCallback = (
  error: ExecFileException | null,
  stdout: string,
  stderr: string
) => void;

interface GitResult {
  readonly stdout?: string;
  readonly error?: ExecFileException;
}

const CLEAN: WorktreeExposure = {
  path: "/w/clean",
  branch: "main",
  unpushedCommits: 0,
  noUpstream: false,
  dirtyFiles: 0,
  untrackedFiles: 0,
};

beforeEach(() => {
  execFileMock.mockReset();
});

function commandKey(cwd: string, args: readonly string[]): string {
  return `${cwd}\0${args.join("\0")}`;
}

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
    const result =
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

function gitResponses(
  entries: readonly (readonly [string, readonly string[], GitResult])[]
) {
  return new Map(
    entries.map(([cwd, args, result]) => [commandKey(cwd, args), result])
  );
}

describe("holdsWorkAtRisk", () => {
  it("reports a clean, pushed worktree as holding nothing", () => {
    expect(holdsWorkAtRisk(CLEAN)).toBe(false);
  });

  it("reports uncommitted files as work at risk", () => {
    expect(holdsWorkAtRisk({ ...CLEAN, dirtyFiles: 3 })).toBe(true);
  });

  it("reports unpushed commits as work at risk", () => {
    expect(holdsWorkAtRisk({ ...CLEAN, unpushedCommits: 2 })).toBe(true);
  });

  it("does NOT treat a missing upstream alone as work at risk", () => {
    // A branch with no upstream but nothing unique on it has nothing to lose.
    // Counting it would flood the report with freshly-created branches and
    // train the reader to skip the check — which is how the real ones hide.
    expect(holdsWorkAtRisk({ ...CLEAN, noUpstream: true })).toBe(false);
  });
});

describe("isTrackedChange", () => {
  // Measured on a real fleet checkout: one worktree reported 1,442 untracked
  // files, overwhelmingly `.watchman-cookie-*` droppings. Counting those as
  // work at risk makes every worktree look catastrophic and trains the reader
  // to skip the check — the exact failure this check exists to prevent.
  it.each([
    " M src/a.ts",
    "A  src/b.ts",
    "D  src/c.ts",
    "R  a -> b",
    "MM x.ts",
  ])("counts %s as a tracked change", line => {
    expect(isTrackedChange(line)).toBe(true);
  });

  it.each([
    "?? .watchman-cookie-host-11488-0",
    "?? .lisa/DEPENDENCY_DECISIONS.md",
    "",
  ])("does NOT count %s", line => {
    expect(isTrackedChange(line)).toBe(false);
  });
});

describe("compareExposureSeverity", () => {
  it("sorts any dirty tree ahead of any number of unpushed commits", () => {
    // Not a magnitude judgement. A commit survives in the reflog; a dirty tree
    // is in no object database at all, so the recovery story differs in kind.
    const dirty = { ...CLEAN, path: "/w/a", dirtyFiles: 1 };
    const manyCommits = { ...CLEAN, path: "/w/b", unpushedCommits: 99 };
    expect([manyCommits, dirty].sort(compareExposureSeverity)[0]).toBe(dirty);
  });

  it("orders dirtier trees first among dirty ones", () => {
    const few = { ...CLEAN, path: "/w/a", dirtyFiles: 2 };
    const many = { ...CLEAN, path: "/w/b", dirtyFiles: 40 };
    expect([few, many].sort(compareExposureSeverity)[0]).toBe(many);
  });

  it("orders dirtied trees by unpushed commits when dirty counts tie", () => {
    const oneCommit = {
      ...CLEAN,
      path: "/w/a",
      dirtyFiles: 2,
      unpushedCommits: 1,
    };
    const manyCommits = {
      ...CLEAN,
      path: "/w/b",
      dirtyFiles: 2,
      unpushedCommits: 9,
    };
    expect([oneCommit, manyCommits].sort(compareExposureSeverity)[0]).toBe(
      manyCommits
    );
  });

  it("breaks ties by path so the report is deterministic", () => {
    const later = { ...CLEAN, path: "/w/z", unpushedCommits: 1 };
    const earlier = { ...CLEAN, path: "/w/a", unpushedCommits: 1 };
    expect([later, earlier].sort(compareExposureSeverity)[0]).toBe(earlier);
  });
});

describe("describeExposure", () => {
  it("names the uncommitted count, the unpushed count, and the missing remote", () => {
    const text = describeExposure({
      // Path shape mirrors the real incident (a worktree outside WORKTREE_ROOTS);
      // spelled without the literal tmp prefix so the lint rule for publicly
      // writable directories does not fire on a string that is never opened.
      path: "/scratch-root/wt",
      branch: "fix/thing",
      unpushedCommits: 2,
      noUpstream: true,
      dirtyFiles: 1031,
      untrackedFiles: 2,
    });
    expect(text).toContain("/scratch-root/wt");
    expect(text).toContain("fix/thing");
    expect(text).toContain("1031 uncommitted");
    expect(text).toContain("2 untracked");
    expect(text).toContain("2 unpushed commits");
    expect(text).toContain("no remote branch");
  });

  it("singularizes a lone unpushed commit", () => {
    expect(describeExposure({ ...CLEAN, unpushedCommits: 1 })).toContain(
      "1 unpushed commit"
    );
    expect(describeExposure({ ...CLEAN, unpushedCommits: 1 })).not.toContain(
      "1 unpushed commits"
    );
  });

  it("labels a detached worktree rather than printing undefined", () => {
    const { branch: _omitted, ...detached } = CLEAN;
    expect(describeExposure({ ...detached, dirtyFiles: 1 })).toContain(
      "(detached)"
    );
  });
});

describe("checkWorktreeWorkAtRisk", () => {
  it("reports unassessed when worktree enumeration fails", async () => {
    mockGit(
      gitResponses([
        [
          "/repo",
          ["worktree", "list", "--porcelain"],
          { error: Object.assign(new Error("not a git repo"), { code: 128 }) },
        ],
      ])
    );

    const result = await checkWorktreeWorkAtRisk("/repo");

    expect(result.status).toBe("warn");
    expect(result.detail).toContain("NOT assessed");
    expect(result.detail).not.toContain("No worktree holds");
  });

  it("reports clean with the inspected worktree count", async () => {
    mockGit(
      gitResponses([
        [
          "/repo",
          ["worktree", "list", "--porcelain"],
          {
            stdout: "worktree /repo\nHEAD abc\n\nworktree /w/clean\nHEAD def\n",
          },
        ],
        ["/repo", ["status", "--porcelain"], { stdout: "" }],
        ["/repo", ["rev-parse", "--abbrev-ref", "HEAD"], { stdout: "main\n" }],
        [
          "/repo",
          ["rev-list", "--count", "--no-merges", "HEAD", "--not", "--remotes"],
          { stdout: "0\n" },
        ],
        [
          "/repo",
          ["rev-parse", "--abbrev-ref", "@{u}"],
          { stdout: "origin/main\n" },
        ],
        ["/w/clean", ["status", "--porcelain"], { stdout: "" }],
        [
          "/w/clean",
          ["rev-parse", "--abbrev-ref", "HEAD"],
          { stdout: "main\n" },
        ],
        [
          "/w/clean",
          ["rev-list", "--count", "--no-merges", "HEAD", "--not", "--remotes"],
          { stdout: "0\n" },
        ],
        [
          "/w/clean",
          ["rev-parse", "--abbrev-ref", "@{u}"],
          { stdout: "origin/main\n" },
        ],
      ])
    );

    const result = await checkWorktreeWorkAtRisk("/repo");

    expect(result.status).toBe("ok");
    expect(result.detail).toContain("2 inspected");
  });

  it("excludes unreadable worktrees instead of reporting them clean", async () => {
    mockGit(
      gitResponses([
        [
          "/repo",
          ["worktree", "list", "--porcelain"],
          {
            stdout:
              "worktree /repo\n\nworktree /w/unreadable\n\nworktree /w/risk\n",
          },
        ],
        ["/repo", ["status", "--porcelain"], { stdout: "" }],
        ["/repo", ["rev-parse", "--abbrev-ref", "HEAD"], { stdout: "main\n" }],
        [
          "/repo",
          ["rev-list", "--count", "--no-merges", "HEAD", "--not", "--remotes"],
          { stdout: "0\n" },
        ],
        [
          "/repo",
          ["rev-parse", "--abbrev-ref", "@{u}"],
          { stdout: "origin/main\n" },
        ],
        [
          "/w/unreadable",
          ["status", "--porcelain"],
          { error: Object.assign(new Error("permission denied"), { code: 1 }) },
        ],
        [
          "/w/unreadable",
          ["rev-parse", "--abbrev-ref", "HEAD"],
          { stdout: "main\n" },
        ],
        ["/w/risk", ["status", "--porcelain"], { stdout: " M src/risk.ts\n" }],
        [
          "/w/risk",
          ["rev-parse", "--abbrev-ref", "HEAD"],
          { stdout: "risk\n" },
        ],
        [
          "/w/risk",
          ["rev-list", "--count", "--no-merges", "HEAD", "--not", "--remotes"],
          { stdout: "0\n" },
        ],
        [
          "/w/risk",
          ["rev-parse", "--abbrev-ref", "@{u}"],
          { stdout: "origin/risk\n" },
        ],
      ])
    );

    const result = await checkWorktreeWorkAtRisk("/repo");

    expect(result.status).toBe("warn");
    expect(result.detail).toContain("1 worktree");
    expect(result.detail).toContain("/w/risk");
    expect(result.detail).not.toContain("/w/unreadable");
  });

  it("reports detached worktrees with unpushed commits", async () => {
    mockGit(
      gitResponses([
        [
          "/repo",
          ["worktree", "list", "--porcelain"],
          { stdout: "worktree /w/detached\nHEAD abc\n" },
        ],
        ["/w/detached", ["status", "--porcelain"], { stdout: "" }],
        [
          "/w/detached",
          ["rev-parse", "--abbrev-ref", "HEAD"],
          { stdout: "HEAD\n" },
        ],
        [
          "/w/detached",
          ["rev-list", "--count", "--no-merges", "HEAD", "--not", "--remotes"],
          { stdout: "1\n" },
        ],
      ])
    );

    const result = await checkWorktreeWorkAtRisk("/repo");

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
        [
          "/repo",
          ["worktree", "list", "--porcelain"],
          {
            stdout: paths
              .map(path => `worktree ${path}\nHEAD abc\n`)
              .join("\n"),
          },
        ],
        ...paths.flatMap((path, index) => [
          [
            path,
            ["status", "--porcelain"],
            { stdout: ` M src/${index}.ts\n` },
          ] as const,
          [
            path,
            ["rev-parse", "--abbrev-ref", "HEAD"],
            { stdout: `risk-${index}\n` },
          ] as const,
          [
            path,
            ["rev-list", "--count", "--no-merges", "HEAD", "--not", "--remotes"],
            { stdout: "0\n" },
          ] as const,
          [
            path,
            ["rev-parse", "--abbrev-ref", "@{u}"],
            { stdout: `origin/risk-${index}\n` },
          ] as const,
        ]),
      ])
    );

    const result = await checkWorktreeWorkAtRisk("/repo");

    expect(result.status).toBe("warn");
    expect(result.detail).toContain("6 worktrees hold work");
    expect(result.detail).toContain("/w/risk-5");
    expect(result.detail).not.toContain("/w/risk-6");
    expect(result.detail).toContain("and 1 more");
  });
});
/* eslint-enable jsdoc/require-jsdoc, max-lines, sonarjs/no-duplicate-string -- End fixture-heavy doctor tests. */
