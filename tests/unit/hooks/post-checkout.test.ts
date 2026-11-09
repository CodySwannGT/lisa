/**
 * Tests for the managed post-checkout worktree plugin-bootstrap hook.
 *
 * A git worktree is a distinct project path to Claude Code, so plugins enabled
 * in .claude/settings.json are "not installed here" for the worktree until
 * `claude plugin install --scope project` runs against that path — leaving
 * guardrail hooks off in worktree sessions. The hook seeds those installs once,
 * at `git worktree add` time, guarded so it only fires inside a worktree, on a
 * branch checkout, once per worktree.
 * @module tests/unit/hooks/post-checkout
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";

const HOOK_PATH = path.resolve("typescript/copy-contents/.husky/post-checkout");
const SH_PATH = "/bin/sh";
const GIT_PATH = resolveGit();
const NULL_SHA = "0".repeat(40);
const HEAD_SHA = "1".repeat(40);
const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};
const hasJq =
  boundedSpawnSync({
    label: "command -v jq",
    command: SH_PATH,
    args: ["-c", "command -v jq"],
  }).status === 0;

/**
 * Return process env without outer git hook state for nested temp repos.
 * @returns Environment safe for fixture git commands
 */
function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) {
      delete env[key];
    }
  }
  return env;
}

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  tempDirs = [];
});

/** A temp git repo wired with a fake `claude` for exercising the hook. */
interface Repo {
  /** Target root — a linked worktree, or the primary checkout. */
  readonly root: string;
  /** Directory holding the fake `claude` binary, prepended to PATH. */
  readonly binDir: string;
  /** File the fake `claude` appends its argv to. */
  readonly callsFile: string;
}

/**
 * Create a temp git repo and, when requested, a REAL linked worktree off it,
 * seed .claude/settings.json with the enabled plugins, and a fake `claude` that
 * logs its argv. The hook detects linked worktrees via git metadata (private
 * git dir ≠ common dir), so fixtures must be genuine worktrees rather than a
 * directory that merely looks like one.
 * @param options - Fixture shape
 * @param options.worktree - Whether `root` is a linked worktree or the primary checkout
 * @param enabledPlugins - Map written to .claude/settings.json enabledPlugins
 * @returns The target root, fake-bin directory, and the claude-call log path
 */
function createRepo(
  options: { readonly worktree: boolean },
  enabledPlugins: Record<string, boolean>
): Repo {
  const base = mkdtempSync(path.join(tmpdir(), "lisa-post-checkout-"));
  const main = path.join(base, "main");
  const binDir = path.join(base, "bin");
  const callsFile = path.join(base, "claude-calls.log");
  const claudeBin = path.join(binDir, "claude");
  const root = options.worktree
    ? path.join(main, ".claude", "worktrees", "wtA")
    : main;

  tempDirs.push(base);
  mkdirSync(main, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  boundedSpawnSync({
    label: "git init",
    command: GIT_PATH,
    args: ["init", "-q"],
    cwd: main,
    env: cleanGitEnv(),
  });
  boundedSpawnSync({
    label: "git commit --allow-empty",
    command: GIT_PATH,
    args: ["commit", "-q", "--allow-empty", "-m", "init"],
    cwd: main,
    env: { ...cleanGitEnv(), ...GIT_IDENTITY },
  });

  if (options.worktree) {
    boundedSpawnSync({
      label: "git worktree add",
      command: GIT_PATH,
      args: ["worktree", "add", "-q", "-b", "feat", root, "HEAD"],
      cwd: main,
      env: { ...cleanGitEnv(), ...GIT_IDENTITY },
    });
  }

  mkdirSync(path.join(root, ".claude"), { recursive: true });
  writeFileSync(
    path.join(root, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins })
  );
  writeFileSync(claudeBin, `#!/bin/sh\necho "$*" >> "${callsFile}"\n`);
  chmodSync(claudeBin, 0o755);

  return { root, binDir, callsFile };
}

