/**
 * The nightly e2e gate, truth-table **row 40**: the bypass reads the pull
 * request LIVE, and an unreadable pull request is a rejected bypass.
 *
 * Specification: `docs/nightly-e2e-gate.md` §2 (row 40), §6.3 (why the payload
 * is not the source of truth), §8 (why 1.5.0 → 1.6.0 is a minor).
 *
 * ## Why every case here runs through `runGate` rather than `evaluateBypass`
 *
 * The defect this file pins was never in the bypass *rules*. `evaluateBypass`
 * was correct the whole time and its unit tests all passed — the bug was in
 * WHERE the facts came from. `github.event.pull_request` is the payload
 * captured when the run was TRIGGERED, so a label applied afterwards is absent
 * from it and a re-run replays the same absence. Measured on two consumer
 * repositories: the label sat on the pull request while the job logged
 * `NIGHTLY_PR_LABELS: []`, and the documented remedy ("apply the label, re-run")
 * could not work.
 *
 * A test asserting that the YAML changed, or that `evaluateBypass` still
 * decides correctly, would have gone green throughout that entire period. So
 * every case below drives the whole gate with a stubbed API and a DELIBERATELY
 * STALE payload in the environment — the exact shape the bug had — and asserts
 * the verdict. The payload and the live read are made to DISAGREE on purpose;
 * that disagreement is the measurement.
 *
 * ## The two directions, and why both are here
 *
 * Reading live fixes a hole in each direction, and only testing one of them
 * would leave the gate loose:
 *
 * - a label applied after the trigger must now WAIVE (the ticket's headline);
 * - a label REMOVED after the trigger must now STOP waiving (the mirror hole —
 *   a stale payload would otherwise honour a withdrawn waiver).
 *
 * ## The vacuity guard
 *
 * A bypass that fires when the gate could not read the request is worse than
 * the bug it replaced. `pr_state_unreadable` is therefore a REJECTION, never an
 * absence and never a grant, and it never falls back to the payload — the
 * payload is the thing that was wrong.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  BRANCH,
  type Finding,
  type GateModule,
  GREEN_JOB,
  loadGateModule,
} from "../../helpers/nightly-e2e-gate-harness";

/** The bypass label, matching the gate's default. */
const LABEL = "nightly-e2e-bypass";

/** The pull request every case evaluates against. */
const PR_NUMBER = 42;

/** A maintainer who applied the label. */
const ACTOR = "maintainer";

/** A body carrying a well-formed waiver trailer. */
const TRAILER_BODY =
  "Fixes the red nightly.\nNightly-E2E-Bypass: SE-6899 harness outage\n";

/** A body carrying no waiver trailer at all. */
const BARE_BODY = "Just a normal pull request description.\n";

/** One red suite, so there is always something for a waiver to waive. */
const SUITES = JSON.stringify([
  {
    label: "maestro",
    workflow: "maestro-native-e2e.yml",
    match: { mode: "run" },
  },
]);

/** What `runGate` returns, as this suite reads it. */
interface Verdict {
  readonly verdict: string;
  readonly blocked: boolean;
  readonly findings: readonly Finding[];
  readonly bypass: {
    readonly valid: boolean;
    readonly reason: string;
    readonly ticket: string | null;
    readonly actor: string | null;
  } | null;
}

/** What the fake API should answer for one case. */
interface Scenario {
  /** Live labels on the pull request, or `null` to make the read fail. */
  readonly liveLabels: readonly string[] | null;
  /** Live body on the pull request. */
  readonly liveBody?: string;
  /** How a failed live read fails. */
  readonly liveFailure?: "404" | "403" | "no-labels-field";
  /** Whether the timeline carries a `labeled` event for the bypass label. */
  readonly labelled?: boolean;
}

/** Every URL the gate requested during a case, in order. */
let requested: string[] = [];

/**
 * A minimal `Response`, matching the shape `apiGet` consumes.
 *
 * @param status - HTTP status
 * @param body - JSON body
 * @returns A Response-shaped object
 */
function respond(status: number, body: unknown): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (): string | null => null },
    json: async (): Promise<unknown> => body,
  };
}

