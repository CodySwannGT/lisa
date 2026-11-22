/** Effective notification levels in the ordinary CLI and session-start hook. */
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  hookRunner,
  LOCAL_CONFIG,
} from "../../helpers/inject-resolved-config-harness.js";
import {
  MANAGER,
  makeSandbox,
  removeSandboxes,
  runCli,
  writeJson,
} from "./support/cli-harness.js";

const LEVEL_PATH = "sessionManager.notify.level";
const NOTIFY = {
  provider: "telegram",
  stateDir: "~/.claude/channels/telegram-fixture",
};
const { contextFor } = hookRunner(process.env);

afterEach(removeSandboxes);

describe("session manager notification level", () => {
  it.each([undefined, "all", "asks-only"])(
    "shows the effective notification level in status and at session start for %s",
    level => {
      const sandbox = makeSandbox({
        sessionManager: { name: MANAGER, notify: { ...NOTIFY, level } },
      });
      expect(runCli(sandbox, ["validate"]).json).toMatchObject({ valid: true });

      const status = runCli(sandbox, ["status"]);
      expect(status.status, status.stderr).toBe(0);
      expect(status.json).toMatchObject({
        notify: "telegram",
        notifyLevel: level ?? "all",
      });
      const startup = contextFor(sandbox.root, {
        hook_event_name: "SessionStart",
      });
      expect(startup).toContain(`${LEVEL_PATH}: ${level ?? "all"}`);
      expect(startup).not.toContain(NOTIFY.stateDir);
    }
  );

  it("uses the local override in both readers without restating the provider", () => {
    const sandbox = makeSandbox({
      sessionManager: { name: MANAGER, notify: NOTIFY },
    });
    writeJson(path.join(sandbox.root, LOCAL_CONFIG), {
      sessionManager: { notify: { level: "asks-only" } },
    });

    expect(runCli(sandbox, ["status"]).json).toMatchObject({
      notify: "telegram",
      notifyLevel: "asks-only",
    });
    expect(contextFor(sandbox.root)).toContain(`${LEVEL_PATH}: asks-only`);
  });

  it.each([null, true, "quiet"])("refuses the unsupported level %s", level => {
    const sandbox = makeSandbox({
      sessionManager: { name: MANAGER, notify: { ...NOTIFY, level } },
    });
    const result = runCli(sandbox, ["validate"]);
    expect(result.status).toBe(2);
    expect(result.json.errors).toEqual([expect.stringContaining(LEVEL_PATH)]);
    expect(contextFor(sandbox.root)).toContain(`${LEVEL_PATH}: INVALID`);
  });
});
