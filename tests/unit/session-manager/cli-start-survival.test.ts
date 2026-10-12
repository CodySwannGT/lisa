/**
 * `start` must not report a manager that never ran (#4448 live-verification
 * defects D1 and D3).
 *
 * Live, claude exited 1 at once on a bad argv, tmux closed the session, and
 * `start` still printed `{"status":"started"}`. `start` now watches the new
 * session for a bounded settle window (`--settle-ms`, default 3000) with
 * `tmux has-session -t =<name>`, and exits 2 with a foreground command the
 * operator can run to see claude's own error when the session is gone.
 * @module tests/unit/session-manager/cli-start-survival
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  MANAGER,
  makeSandbox,
  removeSandboxes,
  runCli,
  type Sandbox,
} from "./support/cli-harness.js";
import { callsOf } from "./support/cli-fixtures.js";

afterEach(removeSandboxes);

const TMUX = "tmux";
const NEW_SESSION = "new-session";
const SETTLE = ["--settle-ms", "300"];
const HAS_SESSION = ["has-session", "-t", `=${MANAGER}`];

/**
 * Put an owner-only token file in the sandbox state dir.
 * @param sandbox - Project sandbox
 */
function plantTokenFile(sandbox: Sandbox): void {
  const file = path.join(sandbox.stateDir, ".env");
  mkdirSync(sandbox.stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(file, "placeholder\n");
  chmodSync(file, 0o600);
}

describe("start survival check", () => {
  it("reports started only after the session survives the settle window", () => {
    const sandbox = makeSandbox();
    plantTokenFile(sandbox);
    const result = runCli(sandbox, ["start", ...SETTLE]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({ status: "started", name: MANAGER });
    const tmux = result.calls.filter(call => call.bin === TMUX);
    const launchAt = tmux.findIndex(call => call.argv[0] === NEW_SESSION);
    const after = tmux.slice(launchAt + 1).map(call => call.argv);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every(argv => argv.join(" ") === HAS_SESSION.join(" "))).toBe(
      true
    );
  });

  it("exits 2 with a foreground command when the session dies at once", () => {
    const sandbox = makeSandbox();
    plantTokenFile(sandbox);
    const result = runCli(sandbox, ["start", ...SETTLE], {
      env: { STUB_TMUX_SESSION_DIES: "1" },
    });
    expect(result.status).toBe(2);
    expect(result.json).toBeNull();
    expect(result.stderr).toContain(MANAGER);
    expect(result.stderr).toMatch(/foreground/);
    expect(result.stderr).toContain("claude -n");
    expect(result.stderr).toContain(
      "-- '/loop 5m /lisa:session-manager cycle'"
    );
    expect(result.stderr).toContain(`TELEGRAM_STATE_DIR='${sandbox.stateDir}'`);
    expect(result.stderr).not.toContain("planted-value-never-forwarded");
    expect(callsOf(result.calls, TMUX, NEW_SESSION)).toHaveLength(1);
  });

  it("checks the exact session name, never a prefix match", () => {
    const sandbox = makeSandbox();
    plantTokenFile(sandbox);
    const result = runCli(sandbox, ["start", ...SETTLE], {
      env: { STUB_TMUX_SESSION_DIES: "1" },
    });
    const checks = callsOf(result.calls, TMUX, "has-session");
    expect(checks.at(-1)?.argv).toEqual(HAS_SESSION);
  });

  it.each([["-1"], ["abc"], ["60001"]])(
    "exits 2 for --settle-ms %s without launching",
    value => {
      const sandbox = makeSandbox();
      plantTokenFile(sandbox);
      const result = runCli(sandbox, ["start", "--settle-ms", value]);
      expect(result.status).toBe(2);
      expect(callsOf(result.calls, TMUX, NEW_SESSION)).toEqual([]);
    }
  );
});
