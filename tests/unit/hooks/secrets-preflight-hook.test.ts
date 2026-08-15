/**
 * The session-start readiness hook must inject, never break, and never hide the
 * half it was not asked to skip.
 *
 * Two defects, one shape each:
 *
 * - `jq` was called unguarded to emit the hook's JSON. `node` had a guard; jq
 *   did not. On a machine without jq the hook wrote no JSON, leaked
 *   `jq: command not found`, and exited 127 — a failure reported by a hook
 *   designed to be silent and non-blocking.
 * - `LISA_SKIP_SECRETS_PREFLIGHT` exited before the TOOLING preflight ran, so a
 *   variable that names the secrets check also suppressed a missing `gh` or
 *   `maestro`. An opt-out has to be scoped to what it names.
 * @module tests/unit/hooks/secrets-preflight-hook
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

/** The hook as it is installed into a plugin root. */
const HOOK = path.resolve(
  __dirname,
  "../../../plugins/src/base/hooks/secrets-preflight.sh"
);

const SECRETS_MARK = "SECRETS-PREFLIGHT-RAN";
const TOOLS_MARK = "TOOLS-PREFLIGHT-RAN";
const SKIP = "LISA_SKIP_SECRETS_PREFLIGHT";

/** Everything the hook legitimately needs, minus the one under test. */
const SHIM_TOOLS = ["bash", "sh", "env", "printf", "cat", "node", "dirname"];

const temporary: string[] = [];

/**
 * Find an executable by scanning PATH directly.
 *
 * Deliberately not `command -v` in a subprocess: resolving a command *through*
 * PATH is what `sonarjs/no-os-command-from-path` exists to prevent.
 * @param tool - The executable name
 * @returns Its absolute path, or undefined
 */
function locate(tool: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, tool);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** An absolute bash, so the runner is never resolved through a shim PATH. */
const BASH = locate("bash") ?? "/bin/bash";

/**
 * A plugin root whose two preflight scripts announce themselves and fail.
 *
 * Both exit non-zero and print to stderr, which is the shape the hook collects:
 * a real preflight with something to report does exactly this.
 * @returns The plugin root directory
 */
function pluginRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-preflight-hook-"));
  const scripts: [string, string][] = [
    ["skills/lisa-secrets-access/scripts/preflight-secrets.mjs", SECRETS_MARK],
    ["skills/lisa-setup-remote-env/scripts/preflight-tools.mjs", TOOLS_MARK],
  ];
  temporary.push(root);
  for (const [relative, mark] of scripts) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      `console.error(${JSON.stringify(mark)});\nprocess.exit(1);\n`
    );
  }
  return root;
}

/**
 * A PATH directory holding everything the hook needs except `jq`.
 * @returns The directory to use as PATH
 */
function shimWithoutJq(): string {
  const shim = mkdtempSync(path.join(tmpdir(), "lisa-preflight-nojq-"));
  temporary.push(shim);
  for (const tool of SHIM_TOOLS) {
    const found = locate(tool);
    if (found) symlinkSync(found, path.join(shim, tool));
  }
  return shim;
}

const ROOT = pluginRoot();

afterAll(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

/**
 * Run the hook against the fake plugin root.
 * @param env - Extra environment for this run
 * @returns Exit status, stdout and stderr
 */
function runHook(env: Record<string, string> = {}): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(BASH, [HOOK], {
    input: "",
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, ...env },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * The context the hook injected.
 * @param stdout - The hook's stdout
 * @returns The additionalContext string, empty when nothing was emitted
 */
function injected(stdout: string): string {
  if (!stdout.trim()) return "";
  return JSON.parse(stdout).hookSpecificOutput.additionalContext;
}

describe("the readiness hook injects both reports", () => {
  it("collects the secrets and the tooling preflight", () => {
    const { status, stdout } = runHook();
    expect(status).toBe(0);
    const context = injected(stdout);
    expect(context).toContain(SECRETS_MARK);
    expect(context).toContain(TOOLS_MARK);
  });
});

describe("the opt-out is scoped to the check it names", () => {
  it("keeps the tooling preflight running when secrets are skipped", () => {
    // A missing `gh` or `maestro` is not a secrets finding, and a variable
    // about credentials must not be the way it goes unreported.
    const context = injected(runHook({ [SKIP]: "1" }).stdout);
    expect(context).toContain(TOOLS_MARK);
    expect(context).not.toContain(SECRETS_MARK);
  });

  it("does nothing for any other value of the variable", () => {
    const context = injected(runHook({ [SKIP]: "0" }).stdout);
    expect(context).toContain(SECRETS_MARK);
  });
});

describe("the readiness hook without jq", () => {
  it("exits 0 silently instead of 127 with a command-not-found", () => {
    // The hook's entire output is one `jq -n` document, so without jq there is
    // nothing it can honestly write. Reporting a failure from a hook that never
    // blocks is worse than saying nothing: the doctor and CI gates still run
    // both scripts.
    const { status, stdout, stderr } = runHook({ PATH: shimWithoutJq() });
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("");
    expect(stderr).not.toMatch(/not found/u);
  });
});
