/**
 * Fixtures for driving `scripts/lisa-enforcement-fallback.sh` the way Claude
 * Code drives it: the PreToolUse payload on stdin, `CLAUDE_PROJECT_DIR` naming
 * the checkout, and a checkout built on disk rather than mocked.
 *
 * Shared by the attribution and staleness suites, which split only because one
 * file of them exceeds the line budget — they are two halves of one proof that
 * a stale resolved guard copy is visible and attributable
 * (CodySwannGT/lisa#3205).
 * @module tests/helpers/enforcement-fallback-fixtures
 */
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { boundedSpawnSync } from "./io-latency-budget.js";

/** Absolute, so the interpreter is never resolved through a writeable PATH. */
const BASH = "/bin/bash";

/** The Lisa checkout these suites run inside. */
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The dispatcher under test. */
const FALLBACK = path.join(
  REPO_ROOT,
  "scripts",
  "lisa-enforcement-fallback.sh"
);

/** The plugin tree this repository ships, and the source of real guards. */
export const PLUGIN_HOOKS = path.join(REPO_ROOT, "plugins", "lisa", "hooks");

/** Claude's refusal code. Anything else lets the tool call through. */
export const BLOCKED = 2;

/**
 * A config directory that cannot exist.
 *
 * Every case sets it. Without it the machine's own marketplace clone becomes a
 * version reference, and a suite that reads whatever release happens to be
 * installed on the box would assert a different thing every week.
 */
const NO_CONFIG = "/nonexistent-claude-config";

export const BLOCK_NO_VERIFY = "block-no-verify";
export const PARITY_SAFETY_NET = "parity-safety-net";
export const BLOCK_SHELL_JSON = "block-shell-json-parsing";
export const BLOCK_INSTRUCTION_FILES = "block-instruction-file-edits";
export const BLOCK_ISSUE_CREATE = "block-direct-issue-create";
export const BLOCK_MANAGED_FILES = "block-managed-file-edits";

/** The guards the dispatcher replays a payload to, in dispatch order. */
export const GUARDS = [
  BLOCK_NO_VERIFY,
  PARITY_SAFETY_NET,
  BLOCK_SHELL_JSON,
  BLOCK_INSTRUCTION_FILES,
  BLOCK_ISSUE_CREATE,
  BLOCK_MANAGED_FILES,
] as const;

/** Version stamped on a deliberately-behind tree. */
export const BEHIND = "4.9.0";

/** Version stamped on a current tree. */
export const CURRENT = "4.16.0";

/** Directory-relative location of a host's applied guards. */
export const HOST_TREE = path.join("scripts", "lisa-hooks");

/** Directory-relative location of the Lisa monorepo's own guards. */
export const PLUGIN_TREE = path.join("plugins", "lisa", "hooks");

const temporaries: string[] = [];

/** Remove every scratch root made since the last call. */
export function cleanupScratchRoots(): void {
  // eslint-disable-next-line functional/immutable-data -- a registry of live temp directories is mutable by nature
  for (const dir of temporaries.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A throwaway directory, removed by the next {@link cleanupScratchRoots}.
 * @returns Absolute path to the new directory.
 */
export function scratchRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-fallback-copy-"));

  // eslint-disable-next-line functional/immutable-data -- a registry of live temp directories is mutable by nature
  temporaries.push(root);
  return root;
}

/**
 * Copy the repository's real guards into a tree.
 *
 * Real ones, not stubs, wherever the case is about what enforcement decides: a
 * stub proves the dispatcher's plumbing and nothing about whether the guard
 * bites.
 * @param dir Directory to populate.
 * @param guards Guard names to copy.
 */
export function installRealGuards(
  dir: string,
  guards: readonly string[] = GUARDS
): void {
  mkdirSync(dir, { recursive: true });
  for (const guard of guards) {
    copyFileSync(
      path.join(PLUGIN_HOOKS, `${guard}.sh`),
      path.join(dir, `${guard}.sh`)
    );
  }
}

/**
 * Write the apply receipt that dates a host's `scripts/lisa-hooks/` tree.
 *
 * The receipt and the guards are written by the same `lisa apply`, which is
 * what makes it that tree's vintage rather than a guess about it.
 * @param root Project root.
 * @param version Lisa version that performed the apply.
 */
export function dateHostTree(root: string, version: string): void {
  mkdirSync(path.join(root, ".lisa"), { recursive: true });
  writeFileSync(
    path.join(root, ".lisa", "apply-receipt.json"),
    `${JSON.stringify(
      {
        schema_version: 1,
        lisa_version: version,
        applied_at: "2026-08-01T00:00:00.000Z",
        harness: "fleet",
        apply_mode: "full",
        stale_paths: [],
      },
      null,
      2
    )}\n`
  );
}

/**
 * Write the plugin manifest that dates a `plugins/lisa/hooks/` tree.
 * @param root Project root.
 * @param version Plugin version to stamp.
 */
export function datePluginTree(root: string, version: string): void {
  const manifestDir = path.join(root, "plugins", "lisa", ".claude-plugin");

  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    path.join(manifestDir, "plugin.json"),
    `${JSON.stringify({ name: "lisa", version }, null, 2)}\n`
  );
}

