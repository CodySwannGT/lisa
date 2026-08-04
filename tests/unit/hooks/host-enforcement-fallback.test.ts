/**
 * A host project must keep its guards when the Lisa plugin does not install.
 *
 * Every `PreToolUse` guard is declared in the plugin, so a container whose
 * plugin install fails runs with no enforcement at all — silently, which is how
 * a dispatched session bypassed a hook nobody had disabled. Lisa closed that for
 * itself with a repository hook, because `.claude/settings.json` is part of the
 * clone and reaches a cloud session whether or not a plugin ever installs.
 *
 * A host project has the identical hole and no `plugins/` directory to fall back
 * on, so `lisa apply` writes the same three guards into its checkout. These
 * tests cover the two halves that can rot independently: the shipped copies
 * drifting from the reviewed originals, and the dispatcher not finding them in
 * the layout a host project actually has.
 * @module tests/unit/hooks/host-enforcement-fallback
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

/** Absolute, so the interpreter is never resolved through a writeable PATH. */
const BASH = "/bin/bash";

/** The directory a host project receives scripts into. */
const SCRIPTS = "scripts";

/** The dispatcher's filename, in both trees. */
const FALLBACK_NAME = "lisa-enforcement-fallback.sh";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The reviewed originals, which the plugin ships. */
const PLUGIN_HOOKS = path.join(REPO_ROOT, "plugins", "src", "base", "hooks");

/** What `lisa apply` writes into a host checkout. */
const SHIPPED_HOOKS = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  SCRIPTS,
  "lisa-hooks"
);

const SHIPPED_FALLBACK = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  SCRIPTS,
  FALLBACK_NAME
);

/** Claude's refusal code. Anything else lets the command through. */
const BLOCKED = 2;

/** The command that started all of this. */
const BYPASS = "git commit --no-verify -m x";

const GUARDS = [
  "block-no-verify",
  "parity-safety-net",
  "block-shell-json-parsing",
] as const;

const temporaries: string[] = [];

afterEach(() => {
  for (const dir of temporaries.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("the guards a host project receives", () => {
  it.each(GUARDS)("%s is byte-identical to the reviewed original", guard => {
    // Copies rot. The remote-env scripts sat 74 lines behind their asset until
    // exactly this assertion was added, so the shipped guard gets the same
    // treatment as the ratchet: synced by the build, pinned by a test.
    expect(readFileSync(path.join(SHIPPED_HOOKS, `${guard}.sh`), "utf8")).toBe(
      readFileSync(path.join(PLUGIN_HOOKS, `${guard}.sh`), "utf8")
    );
  });

  it("ships the dispatcher unchanged too", () => {
    expect(readFileSync(SHIPPED_FALLBACK, "utf8")).toBe(
      readFileSync(path.join(REPO_ROOT, SCRIPTS, FALLBACK_NAME), "utf8")
    );
  });
});

describe("enforcement in a host layout", () => {
  /**
   * Build a host project as `lisa apply` leaves it: `scripts/` populated, and
   * emphatically no `plugins/` directory to fall back on.
   * @returns Path to the fake host checkout
   */
  function hostProject(): string {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-host-"));
    const scripts = path.join(root, SCRIPTS);
    const fallback = path.join(scripts, FALLBACK_NAME);

    temporaries.push(root);
    mkdirSync(scripts, { recursive: true });
    cpSync(SHIPPED_HOOKS, path.join(scripts, "lisa-hooks"), {
      recursive: true,
    });
    cpSync(SHIPPED_FALLBACK, fallback);
    chmodSync(fallback, 0o755);
    return root;
  }

  /**
   * Run the host's dispatcher against a proposed command.
   * @param root Host checkout
   * @param command The Bash command Claude proposes
   * @returns Exit status
   */
  function runInHost(root: string, command: string): number | null {
    return spawnSync(BASH, [path.join(root, SCRIPTS, FALLBACK_NAME)], {
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command },
      }),
      encoding: "utf8",
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: root,
        CLAUDE_CONFIG_DIR: "/nonexistent-claude-config",
      },
    }).status;
  }

  it("blocks the bypass with no plugin and no plugins directory", () => {
    expect(runInHost(hostProject(), BYPASS)).toBe(BLOCKED);
  });

  it("blocks a destructive command the safety net owns", () => {
    expect(runInHost(hostProject(), "rm -rf $UNSET_VAR/data")).toBe(BLOCKED);
  });

  it("lets an ordinary command through", () => {
    // A fallback that blocks everything is not enforcement, it is an outage.
    expect(runInHost(hostProject(), "ls -la")).toBe(0);
  });
});

describe("host projects are told to run it", () => {
  it("registers the fallback in the settings lisa apply merges", () => {
    // Shipping the script without registering it would be enforcement that
    // exists on disk and never runs — the same silent no-op, one layer over.
    const merged = JSON.parse(
      readFileSync(
        path.join(REPO_ROOT, "all", "merge", ".claude", "settings.json"),
        "utf8"
      )
    ) as {
      hooks?: {
        PreToolUse?: readonly {
          matcher?: string;
          hooks?: readonly { command?: string }[];
        }[];
      };
    };

    const commands = (merged.hooks?.PreToolUse ?? [])
      .filter(entry => entry.matcher === "Bash")
      .flatMap(entry => entry.hooks ?? [])
      .map(hook => hook.command ?? "");

    expect(commands.some(c => c.includes("lisa-enforcement-fallback.sh"))).toBe(
      true
    );
  });
});
