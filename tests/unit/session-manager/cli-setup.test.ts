/**
 * Integration tests for the session-manager CLI's setup commands:
 * init-config, store-token, trust-status and coexistence, run as a real
 * process against stub executables (CodySwannGT/lisa#4465 added the last two,
 * the clipboard route for the token, and worktree-aware repo detection).
 * @module tests/unit/session-manager/cli-setup
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  makeSandbox,
  removeSandboxes,
  runCli,
  type Sandbox,
} from "./support/cli-harness.js";

afterEach(removeSandboxes);

const TOKEN_FILE = ".env";
const INIT_CONFIG = "init-config";
const STORE_TOKEN = "store-token";
const FROM_CLIPBOARD = "--from-clipboard";
const PROJECTS = "projects";
const LISA_CONFIG = ".lisa.config.json";
const DEMO = "demo";
const SLUG = "--slug";
const LONG_AGO = "2020-01-01T00:00:00.000Z";

/**
 * A PATH dir with stub clipboard tools for every supported platform: each
 * read tool prints `contents`, each clear tool records that it ran.
 * @param sandbox - Project sandbox
 * @param contents - What the clipboard holds
 * @returns The PATH value to run the CLI with, and the clear-marker file
 */
function stubClipboard(sandbox: Sandbox, contents: string) {
  const bin = path.join(sandbox.home, "clip-bin");
  const cleared = path.join(sandbox.home, "clipboard-cleared");
  const reader = `#!/bin/sh\nprintf '%s' '${contents}'\n`;
  const clearer = `#!/bin/sh\ncat >/dev/null\ntouch '${cleared}'\n`;
  const tools: ReadonlyArray<readonly [string, string]> = [
    ["pbpaste", reader],
    ["wl-paste", reader],
    ["pbcopy", clearer],
    ["wl-copy", clearer],
  ];
  mkdirSync(bin, { recursive: true });
  for (const [name, body] of tools) {
    writeFileSync(path.join(bin, name), body);
    chmodSync(path.join(bin, name), 0o755);
  }
  return {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    cleared,
  };
}

describe(INIT_CONFIG, () => {
  it("prints a default block with detected repos and writes it with --write", () => {
    const sandbox = makeSandbox({ sessionManager: null, repos: ["api"] });
    const printed = runCli(sandbox, [INIT_CONFIG, SLUG, DEMO]);
    expect(printed.status).toBe(0);
    expect(printed.json.block.name).toBe("demo-manager");
    expect(Object.keys(printed.json.block.repos.entries)).toEqual(["api"]);
    expect(printed.json.written).toBe(false);

    const written = runCli(sandbox, [INIT_CONFIG, SLUG, DEMO, "--write"]);
    expect(written.json.written).toBe(true);
    const config = JSON.parse(
      readFileSync(path.join(sandbox.root, LISA_CONFIG), "utf8")
    );
    expect(config.sessionManager.name).toBe("demo-manager");
    expect(config.github.repo).toBe("demo-repo");
  });

  it("never overwrites an existing block", () => {
    const sandbox = makeSandbox();
    const result = runCli(sandbox, [INIT_CONFIG, "--write"]);
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({ written: false, reason: "exists" });
  });

  it("proposes one entry per repo with drafted hints, not worktrees", () => {
    const sandbox = makeSandbox({ sessionManager: null, repos: ["api"] });
    const api = path.join(sandbox.root, PROJECTS, "api");
    const worktree = path.join(sandbox.root, PROJECTS, "api-wt-SE-1");
    mkdirSync(path.join(api, ".git"));
    writeFileSync(
      path.join(api, "package.json"),
      JSON.stringify({ dependencies: { "@nestjs/core": "1" } })
    );
    mkdirSync(worktree);
    writeFileSync(path.join(worktree, LISA_CONFIG), "{}");
    writeFileSync(
      path.join(worktree, ".git"),
      "gitdir: /src/api/.git/worktrees/api-wt-SE-1\n"
    );
    const result = runCli(sandbox, [INIT_CONFIG, SLUG, DEMO]);
    expect(result.json.block.repos.entries).toEqual({
      api: { hints: ["api", "NestJS"] },
    });
  });
});

