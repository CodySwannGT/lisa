/**
 * Pinning the tracking issue — contract §10.8.
 *
 * A tracking issue is only useful if somebody sees it, and a repository's issue
 * list is not somewhere people look unprompted. Pinning puts the red suite at
 * the top of the tab. Three consumers built this independently, which is the
 * signal that the reporter was missing it rather than that they were gilding.
 *
 * Two properties carry the weight here, and both are about NOT failing:
 *
 *   1. **Unpinning on green.** A pin that survives the recovery is how a pin
 *      board stops meaning anything — after two of those, nobody reads the
 *      pinned issues either, and the capability has made things worse than not
 *      having it.
 *   2. **A full pin board is not an error.** GitHub allows three pinned issues
 *      per repository. A fourth red suite in a repo with three pins is an
 *      ordinary Tuesday, and it says nothing about whether the tracking issue
 *      itself was written correctly. If that reddened the report job, operators
 *      would learn to ignore the report job — trading a decoration for the
 *      alarm.
 *
 * Note the protocol trap this file exists to pin: a GraphQL error arrives as
 * **HTTP 200 with an `errors` array**, not as a failing status. Checking
 * `response.ok` reads the pin limit as a success and reports a pin that never
 * happened — a vacuous green in the smallest possible surface.
 *
 * Specification: `docs/nightly-e2e-gate.md` §10.8.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  BRANCH,
  type Finding,
  GATE_CONTEXT,
  type GateModule,
  NOW,
  REASON,
  REQUIRED_STATE,
  STATE,
  TEST_API,
  fakeResponse,
  loadGateModule,
  noWait,
} from "../../helpers/nightly-e2e-gate-harness";

/** The suite every case speaks about. */
const LABEL = "Maestro native e2e";

/** The issue's GraphQL node id — pinning addresses issues by node, not number. */
const NODE = "I_kwDOABCD123";

/** API coordinates carrying a GraphQL endpoint. */
const PIN_API = Object.freeze({
  ...TEST_API,
  graphqlUrl: "https://api.test/graphql",
});

/**
 * A red finding.
 *
 * @param overrides - Field overrides
 * @returns A finding
 */
function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    label: LABEL,
    state: STATE.fail,
    reason: REASON.runConclusion,
    conclusion: "failure",
    url: "https://example.test/run/1",
    ...overrides,
  } as Finding;
}

/**
 * Reporting context.
 *
 * @param pinIssues - Whether pinning is switched on
 * @returns A context `planIssueActions` accepts
 */
function context(pinIssues: boolean): Record<string, unknown> {
  return {
    branch: BRANCH,
    label: "nightly-e2e",
    now: NOW,
    gateContext: GATE_CONTEXT,
    bypassLabel: "nightly-e2e-bypass",
    requiredness: {
      state: REQUIRED_STATE.required,
      detail: null,
      contexts: [],
    },
    pinIssues,
  };
}

