import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUi, type UiCmdOptions } from "../../../src/cli/ui-cmd.js";
import type { StarterLandingResult } from "../../../src/cli/starter-sync-command.js";

const resources: { dir: string; server?: Server } = { dir: "" };
const current: StarterLandingResult = { state: "current", results: [] };

beforeEach(async () => {
  resources.dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-starter-sync-"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(async () => {
  resources.server?.closeAllConnections();
  if (resources.server)
    await new Promise(resolve => resources.server?.close(resolve));
  delete resources.server;
  await rm(resources.dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/**
 * Start the real console router with only its landing operation injected.
 * @param run - Landing operation.
 * @param options - Trusted server startup inputs.
 * @returns Bound console origin and endpoint.
 */
async function start(
  run: () => Promise<StarterLandingResult>,
  options: UiCmdOptions = {}
) {
  resources.server = await runUi(
    resources.dir,
    { port: "0", sync: false, ...options },
    {
      probes: [],
      starterSync: { run },
    }
  );
  const address = resources.server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  const origin = `http://127.0.0.1:${address.port}`;
  return { origin, url: `${origin}/api/starter-sync` };
}

describe("console starter sync", () => {
  it.each([
    current,
    { state: "committed", commit: "abc123", results: [] },
    {
      state: "pull-request",
      url: "https://github.com/CodySwannGT/lisa/pull/42",
      results: [],
    },
  ] as const)(
    "returns the actual $state outcome from the bound project",
    async outcome => {
      const run = vi.fn(async () => outcome);
      const { origin, url } = await start(run);
      const response = await fetch(`${url}?path=/other`, {
        method: "POST",
        headers: { origin },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual(outcome);
      expect(run).toHaveBeenCalledWith({ path: resources.dir });
    }
  );

  it("uses server attribution and ignores attribution or destination supplied by the browser", async () => {
    const run = vi.fn(async () => current);
    const attribution = {
      workItem: "CodySwannGT/lisa#1534",
      coAuthor: "Codex <codex@openai.com>",
    };
    const { origin, url } = await start(run, attribution);
    const response = await fetch(url, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        path: "/another-project",
        workItem: "forged",
        coAuthor: "forged",
      }),
    });
    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith({ path: resources.dir, ...attribution });
  });

  it("rejects other origins and read methods without running a sync", async () => {
    const run = vi.fn(async () => current);
    const { origin, url } = await start(run);
    for (const invalid of [
      undefined,
      "null",
      "https://attacker.example",
      `${origin}/`,
      "http://127.0.0.1:1",
    ]) {
      const response = await fetch(url, {
        method: "POST",
        headers: invalid ? { origin: invalid } : {},
      });
      expect(response.status).toBe(403);
    }
    for (const method of ["GET", "HEAD", "PUT", "DELETE"]) {
      const response = await fetch(url, { method, headers: { origin } });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("reports a real failure and allows a later retry", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("Starter ref is not resolvable"))
      .mockResolvedValueOnce(current);
    const { origin, url } = await start(run);
    const failed = await fetch(url, { method: "POST", headers: { origin } });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      state: "failed",
      error: "Starter ref is not resolvable",
    });
    const retry = await fetch(url, { method: "POST", headers: { origin } });
    expect(await retry.json()).toEqual(current);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("refuses an overlapping mutation while the first sync is running", async () => {
    let release!: (result: StarterLandingResult) => void;
    const pending = new Promise<StarterLandingResult>(resolve => {
      release = resolve;
    });
    const run = vi.fn(async () => pending);
    const { origin, url } = await start(run);
    const first = fetch(url, { method: "POST", headers: { origin } });
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    try {
      const second = await fetch(url, { method: "POST", headers: { origin } });
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({
        state: "failed",
        error: expect.stringContaining("already running"),
      });
      expect(run).toHaveBeenCalledOnce();
    } finally {
      release(current);
    }
    expect((await first).status).toBe(200);
  });
});
