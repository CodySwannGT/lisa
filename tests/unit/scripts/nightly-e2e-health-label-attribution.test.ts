/**
 * Who applied the bypass label — attribution on a real, busy pull request.
 *
 * Split from the API suite so both stay inside the file-length budget. The
 * behaviour here is the difference between a bypass contract that works on the
 * pull requests that actually need one and a contract that only works on toy
 * PRs: the issue-events API returns events OLDEST-FIRST, so the label
 * application on a long-lived branch is not on page 1.
 *
 * Specification: `docs/nightly-e2e-gate.md` §6.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  type GateModule,
  TEST_API,
  fakeResponse,
  loadGateModule,
  noWait,
} from "../../helpers/nightly-e2e-gate-harness";

/**
 * Installs a stub `fetch`.
 *
 * Declared here rather than in the harness: a call counter is inherently
 * stateful, and `tests/helpers/**` is held to the functional-purity rules.
 *
 * @param responder - Produces a response, or an Error to throw, per attempt
 * @returns A reader for how many times fetch has been called so far
 */
function stubFetch(responder: (attempt: number) => unknown): {
  calls: () => number;
} {
  let attempts = 0;
  const stub = async (): Promise<unknown> => {
    attempts += 1;
    const result = responder(attempts);
    if (result instanceof Error) throw result;
    return result;
  };
  (globalThis as { fetch: unknown }).fetch = stub;
  return { calls: () => attempts };
}

const LABEL = "nightly-e2e-bypass";
/** When the label was applied, in every case below. */
const APPLIED_AT = "2026-08-12T09:00:00Z";

describe("bypass label attribution", () => {
  let mod: GateModule;

  beforeAll(async () => {
    mod = await loadGateModule();
  });

  describe("attributing the bypass label on a busy pull request", () => {
    // The issue-events API returns events OLDEST-FIRST. On a long-lived PR —
    // exactly the sort that ends up needing a bypass — page 1 holds the oldest
    // hundred events and the label application is on a later page. Reading only
    // page 1 rejects a valid maintainer bypass as `no_attributable_actor`:
    // fail-closed, but for the wrong stated reason, which is its own kind of
    // untrustworthy gate.

    /**
     * A page of filler events that are not the one we are looking for.
     *
     * @param count - How many
     * @returns Filler events
     */
    const filler = (count: number): unknown[] =>
      Array.from({ length: count }, () => ({
        event: "commented",
        created_at: "2026-08-01T00:00:00Z",
      }));

    it("finds a label event that falls beyond the first page", async () => {
      const pages: Record<string, unknown[]> = {
        "1": filler(100),
        "2": [
          ...filler(3),
          {
            event: "labeled",
            label: { name: LABEL },
            actor: { login: "maintainer" },
            created_at: APPLIED_AT,
          },
        ],
      };
      let call = 0;
      stubFetch(() => {
        call += 1;
        return fakeResponse(200, {}, pages[String(call)] ?? []);
      });

      await expect(
        mod.fetchLabelEvent(TEST_API, 123, LABEL, noWait)
      ).resolves.toEqual({
        actor: "maintainer",
        createdAt: APPLIED_AT,
      });
    });

    it("attributes a re-applied label to whoever applied it LAST", async () => {
      stubFetch(() =>
        fakeResponse(200, {}, [
          {
            event: "labeled",
            label: { name: LABEL },
            actor: { login: "first" },
            created_at: "2026-08-11T09:00:00Z",
          },
          {
            event: "labeled",
            label: { name: LABEL },
            actor: { login: "second" },
            created_at: APPLIED_AT,
          },
        ])
      );

      await expect(
        mod.fetchLabelEvent(TEST_API, 123, LABEL, noWait)
      ).resolves.toMatchObject({ actor: "second" });
    });

    it("ignores a different label's events entirely", async () => {
      stubFetch(() =>
        fakeResponse(200, {}, [
          {
            event: "labeled",
            label: { name: "some-other-label" },
            actor: { login: "someone" },
            created_at: APPLIED_AT,
          },
        ])
      );

      await expect(
        mod.fetchLabelEvent(TEST_API, 123, LABEL, noWait)
      ).resolves.toBeNull();
    });
  });
});