describe("nightly e2e reporting — §10.8, pinning", () => {
  let mod: GateModule;

  beforeAll(async () => {
    mod = await loadGateModule();
  });

  describe("the plan", () => {
    it("BITE: pinning OFF plans NO pin at all — `null`, never `false`", () => {
      // The default, and the property that makes this opt-in real. `null` means
      // "do not touch the pin"; `false` would actively UNPIN, which would rip
      // down a pin somebody set by hand in a repo that never asked for this.
      const plan = mod.planIssueActions([finding()], [], context(false));
      expect(plan[0]?.pin).toBeNull();
      const green = mod.planIssueActions(
        [finding({ state: STATE.pass, conclusion: "success" })],
        [{ number: 41, body: String(plan[0]?.body), node_id: NODE }],
        context(false)
      );
      expect(green[0]?.action).toBe("close");
      expect(green[0]?.pin).toBeNull();
    });

    it("pinning ON pins a newly filed issue and a refreshed one", () => {
      const filed = mod.planIssueActions([finding()], [], context(true));
      expect(filed[0]?.pin).toBe(true);
      const refreshed = mod.planIssueActions(
        [finding()],
        [{ number: 41, body: String(filed[0]?.body), node_id: NODE }],
        context(true)
      );
      expect(refreshed[0]?.action).toBe("refresh");
      expect(refreshed[0]?.pin).toBe(true);
      // Carried as a node id, because that is what GraphQL addresses.
      expect(refreshed[0]?.nodeIds).toEqual([NODE]);
    });

    it("BITE: green UNPINS — the pin does not outlive the failure", () => {
      const seed = mod.planIssueActions([finding()], [], context(true));
      const green = mod.planIssueActions(
        [finding({ state: STATE.pass, conclusion: "success" })],
        [{ number: 41, body: String(seed[0]?.body), node_id: NODE }],
        context(true)
      );
      expect(green[0]?.action).toBe("close");
      expect(green[0]?.pin).toBe(false);
      expect(green[0]?.nodeIds).toEqual([NODE]);
    });

    it("a suite left alone is never pinned or unpinned", () => {
      // Row 30: evidence the suite never gathered decides nothing — including
      // nothing about the pin board.
      const plan = mod.planIssueActions(
        [finding({ state: STATE.unknown, reason: REASON.noRun })],
        [],
        context(true)
      );
      expect(plan[0]?.action).toBe("none");
      expect(plan[0]?.pin).toBeNull();
    });
  });

  describe("the mutation", () => {
    it("sends `pinIssue` / `unpinIssue` against the GraphQL endpoint", async () => {
      const sent: { url: string; body: string }[] = [];
      (globalThis as { fetch: unknown }).fetch = async (
        url: string,
        init?: { body?: string }
      ): Promise<unknown> => {
        sent.push({ url: String(url), body: String(init?.body) });
        return fakeResponse(200, {}, { data: { pinIssue: { issue: {} } } });
      };
      await mod.setIssuePin(PIN_API, NODE, true);
      await mod.setIssuePin(PIN_API, NODE, false);
      expect(sent[0]?.url).toBe("https://api.test/graphql");
      expect(sent[0]?.body).toContain("pinIssue(input: {issueId: $id})");
      expect(sent[1]?.body).toContain("unpinIssue(input: {issueId: $id})");
      expect(JSON.parse(sent[0]?.body ?? "{}").variables.id).toBe(NODE);
    });

    it("BITE: the 3-pin limit WARNS — HTTP 200 with an `errors` array is a failure", async () => {
      // The protocol trap. `response.ok` is TRUE here; a guard that trusted it
      // would report a pin that never happened.
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> =>
        fakeResponse(
          200,
          {},
          {
            errors: [
              { message: "You have reached the limit of pinned issues" },
            ],
          }
        );
      const outcome = await mod.setIssuePin(PIN_API, NODE, true);
      expect(outcome.ok).toBe(false);
      expect(outcome.warning).toContain("limit of pinned issues");
      // And it explains the limit, because "refused" alone sends somebody to
      // debug a permissions problem they do not have.
      expect(outcome.warning).toContain("at most 3 pinned issues");
    });

    it("never throws — an HTTP failure, a network error and a missing node id all warn", async () => {
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> =>
        fakeResponse(500, {}, {});
      await expect(mod.setIssuePin(PIN_API, NODE, true)).resolves.toMatchObject(
        { ok: false }
      );
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> => {
        throw new Error("ECONNRESET");
      };
      const network = await mod.setIssuePin(PIN_API, NODE, true);
      expect(network.ok).toBe(false);
      expect(network.warning).toContain("ECONNRESET");
      const missing = await mod.setIssuePin(PIN_API, "", true);
      expect(missing.ok).toBe(false);
      expect(missing.warning).toContain("no GraphQL node id");
    });
  });

  describe("applying it", () => {
    it("BITE: a refused pin does NOT fail the tracking issue it decorates", async () => {
      // The property that keeps a full pin board from reddening the report job
      // every night. `ok` answers "was the tracking issue written" — which it
      // was — and the pin is a warning beside it, not folded into the verdict.
      const plan = mod.planIssueActions([finding()], [], context(true));
      (globalThis as { fetch: unknown }).fetch = async (
        url: string
      ): Promise<unknown> =>
        String(url).endsWith("/graphql")
          ? fakeResponse(
              200,
              {},
              {
                errors: [
                  { message: "You have reached the limit of pinned issues" },
                ],
              }
            )
          : fakeResponse(201, {}, { number: 7, node_id: NODE });
      const [result] = await mod.applyIssuePlan(PIN_API, plan, noWait);
      expect(result?.ok).toBe(true);
      expect(result?.error).toBeNull();
      expect(result?.issues).toEqual([7]);
      expect(result?.warnings?.[0]).toContain("limit of pinned issues");
      // And the log shows it without turning the line's marker red.
      const log = mod.formatIssueReport([result!], { branch: BRANCH });
      expect(log).toContain("📌");
      expect(log).toContain("✅ **Maestro native e2e**");
    });

    it("BITE: pinning OFF issues no GraphQL request whatsoever", async () => {
      // Opt-in has to mean opt-in at the wire, not merely at the plan. A
      // capability that quietly called GraphQL for every adopter would be
      // spending somebody's rate limit on a feature they declined.
      const plan = mod.planIssueActions([finding()], [], context(false));
      const urls: string[] = [];
      (globalThis as { fetch: unknown }).fetch = async (
        url: string
      ): Promise<unknown> => {
        urls.push(String(url));
        return fakeResponse(201, {}, { number: 7, node_id: NODE });
      };
      await mod.applyIssuePlan(PIN_API, plan, noWait);
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.some(url => url.endsWith("/graphql"))).toBe(false);
    });

    it("unpins BEFORE closing, so the pin board is never advertising a closed issue", async () => {
      const seed = mod.planIssueActions([finding()], [], context(true));
      const plan = mod.planIssueActions(
        [finding({ state: STATE.pass, conclusion: "success" })],
        [{ number: 41, body: String(seed[0]?.body), node_id: NODE }],
        context(true)
      );
      const order: string[] = [];
      (globalThis as { fetch: unknown }).fetch = async (
        url: string,
        init?: { body?: string }
      ): Promise<unknown> => {
        if (String(url).endsWith("/graphql")) {
          order.push("unpin");
          return fakeResponse(200, {}, { data: {} });
        }
        order.push(
          String(init?.body).includes('"state":"closed"') ? "close" : "comment"
        );
        return fakeResponse(200, {}, { number: 41 });
      };
      await mod.applyIssuePlan(PIN_API, plan, noWait);
      expect(order.indexOf("unpin")).toBeLessThan(order.indexOf("close"));
    });
  });
});