/**
 * Installs a fake GitHub API for one case.
 *
 * The suite half is constant across every case — one RED suite — so the only
 * thing that varies is what the pull-request read answers. That is the point:
 * every difference in outcome below is a difference in the LIVE pull request,
 * never in the evidence.
 *
 * @param scenario - What the pull-request read should answer
 */
function installApi(scenario: Scenario): void {
  requested = [];
  const appliedAt = new Date(Date.now() - 3_600_000).toISOString();
  (globalThis as { fetch: unknown }).fetch = async (
    url: string
  ): Promise<unknown> => {
    requested.push(url);

    if (url.includes(`/pulls/${PR_NUMBER}`)) {
      if (scenario.liveFailure === "404") return respond(404, {});
      if (scenario.liveFailure === "403") return respond(403, {});
      if (scenario.liveFailure === "no-labels-field") {
        return respond(200, { number: PR_NUMBER, body: scenario.liveBody });
      }
      return respond(200, {
        number: PR_NUMBER,
        body: scenario.liveBody ?? "",
        user: { login: "author" },
        labels: (scenario.liveLabels ?? []).map(name => ({ name })),
      });
    }

    if (url.includes(`/issues/${PR_NUMBER}/events`)) {
      return respond(
        200,
        scenario.labelled === false
          ? []
          : [
              {
                event: "labeled",
                label: { name: LABEL },
                actor: { login: ACTOR },
                created_at: appliedAt,
              },
            ]
      );
    }

    if (url.includes("/collaborators/")) {
      return respond(200, { role_name: "maintain" });
    }

    if (url.includes("/artifacts")) return respond(200, { artifacts: [] });
    if (url.includes("/jobs")) return respond(200, { jobs: [GREEN_JOB] });

    // The suite's run history: one fresh RED run on the required branch.
    return respond(200, {
      workflow_runs: [
        {
          id: 7,
          conclusion: "failure",
          created_at: new Date(Date.now() - 3_600_000).toISOString(),
          html_url: "https://example.test/run/7",
          event: "schedule",
          head_branch: BRANCH,
        },
      ],
    });
  };
}

/**
 * The environment as the reusable workflow sets it.
 *
 * `payloadLabels` and `payloadBody` are the FROZEN event payload — the thing
 * the gate used to decide on. Every case sets them to disagree with the live
 * pull request, because agreement is the one case that could never have caught
 * this.
 *
 * @param payloadLabels - `github.event.pull_request.labels.*.name`, as JSON
 * @param payloadBody - `github.event.pull_request.body`
 * @param withPr - Whether there is a pull request at all
 * @returns The environment for `runGate`
 */
function env(
  payloadLabels: string,
  payloadBody: string,
  withPr = true
): Record<string, string | undefined> {
  return {
    GITHUB_TOKEN: "t",
    GITHUB_REPOSITORY: "o/r",
    NIGHTLY_BRANCH: BRANCH,
    NIGHTLY_SUITES: SUITES,
    ...(withPr
      ? {
          NIGHTLY_PR_NUMBER: String(PR_NUMBER),
          NIGHTLY_PR_AUTHOR: "author",
          NIGHTLY_PR_BODY: payloadBody,
          NIGHTLY_PR_LABELS: payloadLabels,
        }
      : {}),
  };
}

