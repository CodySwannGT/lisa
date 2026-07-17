import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as uiCmd from "../../../src/cli/ui-cmd.js";
import type { ProbeResult, StatusProbe } from "../../../src/cli/ui-cmd.js";
import type { JsonValue } from "../../../src/sync/json-path.js";

/** Public surface expected from the live-status contract. */
const statusApi = uiCmd as typeof uiCmd & {
  runProbe<T extends JsonValue>(probe: StatusProbe<T>): Promise<ProbeResult<T>>;
};

/** Holder for per-test temp resources. */
interface TestResources {
  dir: string;
}

const resources: TestResources = { dir: "" };
const UNKNOWN_STATE = "unknown" as const;
const GITHUB_AUTH_PROBE_ID = "github-auth";
const NOT_AUTHENTICATED_REASON = "not-authenticated" as const;
const GITHUB_NOT_AUTHENTICATED = "GitHub CLI is not authenticated";
const GITHUB_STATUS_UNAVAILABLE = "GitHub status is unavailable";
const GITHUB_HOSTNAME = "github.com";
const ENTERPRISE_HOSTNAME = "github.enterprise.example";
const PROBE_FAILED_REASON = "probe-failed" as const;
const DEEP_JSON_DEPTH = 1_000;
const OVERSIZED_JSON_ITEMS = 50_000;

beforeEach(async () => {
  resources.dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-status-"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(resources.dir, { recursive: true, force: true });
});

/**
 * Construct a focused status probe for the public runner contract.
 * @param id - Stable identifier exposed by the status endpoint
 * @param run - Probe operation returning one explicit tri-state result
 * @param timeoutMs - Maximum time the runner may await the probe
 * @returns A status probe suitable for `runProbe` or `runUi`
 */
function probe<T extends JsonValue>(
  id: string,
  run: (signal: AbortSignal) => Promise<ProbeResult<T>>,
  timeoutMs = 50
): StatusProbe<T> {
  return { id, run, timeoutMs };
}

/**
 * Write the active project's origin remote without invoking git.
 * @param remote - Origin URL stored in .git/config
 * @param additionalConfig - Extra git config sections used by the fixture
 */
async function writeOriginRemote(
  remote: string,
  additionalConfig = ""
): Promise<void> {
  await mkdir(path.join(resources.dir, ".git", "objects"), {
    recursive: true,
  });
  await mkdir(path.join(resources.dir, ".git", "refs"));
  await writeFile(
    path.join(resources.dir, ".git", "HEAD"),
    "ref: refs/heads/main\n"
  );
  await writeFile(
    path.join(resources.dir, ".git", "config"),
    `[core]\n\trepositoryformatversion = 0\n\tbare = false\n[remote "origin"]\n\turl = ${remote}\n${additionalConfig}`
  );
}

