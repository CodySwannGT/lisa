/**
 * Contract tests for dispatching to a Claude cloud session.
 *
 * The rule these protect is that a dispatch is only successful when something
 * durable came back. An accepted request whose identifier was not captured is
 * worse than a refused one: nothing can reconcile the run, and a retry
 * duplicates irreversible work.
 *
 * The request runner is injected, so every case here exercises the real
 * response handling against recorded bodies without reaching the network or
 * needing a credential.
 * @module tests/unit/secrets/remote-dispatch-claude-web
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  EXECUTION_ENVS,
  assertPreconditions,
  dispatchClaudeWeb,
  buildInvocation,
  readFireResponse,
  resolveExecutionEnv,
} from "../../../plugins/src/base/skills/lisa-remote-dispatch/scripts/dispatch.mjs";

/** The surface under test, named once so the literal cannot drift. */
const CLAUDE_WEB = "claude-web";

/** A session identifier shaped like the endpoint returns. */
const SESSION_ID = "session_01HJKLMNOPQRSTUVWXYZ";
const SESSION_URL = `https://claude.ai/code/${SESSION_ID}`;

describe("execution surfaces", () => {
  it("accepts claude-web as a routing target", () => {
    expect(EXECUTION_ENVS.has(CLAUDE_WEB)).toBe(true);
    expect(resolveExecutionEnv({ executionEnv: CLAUDE_WEB })).toBe(CLAUDE_WEB);
  });

  it("still rejects an unknown surface rather than running locally", () => {
    // A silently ignored executionEnv runs the work on the operator's machine
    // while they believe it went remote, and nothing downstream contradicts it.
    expect(() => resolveExecutionEnv({ executionEnv: "claude-cloud" })).toThrow(
      /unknown executionEnv/i
    );
  });
});

describe("preconditions", () => {
  it("requires the routine, not a repository", () => {
    // A Claude cloud environment binds no repository — it is account-scoped and
    // the repository arrives per session — so demanding one would ask for a
    // field that cannot be true of this surface.
    expect(() =>
      assertPreconditions({ repository: "org/repo" }, CLAUDE_WEB)
    ).toThrow(/routineId/);
  });

  it("names every missing field at once", () => {
    expect(() => assertPreconditions({}, CLAUDE_WEB)).toThrow(
      /routineId, fireUrl/
    );
  });

  it("passes a surface bound to a routine", () => {
    expect(() =>
      assertPreconditions(
        { routineId: "trig_01ABC", fireUrl: "https://example/fire" },
        "claude-web"
      )
    ).not.toThrow();
  });

  it("leaves the Codex contract unchanged", () => {
    expect(() =>
      assertPreconditions({ environmentId: "env_1" }, "codex-cloud")
    ).toThrow(/repository/);
  });
});