describe("nightly e2e gate — row 40: the bypass reads the pull request LIVE", () => {
  let mod: GateModule;

  beforeAll(async () => {
    mod = await loadGateModule();
  });

  beforeEach(() => {
    requested = [];
  });

  /**
   * Runs the gate for one case.
   *
   * @param scenario - What the fake API answers
   * @param environment - The (stale) payload environment
   * @returns The verdict
   */
  async function gate(
    scenario: Scenario,
    environment: Record<string, string | undefined>
  ): Promise<Verdict> {
    installApi(scenario);
    return (await mod.runGate(environment, async () => undefined)) as Verdict;
  }

  it("the red suite alone blocks, so every waiver below has something to waive", async () => {
    const verdict = await gate(
      { liveLabels: [], liveBody: BARE_BODY },
      env("[]", BARE_BODY)
    );
    expect(verdict.findings[0]?.state).toBe("fail");
    expect(verdict.blocked).toBe(true);
  });

  describe("a label applied AFTER the run was triggered", () => {
    it("waives the gate even though the frozen payload reported no labels", async () => {
      // THE TICKET, reproduced. The payload is `[]` — precisely what the two
      // measured consumer repositories logged — while the label is on the pull
      // request. Before the live read this returned `fail`, which is what sent
      // people to an unaudited admin merge.
      const verdict = await gate(
        { liveLabels: [LABEL], liveBody: TRAILER_BODY },
        env("[]", "")
      );

      expect(verdict.verdict).toBe("bypassed");
      expect(verdict.blocked).toBe(false);
      expect(verdict.bypass?.valid).toBe(true);
      expect(verdict.bypass?.ticket).toBe("SE-6899");
      expect(verdict.bypass?.actor).toBe(ACTOR);
    });

    it("honours a trailer added to the body after the trigger, too", async () => {
      // The body is half of the same frozen object and had the identical
      // defect: editing the PR body to add the trailer changed nothing a
      // re-run could see. Here the payload carries the label but an EMPTY
      // body, so only a live body read can produce a waiver.
      const verdict = await gate(
        { liveLabels: [LABEL], liveBody: TRAILER_BODY },
        env(JSON.stringify([LABEL]), "")
      );

      expect(verdict.verdict).toBe("bypassed");
      expect(verdict.bypass?.ticket).toBe("SE-6899");
    });

    it("reads the pull request from the API, not from the environment", async () => {
      await gate(
        { liveLabels: [LABEL], liveBody: TRAILER_BODY },
        env("[]", "")
      );
      expect(requested.some(url => url.includes(`/pulls/${PR_NUMBER}`))).toBe(
        true
      );
    });
  });

  describe("negative controls — the fix must not become a hole", () => {
    it("a pull request with NO bypass label is still gated", async () => {
      const verdict = await gate(
        { liveLabels: [], liveBody: TRAILER_BODY },
        env("[]", TRAILER_BODY)
      );

      expect(verdict.verdict).toBe("fail");
      expect(verdict.blocked).toBe(true);
      // Nobody asked for a waiver, so there is nothing to report — an inert
      // rejection on every red PR would be noise.
      expect(verdict.bypass).toBeNull();
    });

    it("a label REMOVED since the trigger stops waiving, though the payload still carries it", async () => {
      // The mirror hole, and the reason reading live is not merely more
      // convenient. A stale payload would honour a waiver its maintainer had
      // already withdrawn — the gate reporting green on the strength of a
      // label that is no longer there.
      const verdict = await gate(
        { liveLabels: [], liveBody: TRAILER_BODY },
        env(JSON.stringify([LABEL]), TRAILER_BODY)
      );

      expect(verdict.verdict).toBe("fail");
      expect(verdict.blocked).toBe(true);
      expect(verdict.bypass).toBeNull();
    });

    it("a bare label whose LIVE body has no trailer is rejected, not honoured", async () => {
      // Since the 2026-08-19 self-service amendment the trailer is the only
      // thing between a bare label and a waiver, so it has to be read from the
      // same live source as the label. A payload body carrying the trailer
      // must not rescue a body that no longer does.
      const verdict = await gate(
        { liveLabels: [LABEL], liveBody: BARE_BODY },
        env(JSON.stringify([LABEL]), TRAILER_BODY)
      );

      expect(verdict.verdict).toBe("fail");
      expect(verdict.blocked).toBe(true);
      expect(verdict.bypass?.valid).toBe(false);
      expect(verdict.bypass?.reason).toBe("no_reason_or_ticket");
    });

    it("a green suite is not turned red by any of this", async () => {
      installApi({ liveLabels: [LABEL], liveBody: TRAILER_BODY });
      (globalThis as { fetch: unknown }).fetch = async (
        url: string
      ): Promise<unknown> => {
        if (url.includes("/artifacts")) return respond(200, { artifacts: [] });
        if (url.includes("/jobs")) return respond(200, { jobs: [GREEN_JOB] });
        if (url.includes(`/issues/${PR_NUMBER}/events`)) {
          return respond(200, []);
        }
        if (url.includes(`/pulls/${PR_NUMBER}`)) {
          return respond(200, {
            number: PR_NUMBER,
            body: TRAILER_BODY,
            user: { login: "author" },
            labels: [{ name: LABEL }],
          });
        }
        return respond(200, {
          workflow_runs: [
            {
              id: 8,
              conclusion: "success",
              created_at: new Date(Date.now() - 3_600_000).toISOString(),
              event: "schedule",
              head_branch: BRANCH,
            },
          ],
        });
      };

      const verdict = (await mod.runGate(
        env(JSON.stringify([LABEL]), TRAILER_BODY),
        async () => undefined
      )) as Verdict;

      // A stale label on a green PR waived nothing; the verdict says `pass`
      // rather than pretending the label did something.
      expect(verdict.verdict).toBe("pass");
      expect(verdict.blocked).toBe(false);
      expect(verdict.bypass).toBeNull();
    });

    it("no pull request means no live read and no bypass", async () => {
      const verdict = await gate(
        { liveLabels: [LABEL], liveBody: TRAILER_BODY },
        env("[]", "", false)
      );

      expect(verdict.blocked).toBe(true);
      expect(verdict.bypass).toBeNull();
      // A `workflow_dispatch` or `schedule` run has no pull request to read,
      // and must not spend a request finding that out.
      expect(requested.some(url => url.includes("/pulls/"))).toBe(false);
    });
  });

  describe("the vacuity guard — an unreadable pull request never waives", () => {
    // Each case gives the FROZEN payload a complete, valid waiver, so anything
    // that falls back to it grants a bypass. That is the failure mode being
    // pinned: the gate must stay closed on facts it could not read.
    const staleValidPayload = (): Record<string, string | undefined> =>
      env(JSON.stringify([LABEL]), TRAILER_BODY);

    it("a 404 on the pull request rejects the bypass", async () => {
      const verdict = await gate(
        { liveLabels: null, liveFailure: "404" },
        staleValidPayload()
      );

      expect(verdict.verdict).toBe("fail");
      expect(verdict.blocked).toBe(true);
      expect(verdict.bypass?.valid).toBe(false);
      expect(verdict.bypass?.reason).toBe("pr_state_unreadable");
    });

    it("a 403 — the missing `pull-requests: read` scope — rejects the bypass", async () => {
      const verdict = await gate(
        { liveLabels: null, liveFailure: "403" },
        staleValidPayload()
      );

      expect(verdict.blocked).toBe(true);
      expect(verdict.bypass?.reason).toBe("pr_state_unreadable");
    });

    it("a response with no `labels` field is UNREADABLE, not 'no labels'", async () => {
      // The two must not collapse. One is a broken read and the other is a
      // fact about the pull request; only the second is safe to act on.
      const verdict = await gate(
        {
          liveLabels: null,
          liveFailure: "no-labels-field",
          liveBody: TRAILER_BODY,
        },
        staleValidPayload()
      );

      expect(verdict.blocked).toBe(true);
      expect(verdict.bypass?.reason).toBe("pr_state_unreadable");
    });

    it("the report says the bypass could not be EVALUATED, not that a label was rejected", async () => {
      // The usual rejection line asserts a label is present. When the read
      // failed that is precisely the unanswered question, and telling a reader
      // to remove a label that may not exist sends them nowhere.
      const verdict = await gate(
        { liveLabels: null, liveFailure: "404" },
        staleValidPayload()
      );
      const report = mod.formatReport(verdict as never, {
        branch: BRANCH,
        bypassLabel: LABEL,
      });

      expect(report).toContain("The bypass could not be evaluated");
      expect(report).toContain("pull-requests: read");
      expect(report).not.toContain("label is present but was REJECTED");
    });
  });

  it("ships as contract 1.6.0 or later", () => {
    // Row 40 changes where the bypass gets its facts, which §8 argues is a
    // MINOR: the workflow half carries no §2 logic, so neither skew direction
    // can run a looser contract than either half intends. A test pins the
    // floor so the row and the version cannot ship apart.
    const [major, minor] =
      mod.NIGHTLY_E2E_CONTRACT_VERSION.split(".").map(Number);
    expect(major).toBe(1);
    expect(minor).toBeGreaterThanOrEqual(6);
  });
});
