/** RED transport deadline contract for every nightly provider request. */
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const MODULE_REL =
  "typescript/copy-overwrite/scripts/nightly-e2e-provider-support.mjs";

/** Public fetch transport exported by the installed support module. */
interface ProviderSupportModule {
  fetchJson(request: {
    readonly url: string;
    readonly options?: Readonly<Record<string, unknown>>;
  }): Promise<unknown>;
}

/**
 * Load the production support module without an executable side effect.
 * @returns Isolated support-module exports
 */
async function loadSupport(): Promise<ProviderSupportModule> {
  const url = pathToFileURL(path.resolve(MODULE_REL));
  url.searchParams.set("review", randomUUID());
  return (await import(url.href)) as ProviderSupportModule;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("nightly provider transport deadline", () => {
  it("attaches one exact thirty-second abort signal to the fetch", async () => {
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ accepted: true }),
    }));
    vi.stubGlobal("fetch", fetch);
    const support = await loadSupport();

    await expect(
      support.fetchJson({
        url: "https://provider.test/items",
        options: { method: "GET" },
      })
    ).resolves.toEqual({ accepted: true });
    expect(timeout).toHaveBeenCalledOnce();
    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(fetch).toHaveBeenCalledWith("https://provider.test/items", {
      method: "GET",
      signal,
    });
  });
});