/**
 * Write a guard that refuses one payload substring and permits everything
 * else, standing in for a copy predating a fix.
 *
 * The substring is `/private/tmp`, because that is the concrete regression: the
 * physical spelling of the scratch directory was refused by the copy in force
 * after the fix permitting it had already shipped, and the only way past was to
 * re-spell the same path.
 * @param file Absolute path to write the guard at.
 */
export function writeBehindGuard(file: string): void {
  writeFileSync(
    file,
    [
      "#!/usr/bin/env bash",
      'payload="$(cat)"',
      'case "$payload" in',
      "  */private/tmp*)",
      '    echo "Blocked by safety-net: physical scratch spelling" >&2',
      "    exit 2",
      "    ;;",
      "esac",
      "exit 0",
      "",
    ].join("\n")
  );
  chmodSync(file, 0o755);
}

/** What one dispatcher run produced. */
export interface Run {
  readonly status: number | null;
  readonly output: string;
}

/**
 * A private TMPDIR for the once-per-session notice marker.
 *
 * Set per case, so one case's session state can never suppress another's
 * notice — a suite that shared it would pass or fail on execution order.
 * @returns Absolute path to a fresh directory.
 */
export function scratchTmpdir(): string {
  return scratchRoot();
}

/**
 * Drive the dispatcher exactly as Claude Code does.
 * @param payload The PreToolUse payload, serialized here.
 * @param projectDir Value of CLAUDE_PROJECT_DIR.
 * @param tmpDir TMPDIR for the session notice marker; a fresh one per call
 *   unless a case deliberately shares one to exercise the rate limit.
 * @returns Exit status and combined output.
 */
export function runFallback(
  payload: unknown,
  projectDir: string,
  tmpDir: string = scratchRoot()
): Run {
  const result = boundedSpawnSync({
    label: "lisa-enforcement-fallback.sh",
    command: BASH,
    args: [FALLBACK],
    input: JSON.stringify(payload),
    cwd: projectDir,
    env: {
      // eslint-disable-next-line no-restricted-syntax -- a subprocess harness inherits the real environment; there is no ConfigService in a hook fixture
      ...process.env,
      CLAUDE_PROJECT_DIR: projectDir,
      CLAUDE_CONFIG_DIR: NO_CONFIG,
      TMPDIR: tmpDir,
    },
  });

  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

/**
 * A Bash tool call.
 * @param command The command Claude proposes to run.
 * @param sessionId Session the call belongs to; omitted means a payload with
 *   no session id at all, which the dispatcher must degrade loudly on.
 * @returns The PreToolUse payload for it.
 */
export function bash(command: string, sessionId?: string): unknown {
  const call = { tool_name: "Bash", tool_input: { command } };

  return sessionId === undefined ? call : { session_id: sessionId, ...call };
}

/**
 * A Write tool call.
 * @param file The absolute path Claude proposes to write.
 * @returns The PreToolUse payload for it.
 */
export function write(file: string): unknown {
  return { tool_name: "Write", tool_input: { file_path: file, content: "x" } };
}