/**
 * Run the hook in the repo with a given checkout flag and the fake claude on PATH.
 * @param repo - Repo context from createRepo
 * @param flag - post-checkout's third arg ("1" = branch checkout, "0" = file)
 * @param home - Optional HOME for locating the Lisa marketplace manifest
 * @returns The fake-claude calls recorded during the run
 */
function runHook(repo: Repo, flag: string, home?: string): string[] {
  return runHookWithOutput(repo, flag, home).calls;
}

/**
 * Run the hook and also capture what it printed.
 * @param repo - Repo context from createRepo
 * @param flag - post-checkout's third arg
 * @param home - Optional HOME for locating the Lisa marketplace manifest
 * @returns Recorded fake-claude calls and the hook's stdout
 */
function runHookWithOutput(
  repo: Repo,
  flag: string,
  home?: string
): { readonly calls: string[]; readonly stdout: string } {
  const result = boundedSpawnSync({
    label: "post-checkout hook",
    command: SH_PATH,
    args: [HOOK_PATH, NULL_SHA, HEAD_SHA, flag],
    cwd: repo.root,
    env: {
      ...cleanGitEnv(),
      PATH: `${repo.binDir}:${process.env.PATH ?? ""}`,
      // Never the developer's real HOME: the hook reads the Lisa marketplace
      // manifest from it. An unseeded fixture HOME holds no manifest.
      HOME: home ?? path.join(repo.binDir, "..", "home"),
    },
  });
  const calls = existsSync(repo.callsFile)
    ? readFileSync(repo.callsFile, "utf-8").split("\n").filter(Boolean)
    : [];
  return { calls, stdout: String(result.stdout ?? "") };
}

const INSTALL_LISA = "plugin install lisa@lisa --scope project";
const WORKTREE = { worktree: true } as const;
const MAIN = { worktree: false } as const;

describe.skipIf(!hasJq)("post-checkout worktree plugin bootstrap", () => {
  it("installs each enabled plugin at project scope inside a worktree", () => {
    const repo = createRepo(WORKTREE, {
      "lisa@lisa": true,
      "coderabbit@claude-plugins-official": true,
    });
    const calls = runHook(repo, "1");
    expect(calls).toContain("plugin marketplace update lisa");
    expect(calls).toContain(INSTALL_LISA);
    expect(calls).toContain(
      "plugin install coderabbit@claude-plugins-official --scope project"
    );
  });

  it("skips plugin ids containing shell-unsafe characters", () => {
    const repo = createRepo(WORKTREE, {
      "lisa@lisa": true,
      "bad;rm -rf": true,
    });
    const calls = runHook(repo, "1");
    expect(calls).toContain(INSTALL_LISA);
    expect(calls.some(call => call.includes("bad;rm"))).toBe(false);
  });

  it("does not install plugins disabled (set to false) in settings", () => {
    const repo = createRepo(WORKTREE, {
      "lisa@lisa": true,
      "code-review@claude-plugins-official": false,
    });
    const calls = runHook(repo, "1");
    expect(calls).toContain(INSTALL_LISA);
    expect(calls.some(call => call.includes("code-review"))).toBe(false);
  });

  it("is idempotent: a second checkout is a no-op (sentinel)", () => {
    const repo = createRepo(WORKTREE, { "lisa@lisa": true });
    const first = runHook(repo, "1");
    const second = runHook(repo, "1");
    expect(second).toEqual(first);
  });

  it("does nothing on a file checkout (flag 0)", () => {
    const repo = createRepo(WORKTREE, { "lisa@lisa": true });
    expect(runHook(repo, "0")).toEqual([]);
  });

  it("does nothing in the primary (non-worktree) checkout", () => {
    const repo = createRepo(MAIN, { "lisa@lisa": true });
    expect(runHook(repo, "1")).toEqual([]);
  });
});

/**
 * Seed a fake HOME holding the Lisa marketplace manifest the hook reads, and
 * swap the fake `claude` for one that fails to install any `@lisa` id the
 * manifest does not list — the real CLI's behaviour for a retired key.
 * @param repo - Repo context from createRepo
 * @param names - Plugin names the manifest lists, or null for no manifest
 * @returns The fake HOME directory
 */
