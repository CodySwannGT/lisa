/**
 * The envelope builder, called directly rather than through a process.
 *
 * Its sibling suite spawns the real CLI, which is the only way to prove the
 * exit-code contract — and is also why the builder itself was invisible to
 * mutation testing: coverage is collected in-process, so a mutant reached only
 * through a subprocess survives having proved nothing. A guard whose tests all
 * run out-of-process is a guard nothing measures.
 *
 * So this file exercises `evidenceDocument` in-process, and the properties it
 * pins are the ones a reader's trust rests on: the state-to-status mapping,
 * the slim row shape, and a digest that answers "is this the same contract?"
 * and nothing else.
 * @module tests/unit/scripts/lisa-run-gates-envelope
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  evidenceDocument,
  STATE,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";

/** A moment in the continuous family, where freshness is the whole point. */
const MOMENT = "continuous:staging";

/** When the run that produced these observations began. */
const OBSERVED = "2026-08-25T00:00:00.000Z";

/** Shape every digest field must have, so a placeholder cannot pass for one. */
const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** The task runner whose prefix becomes part of every gate's command. */
const BUN = "bun run";

/** The repository these envelopes claim to be about. */
const REPO = "owner/repo";

/** The command the fixture gate resolves to under `BUN`. */
const PROVER = "bun run test:a11y";

/** The fixture gate's registry id. */
const GATE_ID = "accessibility";

/** The fixture gate's registry label. */
const GATE_LABEL = "♿ Accessibility";

/** One gate's declaration, as a gates block resolves it at this moment. */
const BLOCK = { accessibility: { [MOMENT]: "required" }, runner: BUN };

/**
 * One outcome in the shape `runGates` pushes, with only what matters overridden.
 * @param over Fields to override.
 * @returns A gate outcome.
 */
function outcome(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code: 0,
    command: PROVER,
    detail: PROVER,
    diagnosis: null,
    id: GATE_ID,
    label: GATE_LABEL,
    level: "required",
    state: STATE.PASSED,
    ...over,
  };
}

/**
 * Build an envelope over the given outcomes.
 * @param outcomes Gate outcomes the run produced.
 * @param over Document options to override.
 * @returns The envelope.
 */
function build(
  outcomes: Record<string, unknown>[] = [outcome()],
  over: Record<string, unknown> = {}
): Record<string, never> {
  return evidenceDocument({
    gates: BLOCK,
    moment: MOMENT,
    observedAt: OBSERVED,
    result: { results: outcomes },
    runner: BUN,
    verdict: "proved",
    ...over,
  }) as Record<string, never>;
}

/** Environment keys this suite sets, restored after each case. */
const KEYS = [
  "GITHUB_ACTOR",
  "GITHUB_EVENT_NAME",
  "GITHUB_REF",
  "GITHUB_REPOSITORY",
  "GITHUB_RUN_ATTEMPT",
  "GITHUB_RUN_ID",
  "GITHUB_SERVER_URL",
  "GITHUB_SHA",
  "GITHUB_WORKFLOW",
  "GITHUB_WORKFLOW_REF",
  "GITHUB_WORKFLOW_SHA",
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map(key => [key, process.env[key]]));
  // The builder reads the ambient run, so a case that did not clear these
  // would assert against whatever CI happened to export — green on a laptop
  // and meaningless in Actions, or the reverse.
  for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("a runner state becomes exactly one evidence status", () => {
  it("credits only a gate that ran and passed", () => {
    expect(build([outcome()]).gates[0].status).toBe("pass");
  });

  it("blames only a gate that was measured and found wanting", () => {
    const doc = build([outcome({ code: 1, state: STATE.FAILED })]);
    expect(doc.gates[0].status).toBe("fail");
  });

  it("says unknown for every state that measured nothing", () => {
    // Four different ways to reach "nobody knows", and all four must read the
    // same to a verifier. Collapsing any of them into `pass` is the defect the
    // subsystem exists to refuse; collapsing them into `fail` would blame a
    // project for a gap in observation.
    const states = [
      STATE.UNPROVABLE,
      STATE.KILLED,
      STATE.SKIPPED,
      STATE.NOT_RUN,
    ];
    const doc = build(states.map(state => outcome({ state })));

    expect(doc.gates.map((row: { status: string }) => row.status)).toEqual([
      "unknown",
      "unknown",
      "unknown",
      "unknown",
    ]);
  });

  it("says unknown for a state it has never heard of", () => {
    // Fails closed. A state added upstream without a mapping here must not
    // fall through to a credit.
    const doc = build([outcome({ state: "invented" })]);
    expect(doc.gates[0].status).toBe("unknown");
  });
});

