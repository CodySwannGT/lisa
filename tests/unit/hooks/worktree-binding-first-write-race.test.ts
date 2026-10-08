/** Concurrent native hooks must enforce the binding that wins creation. */
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../../support/git-executable.js";
import {
  ALLOWED,
  BLOCKED,
  buildFixture,
  runGuard,
  stateKey,
} from "./support/worktree-binding.js";

const GUARD = path.resolve("plugins/src/base/hooks/worktree-binding-guard.mjs");
const WINNER_MARKER = "competing native guard completed";

describe("concurrent first binding writes", () => {
  it.each([
    ["ordinary", "exclusive"],
    ["acknowledgement", "exclusive"],
    ["conflicting-owner", "exclusive"],
    ["ordinary", "second-read"],
    ["SessionStart", "second-read"],
  ])("preserves the native winner for %s at the %s boundary", (mode, phase) => {
    const fixture = buildFixture();
    const session = "concurrent-session";
    const payload = {
      session_id: session,
      tool_name: "Bash",
      tool_input: {
        command:
          mode === "acknowledgement"
            ? `echo 'lisa-worktree-binding: accept ${realpathSync(fixture.b)}'`
            : "echo hello",
      },
      cwd: fixture.b,
      ...(mode === "SessionStart" ? { hook_event_name: mode } : {}),
    };
    // State home does not exist yet; keep the scheduler in the owned checkout.
    const scheduler = path.join(fixture.main, "competing-writer.mjs");
    // Pause the losing hook immediately before its exclusive file creation.
    // A second real guard runs to completion, so the winner's state and verdict
    // come from the native implementation rather than a mocked binding.
    writeFileSync(
      scheduler,
      `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
const write = fs.writeFileSync;
const read = fs.readFileSync;
let competed = false;
let reads = 0;
function compete(file) {
  if (!competed) {
    competed = true;
    const winner = spawnSync(process.execPath, [${JSON.stringify(GUARD)}], {
      cwd: ${JSON.stringify(fixture.a)}, env: process.env,
      input: ${JSON.stringify(JSON.stringify({ session_id: session, cwd: fixture.a, tool_name: "Bash", tool_input: { command: "echo hello" } }))},
      encoding: 'utf8', timeout: 10000,
    });
    if (winner.error || winner.status !== 0) throw new Error('native winner failed');
    if (${JSON.stringify(mode)} === 'conflicting-owner') {
      const state = JSON.parse(read(file, 'utf8'));
      state.bindingIdentity = ['different-session', null];
      write(file, JSON.stringify(state));
    }
    process.stderr.write(${JSON.stringify(`${WINNER_MARKER}\n`)});
  }
}
fs.readFileSync = function(file, ...args) {
  if (${JSON.stringify(phase)} === 'second-read' && typeof file === 'string' && file.includes('/v4/')) {
    reads += 1;
    if (reads === 2) compete(file);
  }
  return read.call(this, file, ...args);
};
fs.writeFileSync = function(file, data, options) {
  if (${JSON.stringify(phase)} === 'exclusive' && options?.flag === 'wx') compete(file);
  return write.call(this, file, data, options);
};
syncBuiltinESMExports();
`
    );
    const result = boundedSpawnSync({
      label: "worktree-binding first-write race",
      command: process.execPath,
      args: ["--import", pathToFileURL(scheduler).href, GUARD],
      cwd: fixture.b,
      env: { ...cleanGitEnv(), LISA_STATE_HOME: fixture.state },
      input: JSON.stringify(payload),
    });
    expect(result.stderr).toContain(WINNER_MARKER);
    const file = path.join(
      fixture.state,
      "worktree-binding",
      `${stateKey(session)}.json`
    );
    const winnerBytes = readFileSync(file, "utf8");
    expect(JSON.parse(winnerBytes).boundRoot).toBe(realpathSync(fixture.a));
    expect(result.status).toBe(mode === "SessionStart" ? ALLOWED : BLOCKED);
    const call = { state: fixture.state, session };
    expect(runGuard({ ...call, cwd: fixture.a }).status).toBe(
      mode === "conflicting-owner" ? BLOCKED : ALLOWED
    );
    expect(runGuard({ ...call, cwd: fixture.b }).status).toBe(BLOCKED);
    expect(readFileSync(file, "utf8")).toBe(winnerBytes);
  });
});
