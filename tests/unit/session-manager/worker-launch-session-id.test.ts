/**
 * Contract tests for finding the full session id a resume needs.
 *
 * `claude --bg --resume <8-char id>` (2.1.296) does not wake the session: it
 * starts an unnamed copy of the conversation the manager never sees. The
 * ledger only has the short id `claude --bg` printed, so resume maps it to the
 * full id from `claude agents --json --all`, and gets null rather than a
 * guess when no row carries one.
 * @module tests/unit/session-manager/worker-launch-session-id
 */
import { describe, expect, it } from "vitest";

import { resolveFullSessionId } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/worker-launch.mjs";

const FULL = "78850195-4f0c-4bd1-8262-3ac1becf127c";
const WORKER = "wk-sandbox-2-1012-1910";

/**
 * A normalized agents row.
 * @param fields - Overrides
 * @returns Row
 */
const row = (fields: Record<string, string | null>) => ({
  name: null,
  id: null,
  sessionId: null,
  ...fields,
});

describe("resolveFullSessionId", () => {
  it("keeps a recorded full id", () => {
    expect(resolveFullSessionId([], { worker: WORKER, sessionId: FULL })).toBe(
      FULL
    );
  });

  it("maps a short id to the full one by worker name", () => {
    const agents = [row({ name: WORKER, id: "78850195", sessionId: FULL })];
    expect(
      resolveFullSessionId(agents, { worker: WORKER, sessionId: "78850195" })
    ).toBe(FULL);
  });

  it("maps a short id by its prefix when the row lost its name", () => {
    const agents = [row({ sessionId: FULL })];
    expect(
      resolveFullSessionId(agents, { worker: WORKER, sessionId: "78850195" })
    ).toBe(FULL);
  });

  it("ignores another session's row", () => {
    const agents = [
      row({
        name: "someone-else",
        id: "c9c025f4",
        sessionId: "c9c025f4-0000-4000-8000-000000000000",
      }),
    ];
    expect(
      resolveFullSessionId(agents, { worker: WORKER, sessionId: "78850195" })
    ).toBeNull();
  });

  it("returns null when no row carries a full id", () => {
    const agents = [row({ name: WORKER, id: "78850195" })];
    expect(
      resolveFullSessionId(agents, { worker: WORKER, sessionId: "78850195" })
    ).toBeNull();
  });
});