describe("dispatching", () => {
  const BLOCK = {
    routineId: "trig_01ABC",
    fireUrl:
      "https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire",
  };
  const getToken = (): string => "sk-ant-oat01-fake";
  let root: string;

  const accepted = (): Response =>
    ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          claude_code_session_id: SESSION_ID,
          claude_code_session_url: SESSION_URL,
        }),
    }) as unknown as Response;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "lisa-dispatch-"));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("sends the payload as untrusted text and records the session", async () => {
    let seen: { url?: string; init?: RequestInit } = {};
    const post = async (url: string, init: RequestInit): Promise<Response> => {
      seen = { url, init };
      return accepted();
    };

    const result = await dispatchClaudeWeb(
      BLOCK,
      "$lisa-implement SE-1",
      "SE-1",
      {
        post,
        getToken,
        cwd: root,
      }
    );

    expect(result).toEqual({ sessionId: SESSION_ID, url: SESSION_URL });
    expect(seen.url).toBe(BLOCK.fireUrl);
    expect(JSON.parse(String(seen.init?.body))).toEqual({
      text: "$lisa-implement SE-1",
    });

    const ledger = JSON.parse(
      readFileSync(path.join(root, ".lisa", "remote-dispatch.json"), "utf8")
    );
    expect(ledger.dispatches[0].taskId).toBe(SESSION_ID);
    expect(ledger.dispatches[0].surface).toBe(CLAUDE_WEB);
  });

  it("carries the bearer token and the dated beta", async () => {
    let headers: Record<string, string> = {};
    const post = async (_url: string, init: RequestInit): Promise<Response> => {
      headers = init.headers as Record<string, string>;
      return accepted();
    };

    await dispatchClaudeWeb(BLOCK, "p", "p", { post, getToken, cwd: root });

    expect(headers.authorization).toBe("Bearer sk-ant-oat01-fake");
    expect(headers["anthropic-beta"]).toBe(
      "experimental-cc-routine-2026-04-01"
    );
  });

  it("refuses and writes nothing when the routine rejects the token", async () => {
    const post = async (): Promise<Response> =>
      ({
        ok: false,
        status: 401,
        text: async () => '{"error":"unauthorized"}',
      }) as unknown as Response;

    await expect(
      dispatchClaudeWeb(BLOCK, "p", "p", { post, getToken, cwd: root })
    ).rejects.toThrow(/HTTP 401[\s\S]*revoked/i);
    expect(existsSync(path.join(root, ".lisa", "remote-dispatch.json"))).toBe(
      false
    );
  });

  it("reports an unreachable endpoint as a failed dispatch", async () => {
    const post = async (): Promise<Response> => {
      throw new Error("getaddrinfo ENOTFOUND");
    };

    await expect(
      dispatchClaudeWeb(BLOCK, "p", "p", { post, getToken, cwd: root })
    ).rejects.toThrow(/could not reach the routine endpoint/i);
  });

  it("bounds the wait, so a silent endpoint fails rather than hangs", async () => {
    // The failure `fetch` does not have an answer for on its own: a connection
    // that is accepted and then never spoken on. Without a deadline that is not
    // a failed dispatch at all, it is a dispatch that never returns — no error,
    // no ledger entry, no operator.
    let deadline: AbortSignal | undefined;
    const post = async (_url: string, init: RequestInit): Promise<Response> => {
      deadline = init.signal ?? undefined;
      // What an aborted fetch actually throws, named the way the handler reads.
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    };

    await expect(
      dispatchClaudeWeb(BLOCK, "p", "p", { post, getToken, cwd: root })
    ).rejects.toThrow(
      /could not reach the routine endpoint: no response within/i
    );
    expect(deadline).toBeInstanceOf(AbortSignal);
  });
});

describe("fire response", () => {
  it("reads the identifier from a field rather than scraping output", () => {
    const body = JSON.stringify({
      type: "routine_fire",
      claude_code_session_id: SESSION_ID,
      claude_code_session_url: SESSION_URL,
    });
    expect(readFireResponse(body)).toEqual({
      sessionId: SESSION_ID,
      url: SESSION_URL,
    });
  });

  it("treats an accepted request with no identifier as a failed dispatch", () => {
    // Reporting success here would leave irreversible remote work that nothing
    // can reconcile, and a retry would start it a second time.
    expect(() =>
      readFireResponse(JSON.stringify({ type: "routine_fire" }))
    ).toThrow(/no session identifier/i);
  });

  it("says so when the endpoint returns something other than JSON", () => {
    expect(() => readFireResponse("<html>502 Bad Gateway</html>")).toThrow(
      /not JSON/i
    );
  });

  it("tolerates a missing url without losing the identifier", () => {
    const body = JSON.stringify({ claude_code_session_id: SESSION_ID });
    expect(readFireResponse(body)).toEqual({ sessionId: SESSION_ID, url: "" });
  });
});

describe("skill invocation syntax", () => {
  // The prefix IS the invocation. Codex runs a skill with `$name`, Claude with
  // `/name`, and sending one agent the other's spelling produces a sentence
  // that mentions a skill rather than a command that runs one.
  //
  // Nothing downstream catches that. The routine accepts any text, so the
  // dispatch succeeds, a session identifier is recorded, and the ledger says
  // the work was handed off — while the session executes none of the skill's
  // contract. Being a capable model it will usually do *something*, which is
  // worse than failing outright, because it leaves no signal to act on.
  it("addresses a Claude session with the prefix Claude understands", () => {
    expect(buildInvocation(CLAUDE_WEB, "lisa-implement", "org/repo#7")).toBe(
      "/lisa-implement org/repo#7"
    );
  });

  it("still addresses Codex with its own prefix", () => {
    expect(buildInvocation("codex-cloud", "lisa-implement", "org/repo#7")).toBe(
      "$lisa-implement org/repo#7"
    );
  });

  it("emits a bare command when there is no payload", () => {
    // The trailing space is trimmed rather than sent verbatim. Harmless on one
    // agent is not a reason to rely on it on the other.
    expect(buildInvocation(CLAUDE_WEB, "lisa-verify", "")).toBe("/lisa-verify");
  });
});
