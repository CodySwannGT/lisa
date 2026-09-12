/**
 * §6.4 — a waiver leaves a DURABLE record, and its verdict is RE-DERIVED.
 *
 * Two defects, and they are one defect seen from two ends.
 *
 * ## The verdict was replayed
 *
 * The merge consumes a STORED check run. Between the last evaluation and the
 * merge, `bypassed` is a record of the past — and a waiver is mutable
 * pull-request state a human can edit. Row 40 (`nightly-e2e-health-live-labels`)
 * already made the GATE read live, and #3708 made more events re-run it, but
 * both are about the moment the gate RUNS. Neither says anything about the
 * moment the merge HAPPENS.
 *
 * The transition that makes the difference measurable is EXPIRY, and it is the
 * only one that fires no event at all. Applying the label, removing it, editing
 * the body — each produces a pull-request activity the caller subscribes to, so
 * re-running the gate sees them. A waiver that simply runs out of hours
 * produces nothing: no event, no re-run, and a stored `bypassed` that goes on
 * saying `bypassed`. That is why the headline case below moves ONLY the clock.
 * The pull request is byte-identical across the two derivations and the answer
 * flips, which is the property a replay cannot have.
 *
 * ## The waiver left no record
 *
 * The label is the only repository-wide index of "which merges went past this
 * gate on a waiver", and the reaper strips it on close — correctly, because the
 * label is a REQUEST. Stripping it also erases the INDEX. So the record is
 * asserted here against the state that matters: it must still name the ticket
 * and the reason for a waiver that has EXPIRED, and it must be findable by a
 * marker the reaper never touches.
 *
 * ## What these cases refuse to prove by construction
 *
 * Not one case asserts that `evaluateBypass` decides correctly — that is
 * `nightly-e2e-health-bypass`'s job, and a suite that re-asserted it here would
 * go green for the wrong reason. Every case drives `runWaiverVerdict`, which is
 * the whole path a merge would consult, against a stubbed API.
 *
 * Specification: `docs/nightly-e2e-gate.md` §6.4.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  type GateModule,
  loadGateModule,
} from "../../helpers/nightly-e2e-gate-harness.js";
import type { WaiverVerdict } from "../../helpers/nightly-e2e-waiver-harness.js";

/** The bypass label, matching the gate's default. */
const LABEL = "nightly-e2e-bypass";

/** The pull request every case re-derives against. */
const PR_NUMBER = 4207;

/** The maintainer who applied the label. */
const ACTOR = "maintainer";

/** When the label went on. Every case keeps this fixed and moves `now`. */
const APPLIED_AT = "2026-08-12T06:00:00Z";

/** Three hours after the label went on — inside a 24-hour waiver. */
const INSIDE_WINDOW = new Date("2026-08-12T09:00:00Z");

/** Two days after the label went on — outside it, with nothing else changed. */
const OUTSIDE_WINDOW = new Date("2026-08-14T09:00:00Z");

/** A body carrying a well-formed waiver trailer. */
const TRAILER_BODY =
  "Fixes the red nightly.\nNightly-E2E-Bypass: #3709 device farm outage\n";

/** What the fake API should answer for one case. */
interface Scenario {
  /** Live labels on the pull request, or `null` to make the read fail. */
  readonly liveLabels: readonly string[] | null;
  /** Live body on the pull request. */
  readonly liveBody?: string;
  /** The applying actor's repository permission. */
  readonly permission?: string;
}

/** Every URL the re-derivation requested, in order. */
let requested: string[] = [];

let mod: GateModule;

beforeAll(async () => {
  mod = await loadGateModule();
});

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
 * There is no suite table and no run history here on purpose: the merge-time
 * question is "is the waiver still good?", never "is the nightly green?". A
 * re-derivation that needed the suite table could not run from the one place
 * that most needs it — a merge driver holding a pull request number and a token.
 *
 * @param scenario - What the pull-request read should answer
 */
