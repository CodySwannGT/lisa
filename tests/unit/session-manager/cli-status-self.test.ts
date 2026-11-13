/**
 * `status` says whether the caller IS the manager (CodySwannGT/lisa#4496).
 *
 * The manager runs its `/loop` inside the tmux session `sessionManager.name`.
 * `status` used to report only that the session existed, so a cycle running
 * in that very session saw "a tmux manager is running" plus "this session has
 * a loop" and told the operator there were two managers, recommending it
 * delete its own loop. `manager.self` is the deterministic answer: true only
 * when the caller runs inside tmux and tmux names the caller's own session as
 * the manager's; null when the caller is inside tmux but tmux cannot say
 * which session it is. Run as a real process against the stub `tmux`.
 * @module tests/unit/session-manager/cli-status-self
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  MANAGER,
  makeSandbox,
  removeSandboxes,
  runCli,
} from "./support/cli-harness.js";
import { callsOf } from "./support/cli-fixtures.js";

afterEach(removeSandboxes);

/** A `$TMUX` value as tmux sets it inside a session: socket,pid,index. */
const TMUX_ENV = "/run/user/501/tmux-501/default,4242,0";
const PANE = "%3";
const DISPLAY = "display-message";

describe("status manager.self", () => {
  it("is true inside the manager's own tmux session", () => {
    const result = runCli(makeSandbox(), ["status"], {
      env: {
        STUB_TMUX_HAS_SESSION: "1",
        TMUX: TMUX_ENV,
        TMUX_PANE: PANE,
        STUB_TMUX_CURRENT_SESSION: MANAGER,
      },
    });
    expect(result.status).toBe(0);
    expect(result.json.manager).toEqual({
      name: MANAGER,
      running: true,
      self: true,
      otherCyclers: [],
    });
    expect(
      callsOf(result.calls, "tmux", DISPLAY).map(call => call.argv)
    ).toEqual([[DISPLAY, "-p", "-t", PANE, "#{session_name}"]]);
  });

  it("is false outside tmux while the manager runs, and asks tmux nothing", () => {
    const result = runCli(makeSandbox(), ["status"], {
      env: { STUB_TMUX_HAS_SESSION: "1", STUB_TMUX_CURRENT_SESSION: MANAGER },
    });
    expect(result.status).toBe(0);
    expect(result.json.manager).toEqual({
      name: MANAGER,
      running: true,
      self: false,
      otherCyclers: [],
    });
    expect(callsOf(result.calls, "tmux", DISPLAY)).toEqual([]);
  });

  it("is false inside a different tmux session", () => {
    const result = runCli(makeSandbox(), ["status"], {
      env: {
        STUB_TMUX_HAS_SESSION: "1",
        TMUX: TMUX_ENV,
        TMUX_PANE: PANE,
        STUB_TMUX_CURRENT_SESSION: "operator-shell",
      },
    });
    expect(result.status).toBe(0);
    expect(result.json.manager).toMatchObject({ running: true, self: false });
  });

  // Without `-t`, tmux answers for its "best" client: the most recently
  // active one, which can be another session. Inside tmux with no usable
  // pane id the answer is unknown, so status never asks.
  it.each([
    ["missing", undefined],
    ["malformed", "foo"],
  ])("is null without asking tmux when TMUX_PANE is %s", (_label, pane) => {
    const result = runCli(makeSandbox(), ["status"], {
      env: {
        STUB_TMUX_HAS_SESSION: "1",
        TMUX: TMUX_ENV,
        STUB_TMUX_CURRENT_SESSION: MANAGER,
        ...(pane === undefined ? {} : { TMUX_PANE: pane }),
      },
    });
    expect(result.status).toBe(0);
    expect(result.json.manager).toMatchObject({ running: true, self: null });
    expect(callsOf(result.calls, "tmux", DISPLAY)).toEqual([]);
  });

  // Fail safe: inside tmux, a failed probe is "unknown", never "not the
  // manager" — false would tell the manager to stop its own loop (#4496 AC-3).
  it("is null, never an error, when tmux cannot name the caller's session", () => {
    const result = runCli(makeSandbox(), ["status"], {
      env: { STUB_TMUX_HAS_SESSION: "1", TMUX: TMUX_ENV, TMUX_PANE: PANE },
    });
    expect(result.status).toBe(0);
    expect(result.json.manager).toMatchObject({ running: true, self: null });
  });

  it("is null when tmux names no session at all", () => {
    const result = runCli(makeSandbox(), ["status"], {
      env: {
        STUB_TMUX_HAS_SESSION: "1",
        TMUX: TMUX_ENV,
        TMUX_PANE: PANE,
        STUB_TMUX_CURRENT_SESSION: "",
      },
    });
    expect(result.status).toBe(0);
    expect(result.json.manager).toMatchObject({ running: true, self: null });
  });
});