describe(STORE_TOKEN, () => {
  it("without a TTY prints both copy-paste commands and stores nothing", () => {
    const sandbox = makeSandbox();
    const result = runCli(sandbox, [STORE_TOKEN]);
    expect(result.status).toBe(0);
    expect(result.json.stored).toBe(false);
    expect(result.json.reason).toBe("no-tty");
    expect(result.json.command).toContain("store-token --project-root");
    expect(result.json.clipboardCommand).toContain(
      "store-token --from-clipboard --project-root"
    );
    expect(existsSync(path.join(sandbox.stateDir, TOKEN_FILE))).toBe(false);
  });

  it("--from-clipboard stores the token 0600 with no TTY and clears the clipboard", () => {
    const sandbox = makeSandbox();
    // Assembled from parts so it is not a literal, as in launch.test.ts.
    const parts = ["987654321", "AAF-zyxwvutsrqponmlkjihgfedcba_9876"];
    const tokenTail = parts[1] ?? "";
    const clip = stubClipboard(sandbox, parts.join(":"));
    const file = path.join(sandbox.stateDir, TOKEN_FILE);
    const result = runCli(sandbox, [STORE_TOKEN, FROM_CLIPBOARD], {
      env: { PATH: clip.PATH },
    });
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({ stored: true, clipboardCleared: true });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(existsSync(clip.cleared)).toBe(true);
    expect(result.stdout + result.stderr).not.toContain(tokenTail);
  });

  it("--from-clipboard refuses a non-token without echoing it (exit 2)", () => {
    const sandbox = makeSandbox();
    const value = "not-a-bot-token-value";
    const clip = stubClipboard(sandbox, value);
    const result = runCli(sandbox, [STORE_TOKEN, FROM_CLIPBOARD], {
      env: { PATH: clip.PATH },
    });
    expect(result.status).toBe(2);
    expect(result.json).toMatchObject({ stored: false, reason: "invalid" });
    expect(result.stdout + result.stderr).not.toContain(value);
    expect(existsSync(clip.cleared)).toBe(false);
    expect(existsSync(path.join(sandbox.stateDir, TOKEN_FILE))).toBe(false);
  });
});

describe("trust-status", () => {
  it("reads Claude Code's trust record for each routed repo", () => {
    const sandbox = makeSandbox({ repos: ["api", "web"] });
    const api = path.join(sandbox.root, PROJECTS, "api");
    const web = path.join(sandbox.root, PROJECTS, "web");
    writeFileSync(
      path.join(sandbox.home, ".claude.json"),
      JSON.stringify({ projects: { [api]: { hasTrustDialogAccepted: true } } })
    );
    const result = runCli(sandbox, ["trust-status"]);
    expect(result.status).toBe(0);
    expect(result.json.dirs).toEqual([
      { dir: api, trusted: true },
      { dir: web, trusted: false },
    ]);
    expect(result.json.needsTrust).toEqual([web]);
  });
});

describe("coexistence", () => {
  it("reports the intake loops' last recorded runs", () => {
    const sandbox = makeSandbox();
    const runs = path.join(sandbox.root, ".lisa", "automations", "runs");
    mkdirSync(runs, { recursive: true });
    writeFileSync(
      path.join(runs, "intake-repair.jsonl"),
      `${JSON.stringify({ ts: LONG_AGO, outcome: "no-op" })}\n`
    );
    const result = runCli(sandbox, ["coexistence"]);
    expect(result.status).toBe(0);
    expect(result.json.live).toEqual([]);
    expect(result.json.loops).toEqual([
      expect.objectContaining({ loop: "intake-tickets", lastRun: null }),
      expect.objectContaining({
        loop: "intake-repair",
        lastRun: { ts: LONG_AGO, outcome: "no-op" },
        recent: false,
      }),
    ]);
  });
});
