/**
 * Contract tests for the local-environment command.
 *
 * The local surface was implemented long before anything could ask for it: the
 * manifest was surface-aware and the executor understood `local`, but the only
 * entrypoint was a file named `setup-remote-env.mjs`, inside a directory named
 * `lisa-remote-env`, written into the repository by the skill that provisions a
 * *remote* environment. A project that had never provisioned one had no local
 * path at all — so the machine most likely to be missing a tool was the one
 * with no way to ask about it.
 *
 * These tests hold the two properties that make the new command safe to hand a
 * developer: it installs nothing uninvited, and it never depends on the remote
 * flow having been run first.
 * @module tests/unit/secrets/local-env-command
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { run } from "../../../plugins/src/base/skills/lisa-setup-local-env/scripts/local-env.mjs";

const SKILL = "plugins/src/base/skills/lisa-setup-local-env";

/** The platform every case resolves against, so none depends on the host. */
const MAC = "darwin-arm64";

/** The platform whose artifact a Mac must never be handed. */
const LINUX = "linux-x64";

/** The one archive kind these fixtures need. */
const ZIP = "release-zip";

/** A tool pinned for macOS and Linux, as the real gh and bws entries now are. */
const PORTABLE = {
  name: "demo",
  version: "1.0.0",
  platforms: {
    [LINUX]: {
      install: ZIP,
      url: "https://example.test/demo-linux.zip",
      sha256: "a".repeat(64),
    },
    [MAC]: {
      install: ZIP,
      url: "https://example.test/demo-macos.zip",
      sha256: "b".repeat(64),
    },
  },
};

/** A tool pinned only for Linux, as every entry used to be. */
const LINUX_ONLY = {
  name: "linuxonly",
  version: "1.0.0",
  platforms: {
    [LINUX]: {
      install: ZIP,
      url: "https://example.test/linuxonly.zip",
      sha256: "c".repeat(64),
    },
  },
};

/** Throwaway project roots, removed after each case. */
const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A throwaway project declaring the given install entries.
 * @param install Manifest install entries, or undefined for no manifest at all.
 * @returns Absolute path to the project root.
 */
function project(install?: readonly unknown[]): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-local-env-"));
  roots.push(root);
  writeFileSync(
    path.join(root, ".lisa.config.json"),
    JSON.stringify(install ? { remoteEnv: { tools: { install } } } : {})
  );
  return root;
}

/**
 * Capture everything the command prints.
 * @returns A reader for the accumulated output.
 */
function captureOutput(): () => string {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  return () => log.mock.calls.map(call => String(call[0])).join("\n");
}

describe("the command stands alone", () => {
  it("does not depend on the remote flow having been provisioned", () => {
    // scripts/lisa-remote-env/setup.sh is WRITTEN by /lisa:setup:remote-env, so
    // requiring it would reintroduce the exact ordering trap this command
    // exists to remove: local setup available only after remote setup.
    const source = path.join(SKILL, "scripts", "local-env.mjs");
    expect(existsSync(source)).toBe(true);
    expect(readFileSync(source, "utf8")).not.toContain(
      "scripts/lisa-remote-env"
    );
  });
});

describe("consent", () => {
  it("installs nothing without --install-tools", async () => {
    // A container is disposable and provisions itself silently. A laptop
    // belongs to a person, and pinned binaries appearing in their ~/.local/bin
    // uninvited is not ours to decide.
    const output = captureOutput();
    const code = await run({
      cwd: project([PORTABLE]),
      platform: MAC,
    });

    expect(code).toBe(0);
    expect(output()).toContain("Nothing has been installed");
    expect(output()).toContain("--install-tools");
  });

  it("reports the platform it resolved against", async () => {
    const output = captureOutput();
    await run({ cwd: project([PORTABLE]), platform: MAC });

    expect(output()).toContain(MAC);
  });
});

describe("a tool with no artifact for this machine", () => {
  it("fails, so the command is usable as a gate", async () => {
    captureOutput();
    const code = await run({
      cwd: project([LINUX_ONLY]),
      platform: MAC,
    });

    expect(code).toBe(1);
  });

  it("says which platform block is missing rather than guessing a URL", async () => {
    // Guessing a download URL would produce an artifact the checksum cannot
    // vouch for, which defeats the only thing standing between a pinned entry
    // and whatever the URL serves today.
    const output = captureOutput();
    await run({ cwd: project([LINUX_ONLY]), platform: MAC });

    expect(output()).toContain(MAC);
    expect(output()).toMatch(/no artifact is pinned/);
  });

  it("still reports the tools it can handle alongside the one it cannot", async () => {
    // A developer fixing a manifest wants the whole list. Aborting on the first
    // unresolvable tool hides every other decision.
    const output = captureOutput();
    await run({
      cwd: project([LINUX_ONLY, PORTABLE]),
      platform: MAC,
    });

    expect(output()).toContain("demo");
    expect(output()).toContain("linuxonly");
  });
});

describe("an empty manifest", () => {
  it("points at the detector rather than reporting success", async () => {
    // Nothing populates remoteEnv.tools automatically, so an empty manifest is
    // the common case and "all clear" would be actively misleading.
    const output = captureOutput();

    const code = await run({ cwd: project(), platform: MAC });

    expect(code).toBe(0);
    expect(output()).toContain("detect-tooling");
  });
});
