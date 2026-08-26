/**
 * The session-start hook must register at USER scope on a remote surface.
 *
 * The committed `.claude/settings.json` hook is project-scoped, so it loads only
 * when Claude Code's project directory is that repository — which a cloud
 * session does not reliably make true. With several repositories the session
 * opens in the shared parent (not a git repository at all); with one, the
 * checkout sits at `$HOME/<repo>` while the session may open at `$HOME`. Either
 * way no project settings load, the hook never registers, and nothing
 * materializes.
 *
 * `~/.claude/settings.json` is read for every session regardless of project
 * directory, and runs in-session where the vendor's configured variables are
 * present — unlike the setup phase, which cannot see them.
 * @module tests/unit/secrets/user-session-hook
 */

import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { installUserSessionHook } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

/** Scratch roots to remove after each test. */
const roots: string[] = [];

/** The hook command's stable prefix. */
const RUNNER = "scripts/lisa-remote-env/session-start.sh";

/** Where user-scoped settings live, relative to home. */
const SETTINGS = ".claude/settings.json";

/**
 * A checkout containing the session-start script, plus an empty home.
 * @param withScript Whether the repo actually ships the script.
 * @returns Repo root and home directory.
 */
function scratch(withScript = true): { repo: string; home: string } {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-userhook-"));
  const repo = path.join(root, "repo");
  const home = path.join(root, "home");

  roots.push(root);
  mkdirSync(path.join(repo, "scripts/lisa-remote-env"), { recursive: true });
  mkdirSync(home, { recursive: true });
  if (withScript)
    writeFileSync(path.join(repo, RUNNER), "#!/usr/bin/env bash\n");

  return { repo, home };
}

/**
 * Read back the written user settings.
 * @param home The home directory.
 * @returns The parsed settings object.
 */
function settingsIn(home: string): Record<string, never> {
  return JSON.parse(readFileSync(path.join(home, SETTINGS), "utf8"));
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe("installUserSessionHook", () => {
  it("registers a SessionStart hook pointing at the repo's script", () => {
    const { repo, home } = scratch();

    expect(installUserSessionHook(repo, { home }).action).toBe("registered");

    const written = settingsIn(home) as never as {
      hooks: {
        SessionStart: { matcher: string; hooks: { command: string }[] }[];
      };
    };
    const entry = written.hooks.SessionStart[0];
    expect(entry.matcher).toBe("startup|resume");
    // An ABSOLUTE path: the hook fires from whatever directory the session
    // opens in, which is the entire reason this exists.
    expect(entry.hooks[0].command).toBe(`bash '${path.join(repo, RUNNER)}'`);
  });

  it("single-quotes shell metacharacters in the persisted command", () => {
    const { repo, home } = scratch();
    const hostileRepo = `${repo}-$HOME-$(echo injected)-it's`;
    mkdirSync(path.join(hostileRepo, "scripts/lisa-remote-env"), {
      recursive: true,
    });
    writeFileSync(path.join(hostileRepo, RUNNER), "#!/usr/bin/env bash\n");

    installUserSessionHook(hostileRepo, { home });
    const written = settingsIn(home) as never as {
      hooks: { SessionStart: { hooks: { command: string }[] }[] };
    };
    expect(written.hooks.SessionStart[0].hooks[0].command).toBe(
      `bash '${path.join(hostileRepo, RUNNER).replaceAll("'", `'\\''`)}'`
    );
  });

  it("is idempotent — a second run does not duplicate the hook", () => {
    // Setup can run more than once against one container.
    const { repo, home } = scratch();

    installUserSessionHook(repo, { home });
    expect(installUserSessionHook(repo, { home }).action).toBe("present");

    const written = settingsIn(home) as never as {
      hooks: { SessionStart: unknown[] };
    };
    expect(written.hooks.SessionStart).toHaveLength(1);
  });

  it("preserves hooks and settings it did not write", () => {
    // The container's settings may already carry configuration this knows
    // nothing about. Clobbering it would be the careless destruction the
    // project-scoped path deliberately avoids.
    const { repo, home } = scratch();
    mkdirSync(path.join(home, ".claude"), { recursive: true });
    writeFileSync(
      path.join(home, SETTINGS),
      JSON.stringify({
        model: "opus",
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ command: "guard.sh" }] }],
          SessionStart: [
            {
              matcher: "startup",
              hooks: [{ type: "command", command: "other.sh" }],
            },
          ],
        },
      })
    );

    installUserSessionHook(repo, { home });

    const written = settingsIn(home) as never as {
      model: string;
      hooks: {
        PreToolUse: unknown[];
        SessionStart: { hooks: { command: string }[] }[];
      };
    };
    expect(written.model).toBe("opus");
    expect(written.hooks.PreToolUse).toHaveLength(1);
    expect(written.hooks.SessionStart).toHaveLength(2);
    expect(written.hooks.SessionStart[0].hooks[0].command).toBe("other.sh");
  });

  it("refuses to overwrite settings that do not parse", () => {
    // Unparseable is still someone's configuration.
    const { repo, home } = scratch();
    mkdirSync(path.join(home, ".claude"), { recursive: true });
    const file = path.join(home, SETTINGS);
    writeFileSync(file, "{ not json");

    expect(installUserSessionHook(repo, { home }).action).toBe("failed");
    expect(readFileSync(file, "utf8")).toBe("{ not json");
  });

  it("skips a repo that ships no session-start script", () => {
    const { repo, home } = scratch(false);

    expect(installUserSessionHook(repo, { home }).action).toBe("skipped");
  });

  it("writes nothing on a dry run", () => {
    const { repo, home } = scratch();

    expect(installUserSessionHook(repo, { home, dryRun: true }).action).toBe(
      "would-register"
    );
    expect(() => settingsIn(home)).toThrow();
  });
});