function installApi(scenario: Scenario): void {
  requested = [];
  (globalThis as { fetch: unknown }).fetch = async (
    url: string
  ): Promise<unknown> => {
    requested.push(url);

    if (url.includes(`/pulls/${PR_NUMBER}`)) {
      if (scenario.liveLabels === null) return respond(404, {});
      return respond(200, {
        number: PR_NUMBER,
        body: scenario.liveBody ?? TRAILER_BODY,
        user: { login: "author" },
        labels: scenario.liveLabels.map(name => ({ name })),
      });
    }

    if (url.includes(`/issues/${PR_NUMBER}/events`)) {
      return respond(200, [
        {
          event: "labeled",
          label: { name: LABEL },
          actor: { login: ACTOR },
          created_at: APPLIED_AT,
        },
      ]);
    }

    if (url.includes("/collaborators/")) {
      return respond(200, { role_name: scenario.permission ?? "maintain" });
    }

    throw new Error(`unexpected request: ${url}`);
  };
}

/**
 * The environment a merge driver would supply.
 *
 * @returns The environment for `runWaiverVerdict`
 */
function env(): Record<string, string | undefined> {
  return {
    GITHUB_TOKEN: "t",
    GITHUB_REPOSITORY: "o/r",
    NIGHTLY_PR_NUMBER: String(PR_NUMBER),
    NIGHTLY_BYPASS_LABEL: LABEL,
    NIGHTLY_BYPASS_MAX_HOURS: "24",
  };
}

/**
 * Re-derives the waiver at one instant.
 *
 * @param at - The moment of asking
 * @returns The verdict
 */
async function deriveAt(at: Date): Promise<WaiverVerdict> {
  vi.setSystemTime(at);
  return await mod.runWaiverVerdict(env(), async () => undefined);
}

/**
 * Runs the CLI arm with the environment a merge driver would have exported.
 *
 * `waiverVerdict` reads `process.env` rather than taking an environment, which
 * is what makes it the CLI arm — so the only honest way to exercise the exit
 * code is to give the process that environment and take it away again.
 *
 * @param at - The moment of asking
 * @returns The exit code the CLI left behind
 */
async function runCliAt(at: Date): Promise<number | string | undefined> {
  const applied = env();
  for (const [key, value] of Object.entries(applied)) {
    process.env[key] = value;
  }
  vi.setSystemTime(at);
  process.exitCode = 0;
  try {
    await mod.waiverVerdict(true);
    return process.exitCode;
  } finally {
    for (const key of Object.keys(applied)) delete process.env[key];
    process.exitCode = 0;
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  process.exitCode = 0;
});

describe("the merge-time verdict is re-derived, never replayed", () => {
  it("waives a merge on a waiver that is still valid at the moment of asking", async () => {
    installApi({ liveLabels: [LABEL] });

    const verdict = await deriveAt(INSIDE_WINDOW);

    // The regression fence. A change that makes a genuine waiver harder to
    // honour has broken the escape hatch rather than secured it: the whole
    // point of an audited bypass is that it works when a suite is red for a
    // reason nobody can fix in the moment.
    expect(verdict.state).toBe(mod.WAIVER_STATES.waived);
    expect(verdict.waiver?.valid).toBe(true);
    expect(verdict.trailer?.ticket).toBe("#3709");
  });

  it("refuses the same pull request once the waiver has expired, with nothing changed but the clock", async () => {
    installApi({ liveLabels: [LABEL] });
    const granted = await deriveAt(INSIDE_WINDOW);
    const asked = [...requested];

    installApi({ liveLabels: [LABEL] });
    const later = await deriveAt(OUTSIDE_WINDOW);

    // The measurement. Same label, same body, same actor, same permission —
    // the fixture is byte-identical and the API was asked the same questions in
    // the same order. Only `now` moved. A replayed verdict cannot produce this
    // difference, because expiry is the one waiver transition that fires no
    // event for anything to replay.
    expect(requested).toEqual(asked);
    expect(granted.state).toBe(mod.WAIVER_STATES.waived);
    expect(later.state).toBe(mod.WAIVER_STATES.refused);
    expect(later.waiver?.reason).toBe("bypass_expired");
  });

  it("names the waiver, what it covered, and the remedy when it refuses", async () => {
    installApi({ liveLabels: [LABEL] });

    const report = mod.formatWaiverVerdict(await deriveAt(OUTSIDE_WINDOW));

    // A refusal nobody can act on sends people to the unaudited admin merge,
    // which is the one route that records nothing at all.
    expect(report).toContain("#3709");
    expect(report).toContain("device farm outage");
    expect(report).toContain("**Remedy:**");
    expect(report).toContain("Do not merge on the earlier green.");
  });

  it("reports NOT DETERMINED, never waived, when the live pull request cannot be read", async () => {
    installApi({ liveLabels: null });

    const verdict = await deriveAt(INSIDE_WINDOW);

    // "We could not check" must never render as "it is fine" — and it must not
    // render as "the waiver is bad" either. Both are answers; this is the
    // absence of one, and only naming it as such keeps the merge closed for the
    // right stated reason.
    expect(verdict.state).toBe(mod.WAIVER_STATES.notDetermined);
    expect(verdict.state).not.toBe(mod.WAIVER_STATES.waived);
    expect(verdict.record).toBeNull();
  });

  it("reports `none` when nobody asked for a waiver", async () => {
    installApi({ liveLabels: [] });

    const verdict = await deriveAt(INSIDE_WINDOW);

    // Not a synonym for `waived`. Nobody requested anything, so whatever the
    // gate reported rests on suite evidence alone and needs no waiver to stand.
    expect(verdict.state).toBe(mod.WAIVER_STATES.none);
    expect(verdict.record).toBeNull();
  });

  it("exits 0 on a valid waiver and 1 on an expired one", async () => {
    installApi({ liveLabels: [LABEL] });
    const onValid = await runCliAt(INSIDE_WINDOW);

    installApi({ liveLabels: [LABEL] });
    const onExpired = await runCliAt(OUTSIDE_WINDOW);

    // The exit code IS the merge-time contract: it is the thing that stops a
    // merge. A mode whose refusal exits 0 is a consult nobody has to obey.
    expect(onValid).toBe(0);
    expect(onExpired).toBe(1);
  });

  it("exits 1 when the waiver state could not be determined", async () => {
    installApi({ liveLabels: null });

    expect(await runCliAt(INSIDE_WINDOW)).toBe(1);
  });
});

