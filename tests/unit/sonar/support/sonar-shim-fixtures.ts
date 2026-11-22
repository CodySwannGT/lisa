/**
 * Shared fixtures for the Sonar shim-repoint suites.
 *
 * Extracted when the CodeRabbit review of CodySwannGT/lisa#4502 added the
 * write-safety cases and the suite crossed its `max-lines` ceiling: the work is
 * divided rather than the ceiling raised. Every fixture is a real temporary
 * checkout carrying the real shipped wrapper.
 * @module tests/unit/sonar/support/sonar-shim-fixtures
 */
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach } from "vitest";

import { SONAR_WRAPPER_PATH } from "../../../../src/sonar/sonar-shim-repoint.js";
import { SHIPPED } from "../../hooks/support/sonar-secrets-fixtures.js";

export const CLAUDE_PROMPT =
  ".claude/hooks/sonar-secrets/build-scripts/prompt-secrets.sh";
export const ANTIGRAVITY = ".agents/sonar/hooks/pretool-secrets.sh";
export const SHEBANG = "#!/bin/bash";
export const PROMPT_EVENT = "claude-prompt-submit";
export const GUARD_IF = "if ! command -v sonar &> /dev/null; then";

/** The exec line a repointed Claude prompt shim must carry. */
export const CLAUDE_PROMPT_EXEC =
  'exec bash "${here}/../../../../scripts/lisa-hooks/sonar-secrets.sh" claude-prompt-submit';

const temporaries: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaries
      .splice(0)
      .map(directory => rm(directory, { force: true, recursive: true }))
  );
});

/**
 * The shim `sonar integrate` writes, verbatim from the vendor's
 * `buildUnixHookScript`.
 * @param event - Vendor hook event name
 * @returns Shim body
 */
export function vendorShim(event: string): string {
  return [SHEBANG, GUARD_IF, "  exit 0", "fi", `sonar hook ${event}`, ""].join(
    "\n"
  );
}

/**
 * A temporary directory removed after the current case.
 * @param prefix - Temp-directory prefix, so a failing run names itself
 * @returns Absolute directory path
 */
export async function scratchDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaries.push(directory);
  return directory;
}

/**
 * Create a checkout fixture, optionally carrying the real shipped wrapper.
 * @param withWrapper - Whether to copy the wrapper into the checkout
 * @returns Absolute checkout root
 */
export async function checkout(withWrapper = true): Promise<string> {
  const root = await scratchDir("lisa-sonar-shim-");
  if (withWrapper) {
    const wrapper = path.join(root, SONAR_WRAPPER_PATH);
    await mkdir(path.dirname(wrapper), { recursive: true });
    await copyFile(SHIPPED, wrapper);
  }
  return root;
}

/**
 * Write an executable shim into the checkout.
 * @param root - Checkout root
 * @param relative - Shim path relative to the root
 * @param body - Shim body
 * @returns Absolute shim path
 */
export async function writeShim(
  root: string,
  relative: string,
  body: string
): Promise<string> {
  const absolute = path.join(root, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, body);
  await chmod(absolute, 0o755);
  return absolute;
}
