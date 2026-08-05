/**
 * Enforcement must survive a container that has no Lisa plugin.
 *
 * Every `PreToolUse` guard — `block-no-verify`, `parity-safety-net`,
 * `block-shell-json-parsing` — is declared in the Lisa plugin. A cloud session
 * installs plugins at session start from the marketplace the repository
 * declares, and when that does not happen the container runs with
 * `installed_plugins.json` empty and no enforcement whatsoever.
 *
 * That is how a dispatched session committed with `--no-verify`: not by evading
 * a guard, but in an environment where none existed. The guards failed open and
 * silently, so the session behaved exactly as though they were present and got
 * a different outcome.
 *
 * A repository hook is the delivery that cannot fail that way, because
 * `.claude/settings.json` is part of the clone.
 * @module tests/unit/hooks/enforcement-fallback
 */
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Absolute, so the interpreter is never resolved through a writeable PATH. */
const BASH = "/bin/bash";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const FALLBACK = path.join(
  REPO_ROOT,
  "scripts",
  "lisa-enforcement-fallback.sh"
);

/** A config directory that cannot exist, standing in for a fresh container. */
const NO_PLUGIN = "/nonexistent-claude-config";

/** Claude's refusal code. Anything else lets the command through. */
const BLOCKED = 2;

/** The bypass a plugin-less session actually got away with. */
const NO_VERIFY_COMMIT = "git commit --no-verify -m x";

/**
 * Run the fallback against a tool payload.
 * @param command The Bash command Claude proposes to run.
 * @param configDir Where the plugin registry would live.
 * @returns Exit status and combined output.
 */
function runFallback(
  command: string,
  configDir: string
): { status: number | null; output: string } {
  const result = spawnSync(BASH, [FALLBACK], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: REPO_ROOT,
      CLAUDE_CONFIG_DIR: configDir,
    },
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

describe("enforcement fallback when no plugin is installed", () => {
  it("blocks the bypass that a plugin-less session got away with", () => {
    const { status, output } = runFallback(NO_VERIFY_COMMIT, NO_PLUGIN);

    expect(status).toBe(BLOCKED);
    expect(output).toMatch(/bypasses pre-commit/i);
  });

  it("blocks a destructive command the safety net owns", () => {
    // Not only the commit guard: a container with no plugin also had nothing
    // standing between an agent and a forced recursive delete.
    const { status } = runFallback("rm -rf $UNSET_VAR/data", NO_PLUGIN);

    expect(status).toBe(BLOCKED);
  });

  it("lets an ordinary command through", () => {
    // A fallback that blocks everything is not enforcement, it is an outage.
    const { status } = runFallback("ls -la", NO_PLUGIN);

    expect(status).toBe(0);
  });

  it("fires even where the registry says the plugin is installed", () => {
    // This used to assert the opposite — inert when registered — to spare a
    // developer machine a duplicated sweep. The registry cannot support that
    // conclusion. It answers "ever installed, for any project, on this machine";
    // the question is "are the plugin's guards running in this session", and
    // those come apart when another project registered it, when enabledPlugins
    // turned it off, and when an install landed after the session's hooks were
    // already loaded. The last one was observed: a write to AGENTS.md went
    // through in a session where both guard copies refuse that exact payload.
    //
    // The registry is BUILT here rather than read from `$HOME/.claude`, so this
    // asserts behaviour rather than machine state.
    const configDir = mkdtempSync(path.join(tmpdir(), "lisa-fallback-"));
    mkdirSync(path.join(configDir, "plugins"), { recursive: true });
    writeFileSync(
      path.join(configDir, "plugins", "installed_plugins.json"),
      JSON.stringify({ "lisa@lisa": { version: "0.0.0" } })
    );

    const { status } = runFallback(NO_VERIFY_COMMIT, configDir);

    rmSync(configDir, { recursive: true, force: true });
    expect(status).toBe(BLOCKED);
  });

  it("fires when the registry exists but is empty", () => {
    // A container that wrote an empty registry is precisely the failure this
    // whole file exists for, and it must not read as "nothing to do".
    const configDir = mkdtempSync(path.join(tmpdir(), "lisa-fallback-"));
    mkdirSync(path.join(configDir, "plugins"), { recursive: true });
    writeFileSync(
      path.join(configDir, "plugins", "installed_plugins.json"),
      JSON.stringify({})
    );

    const { status } = runFallback(NO_VERIFY_COMMIT, configDir);

    rmSync(configDir, { recursive: true, force: true });
    expect(status).toBe(BLOCKED);
  });
});

describe("the fallback is actually wired to run", () => {
  it("is registered as a PreToolUse Bash hook in the repository settings", () => {
    // The script existing is not the point — reaching a cloud session is. Repo
    // settings are part of the clone, which is the only delivery that does not
    // depend on a plugin install succeeding.
    const settings = JSON.parse(
      readFileSync(path.join(REPO_ROOT, ".claude", "settings.json"), "utf8")
    ) as {
      hooks?: {
        PreToolUse?: readonly {
          matcher?: string;
          hooks?: readonly { command?: string }[];
        }[];
      };
    };

    const commands = (settings.hooks?.PreToolUse ?? [])
      .filter(entry => entry.matcher === "Bash")
      .flatMap(entry => entry.hooks ?? [])
      .map(hook => hook.command ?? "");

    expect(commands.some(c => c.includes("lisa-enforcement-fallback.sh"))).toBe(
      true
    );
  });
});
