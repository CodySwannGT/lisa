/** Regression coverage for Codex hook stdin lifecycle. */
import { spawn } from "node:child_process";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SESSION_HOOKS = [
  "inject-rules.sh",
  "install-pkgs.sh",
  "setup-jira-cli.sh",
] as const;

/**
 * Drive one hook with a payload larger than a typical pipe buffer.
 * @param scriptName Hook script filename.
 * @returns Process exit code and any stdin error code.
 */
function driveHook(
  scriptName: string
): Promise<{ readonly exitCode: number | null; readonly stdinError?: string }> {
  let stdinError: string | undefined;
  const child = spawn(
    "/bin/bash",
    [path.join(REPO_ROOT, "src", "codex", "scripts", scriptName)],
    {
      cwd: REPO_ROOT,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      stdio: ["pipe", "ignore", "ignore"],
    }
  );
  const exitCodePromise = new Promise<number | null>(resolve => {
    child.on("exit", resolve);
  });
  child.stdin.on("error", error => {
    stdinError = (error as NodeJS.ErrnoException).code;
  });
  child.stdin.end(JSON.stringify({ padding: "x".repeat(1024 * 1024) }));
  return exitCodePromise.then(exitCode => {
    return { exitCode, ...(stdinError === undefined ? {} : { stdinError }) };
  });
}

describe("Codex hook stdin draining", () => {
  it.each(SESSION_HOOKS)("%s consumes the complete envelope", async script => {
    await expect(driveHook(script)).resolves.toEqual({ exitCode: 0 });
  });
});