describe("runProbe", () => {
  it("degrades deeply nested JSON instead of traversing without a bound", async () => {
    let nested: JsonValue = "leaf";
    for (let depth = 0; depth < DEEP_JSON_DEPTH; depth += 1) {
      nested = { next: nested };
    }

    const result = await statusApi.runProbe(
      probe("deep-json", async () => ({ state: "value", value: nested }))
    );

    expect(result).toMatchObject({
      state: UNKNOWN_STATE,
      reason: "non-serializable-value",
    });
    expect(result).not.toHaveProperty("value");
  });

  it("degrades oversized JSON instead of traversing without a bound", async () => {
    const oversized = Array.from({ length: OVERSIZED_JSON_ITEMS }, () => 0);

    const result = await statusApi.runProbe(
      probe("oversized-json", async () => ({
        state: "value",
        value: oversized,
      }))
    );

    expect(result).toMatchObject({
      state: UNKNOWN_STATE,
      reason: "non-serializable-value",
    });
    expect(result).not.toHaveProperty("value");
  });

  it.each([
    { reason: "", message: GITHUB_STATUS_UNAVAILABLE },
    { reason: " \t", message: GITHUB_STATUS_UNAVAILABLE },
    { reason: NOT_AUTHENTICATED_REASON, message: "" },
    { reason: NOT_AUTHENTICATED_REASON, message: " \n" },
  ])(
    "degrades an unknown result with a blank reason or message: %o",
    async invalidUnknown => {
      const result = await statusApi.runProbe(
        probe("invalid-unknown", async () => ({
          state: UNKNOWN_STATE,
          ...invalidUnknown,
        }))
      );

      expect(result.state).toBe(UNKNOWN_STATE);
      expect(result).not.toHaveProperty("value");
      if (result.state === UNKNOWN_STATE) {
        expect(result.reason.trim()).not.toBe("");
        expect(result.message.trim()).not.toBe("");
      }
    }
  );

  it("preserves unauthenticated unknown reasons without inventing a value", async () => {
    const result = await statusApi.runProbe(
      probe(GITHUB_AUTH_PROBE_ID, async () => ({
        state: UNKNOWN_STATE,
        reason: NOT_AUTHENTICATED_REASON,
        message: GITHUB_NOT_AUTHENTICATED,
      }))
    );

    expect(result).toEqual({
      state: UNKNOWN_STATE,
      reason: NOT_AUTHENTICATED_REASON,
      message: GITHUB_NOT_AUTHENTICATED,
    });
    expect(result).not.toHaveProperty("value");
  });

  it("degrades a throwing probe to unknown with the failure reason", async () => {
    const result = await statusApi.runProbe(
      probe("throwing", async () => {
        throw new Error("credential helper crashed");
      })
    );

    expect(result.state).toBe(UNKNOWN_STATE);
    expect(result).toMatchObject({ reason: PROBE_FAILED_REASON });
    expect(result).toHaveProperty(
      "message",
      expect.stringContaining("credential helper crashed")
    );
    expect(result).not.toHaveProperty("value");
  });

  it("bounds a hanging probe and degrades it to an unknown timeout", async () => {
    const startedAt = Date.now();
    const result = await statusApi.runProbe(
      probe(
        "hanging",
        () => new Promise<ProbeResult<string>>(() => undefined),
        10
      )
    );

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(result.state).toBe(UNKNOWN_STATE);
    expect(result).toMatchObject({ reason: "timeout" });
    expect(result).toHaveProperty(
      "message",
      expect.stringMatching(/timed out/i)
    );
    expect(result).not.toHaveProperty("value");
  });

  it("aborts the running operation when its deadline expires", async () => {
    const observedAbort = vi.fn();
    const result = await statusApi.runProbe(
      probe(
        "cancellable",
        async signal =>
          await new Promise<ProbeResult<string>>(resolve => {
            signal.addEventListener(
              "abort",
              () => {
                observedAbort(signal.reason);
                resolve({
                  state: UNKNOWN_STATE,
                  reason: "cancelled",
                  message: "Probe observed cancellation",
                });
              },
              { once: true }
            );
          }),
        10
      )
    );

    expect(result).toMatchObject({
      state: UNKNOWN_STATE,
      reason: "timeout",
    });
    expect(observedAbort).toHaveBeenCalledOnce();
    expect(observedAbort.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });
});

describe("createGithubAuthProbe", () => {
  it.each([
    `https://${ENTERPRISE_HOSTNAME}/acme/widget.git`,
    `git@${ENTERPRISE_HOSTNAME}:acme/widget.git`,
  ])(
    "scopes gh authentication to the project remote host: %s",
    async remote => {
      await writeOriginRemote(remote);
      const check = vi.fn(async () => "authenticated" as const);

      await uiCmd.runProbe(uiCmd.createGithubAuthProbe(resources.dir, check));

      expect(check).toHaveBeenCalledWith(
        resources.dir,
        5_250,
        expect.any(AbortSignal),
        ENTERPRISE_HOSTNAME
      );
    }
  );

  it("normalizes a case-insensitive scp-style DNS hostname", async () => {
    await writeOriginRemote("git@GitHub.Enterprise.Example.:acme/widget.git");
    const check = vi.fn(async () => "authenticated" as const);

    await uiCmd.runProbe(uiCmd.createGithubAuthProbe(resources.dir, check));

    expect(check).toHaveBeenCalledWith(
      resources.dir,
      5_250,
      expect.any(AbortSignal),
      ENTERPRISE_HOSTNAME
    );
  });

  it("uses Git's effective URL after insteadOf rewriting", async () => {
    await writeOriginRemote(
      "gh:acme/widget.git",
      `[url "https://${ENTERPRISE_HOSTNAME}/"]\n\tinsteadOf = gh:\n`
    );
    const check = vi.fn(async () => "authenticated" as const);

    await uiCmd.runProbe(uiCmd.createGithubAuthProbe(resources.dir, check));

    expect(check).toHaveBeenCalledWith(
      resources.dir,
      5_250,
      expect.any(AbortSignal),
      ENTERPRISE_HOSTNAME
    );
  });

  it("returns a real value only after gh confirms authentication", async () => {
    await writeOriginRemote(`https://${GITHUB_HOSTNAME}/acme/widget.git`);
    const check = vi.fn(async () => "authenticated" as const);

    const result = await uiCmd.runProbe(
      uiCmd.createGithubAuthProbe(resources.dir, check)
    );

    expect(result).toEqual({ state: "value", value: true });
    expect(check).toHaveBeenCalledWith(
      resources.dir,
      5_250,
      expect.any(AbortSignal),
      GITHUB_HOSTNAME
    );
  });

  it("maps a real gh auth nonzero result to not-authenticated", async () => {
    await writeOriginRemote(`https://${GITHUB_HOSTNAME}/acme/widget.git`);
    const result = await uiCmd.runProbe(
      uiCmd.createGithubAuthProbe(
        resources.dir,
        async () => "not-authenticated"
      )
    );

    expect(result).toEqual({
      state: UNKNOWN_STATE,
      reason: NOT_AUTHENTICATED_REASON,
      message: GITHUB_NOT_AUTHENTICATED,
    });
    expect(result).not.toHaveProperty("value");
  });

  it("does not misreport a command execution failure as logged out", async () => {
    await writeOriginRemote(`https://${GITHUB_HOSTNAME}/acme/widget.git`);
    const result = await uiCmd.runProbe(
      uiCmd.createGithubAuthProbe(resources.dir, async () => {
        throw new Error("spawn gh ENOENT");
      })
    );

    expect(result).toMatchObject({
      state: UNKNOWN_STATE,
      reason: PROBE_FAILED_REASON,
      message: expect.stringContaining("ENOENT"),
    });
  });
});