describe("the durable record outlives the label", () => {
  it("still names the ticket and reason of a waiver that has EXPIRED", async () => {
    installApi({ liveLabels: [LABEL] });

    const verdict = await deriveAt(OUTSIDE_WINDOW);

    // An expired waiver still shipped something. A record that went blank the
    // moment the waiver lapsed would answer "what shipped on a waiver, and
    // why" with silence for exactly the merges most worth reading about.
    expect(verdict.state).toBe(mod.WAIVER_STATES.refused);
    expect(verdict.record).toContain("#3709");
    expect(verdict.record).toContain("device farm outage");
    expect(verdict.record).toContain(ACTOR);
  });

  it("is delimited by a marker the reaper never touches", async () => {
    installApi({ liveLabels: [LABEL] });

    const verdict = await deriveAt(INSIDE_WINDOW);

    // The record has to be enumerable AFTER the label is gone, so its search
    // key must be something label removal cannot affect.
    expect(verdict.record).toContain(mod.WAIVER_RECORD_BEGIN);
    expect(verdict.record).toContain(mod.WAIVER_RECORD_END);
    expect(verdict.record).toContain(mod.WAIVER_RECORD_MARKER);
  });

  it("is the only thing left once the reaper has stripped the label", async () => {
    installApi({ liveLabels: [LABEL] });
    const beforeReap = await deriveAt(INSIDE_WINDOW);

    // The reaper has now run: the label is gone from the closed pull request.
    installApi({ liveLabels: [] });
    const afterReap = await deriveAt(INSIDE_WINDOW);

    // This is the whole case for a durable record, stated as a measurement.
    // Once the label is stripped, the live pull request can no longer tell
    // anyone a waiver was ever involved — `none` is indistinguishable from a
    // merge that never needed one. The record taken before the strip is the
    // only surviving answer, which is why it must be WRITTEN before the strip
    // rather than derived after it.
    expect(afterReap.state).toBe(mod.WAIVER_STATES.none);
    expect(afterReap.record).toBeNull();
    expect(beforeReap.record).toContain("#3709");
  });

  it("omits a field it could not read rather than rendering a confident blank", async () => {
    installApi({ liveLabels: [LABEL], liveBody: "No trailer here.\n" });

    const verdict = await deriveAt(INSIDE_WINDOW);

    // A record printing `| ticket |  |` reads as "there was no ticket" when
    // what happened is "the trailer could not be read". The two are different
    // facts and the record must not collapse them.
    expect(verdict.state).toBe(mod.WAIVER_STATES.refused);
    expect(verdict.record).not.toContain("| ticket |");
    expect(verdict.record).toContain("| state when recorded | `refused` |");
  });
});