function seedMarketplace(repo: Repo, names: readonly string[] | null): string {
  const home = path.join(repo.binDir, "..", "home");
  const manifestDir = path.join(
    home,
    ".claude",
    "plugins",
    "marketplaces",
    "lisa",
    ".claude-plugin"
  );
  const known = (names ?? ["lisa"]).map(name => `${name}@lisa`).join(" ");
  mkdirSync(manifestDir, { recursive: true });
  if (names !== null) {
    writeFileSync(
      path.join(manifestDir, "marketplace.json"),
      JSON.stringify({ name: "lisa", plugins: names.map(name => ({ name })) })
    );
  }
  writeFileSync(
    path.join(repo.binDir, "claude"),
    [
      "#!/bin/sh",
      `echo "$*" >> "${repo.callsFile}"`,
      'if [ "$1 $2" = "plugin install" ]; then',
      '  case "$3" in *@lisa) ;; *) exit 0 ;; esac',
      `  for k in ${known}; do [ "$k" = "$3" ] && exit 0; done`,
      "  exit 1",
      "fi",
      "exit 0",
      "",
    ].join("\n")
  );
  chmodSync(path.join(repo.binDir, "claude"), 0o755);
  return home;
}

/**
 * Whether the worktree's bootstrap sentinel was written.
 * @param repo - Repo context from createRepo
 * @returns True when the sentinel exists
 */
function sentinelWritten(repo: Repo): boolean {
  const gitDir = boundedSpawnSync({
    label: "git rev-parse --absolute-git-dir",
    command: GIT_PATH,
    args: ["rev-parse", "--absolute-git-dir"],
    cwd: repo.root,
    env: cleanGitEnv(),
  });
  return existsSync(
    path.join(String(gitDir.stdout).trim(), "lisa-plugins-bootstrapped")
  );
}

describe.skipIf(!hasJq)(
  "post-checkout skips @lisa keys absent from the Lisa marketplace",
  () => {
    it("skips a retired key with one warning and still writes the sentinel", () => {
      const repo = createRepo(WORKTREE, {
        "lisa@lisa": true,
        "typescript@lisa": true,
        "lisa-typescript@lisa": true,
        "coderabbit@claude-plugins-official": true,
      });
      const home = seedMarketplace(repo, ["lisa", "lisa-typescript"]);

      const { calls, stdout } = runHookWithOutput(repo, "1", home);

      expect(calls).toContain(INSTALL_LISA);
      expect(calls).toContain(
        "plugin install lisa-typescript@lisa --scope project"
      );
      expect(calls.some(call => call.includes(" typescript@lisa "))).toBe(
        false
      );
      const mentions = stdout
        .split("\n")
        .filter(line => line.includes(" typescript@lisa"));
      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toContain("lisa-typescript@lisa");
      expect(sentinelWritten(repo)).toBe(true);
    });

    it("still withholds the sentinel when a real plugin install fails", () => {
      const repo = createRepo(WORKTREE, {
        "lisa@lisa": true,
        "lisa-typescript@lisa": true,
      });
      // The manifest lists lisa-typescript, but the CLI cannot install it.
      const home = seedMarketplace(repo, ["lisa"]);
      writeFileSync(
        path.join(
          home,
          ".claude",
          "plugins",
          "marketplaces",
          "lisa",
          ".claude-plugin",
          "marketplace.json"
        ),
        JSON.stringify({
          name: "lisa",
          plugins: [{ name: "lisa" }, { name: "lisa-typescript" }],
        })
      );
      runHookWithOutput(repo, "1", home);
      expect(sentinelWritten(repo)).toBe(false);
    });

    it("falls back to installing every key when the manifest is unreadable", () => {
      const repo = createRepo(WORKTREE, {
        "lisa@lisa": true,
        "typescript@lisa": true,
      });
      const home = seedMarketplace(repo, null);
      const calls = runHook(repo, "1", home);
      expect(calls).toContain("plugin install typescript@lisa --scope project");
      expect(sentinelWritten(repo)).toBe(false);
    });
  }
);