describe("every row is the slim record a reader needs", () => {
  it("carries exactly gate, status, level and label", () => {
    // The work, measures, prover and freshness fields existed for a reuse
    // checker nothing called, and were always null or restated the exit code
    // (CodySwannGT/lisa#4794).
    const doc = build([outcome(), outcome({ id: "load-capacity" })]);

    expect(doc.observed_at).toBe(OBSERVED);
    expect(doc.gates).toEqual([
      {
        gate: GATE_ID,
        status: "pass",
        level: "required",
        label: GATE_LABEL,
      },
      {
        gate: "load-capacity",
        status: "pass",
        level: "required",
        label: GATE_LABEL,
      },
    ]);
  });

  it("falls back to the gate id when the registry has no label", () => {
    const doc = build([outcome({ label: undefined })]);
    expect(doc.gates[0].label).toBe(GATE_ID);
  });
});

describe("the contract digest answers one question and no other", () => {
  it("does not ask the host locale how to order contract keys", () => {
    vi.spyOn(String.prototype, "localeCompare").mockImplementation(() => {
      throw new Error("locale collation reached the evidence digest");
    });

    const doc = build();

    expect(doc.contract.gates_digest).toMatch(DIGEST);
  });

  it("is unchanged by the ORDER keys happen to be written in", () => {
    // An editor reordering two keys must not make every prior observation
    // read as produced under a different contract.
    const one = evidenceDocument({
      gates: { accessibility: { [MOMENT]: "required" }, runner: BUN },
      moment: MOMENT,
      observedAt: OBSERVED,
      runner: BUN,
      verdict: "proved",
    }) as Record<string, never>;
    const other = evidenceDocument({
      gates: { runner: BUN, accessibility: { [MOMENT]: "required" } },
      moment: MOMENT,
      observedAt: OBSERVED,
      runner: BUN,
      verdict: "proved",
    }) as Record<string, never>;

    expect(one.contract.gates_digest).toMatch(DIGEST);
    expect(one.contract.gates_digest).toBe(other.contract.gates_digest);
  });

  it("changes when the runner that builds the commands changes", () => {
    // The runner prefix is part of the command a gate ran, so two runs under
    // different task runners did not prove the same thing.
    const npm = build([], { runner: "npm run" });
    const bun = build([], { runner: BUN });
    expect(npm.contract.gates_digest).not.toBe(bun.contract.gates_digest);
  });

  it("is null when there is no gates block to resolve a plan from", () => {
    const doc = build([], { gates: null });
    expect(doc.contract.gates_digest).toBeNull();
  });

  it("is null rather than a guess when the plan cannot resolve", () => {
    // An invalid runner makes `resolveMoment` throw. There is no contract to
    // digest, and null says so instead of inventing one.
    const doc = build([], { runner: "" });
    expect(doc.contract.gates_digest).toBeNull();
  });
});

describe("the envelope reads its subject and contract from the run", () => {
  it("records only the moment and the plan digest as its contract", () => {
    const doc = build();

    expect(
      Object.keys(doc.contract).sort((a, b) => a.localeCompare(b))
    ).toEqual(["gates_digest", "moment"]);
    expect(doc.contract.moment).toBe(MOMENT);
    expect(doc.contract.gates_digest).toMatch(DIGEST);
  });

  it("records no producer block", () => {
    expect(build()).not.toHaveProperty("producer");
  });

  it("records the repository, commit, and ref the run declares", () => {
    process.env["GITHUB_REPOSITORY"] = REPO;
    process.env["GITHUB_SHA"] = "a".repeat(40);
    process.env["GITHUB_REF"] = "refs/heads/main";

    const doc = build();

    expect(doc.subject.repository).toBe(REPO);
    expect(doc.subject.commit).toBe("a".repeat(40));
    expect(doc.subject.ref).toBe("refs/heads/main");
  });
});

describe("an envelope that observed nothing says so", () => {
  it("records an empty gate list when the run produced no results", () => {
    const doc = evidenceDocument({
      gates: BLOCK,
      moment: MOMENT,
      observedAt: OBSERVED,
      verdict: "no-gates",
    }) as Record<string, never>;

    expect(doc.gates).toEqual([]);
    // The verdict is what keeps this from being byte-similar to a clean run.
    expect(doc.verdict).toBe("no-gates");
    expect(doc.schema).toBe("lisa.gate-evidence/v1");
    expect(doc.contract.moment).toBe(MOMENT);
  });
});
