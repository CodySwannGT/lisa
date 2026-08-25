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
 * the freshness stamp every row carries, and a digest that answers "is this
 * the same contract?" and nothing else.
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
    id: "accessibility",
    label: "♿ Accessibility",
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
  "LISA_GATE_EVIDENCE_CALLER_CHAIN",
  "LISA_GATE_EVIDENCE_INPUTS",
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

describe("every row carries the run's own freshness stamp", () => {
  it("stamps each row with when the run began, not when it ended", () => {
    // The conservative direction: a bound computed against a START can only
    // judge the evidence OLDER than it is, so it errs toward `unknown` rather
    // than toward crediting a stale observation.
    const doc = build([outcome(), outcome({ id: "load-capacity" })]);

    expect(doc.observed_at).toBe(OBSERVED);
    expect(
      doc.gates.map((row: { observed_at: string }) => row.observed_at)
    ).toEqual([OBSERVED, OBSERVED]);
  });

  it("records the exit code as a measure, so a verdict cites something", () => {
    const doc = build([outcome({ code: 3, state: STATE.FAILED })]);
    expect(doc.gates[0].measures.exit_code).toBe(3);
    expect(doc.gates[0].measures.state).toBe(STATE.FAILED);
  });

  it("reports a killed gate's absent exit code as null, never as zero", () => {
    // `code: null` means the command was signalled and never reached a
    // verdict. A `?? 0` here would record a clean exit for a run nobody saw
    // finish.
    const doc = build([outcome({ code: null, state: STATE.KILLED })]);
    expect(doc.gates[0].measures.exit_code).toBeNull();
  });

  it("names the command as the prover, with a null version", () => {
    const doc = build([outcome()]);
    expect(doc.gates[0].prover).toEqual({ tool: PROVER, version: null });
  });

  it("names no prover for a gate that resolved to no command", () => {
    const doc = build([outcome({ command: null, state: STATE.SKIPPED })]);
    expect(doc.gates[0].prover.tool).toBeNull();
  });

  it("falls back to the gate id when the registry has no label", () => {
    const doc = build([outcome({ label: undefined })]);
    expect(doc.gates[0].label).toBe("accessibility");
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

describe("the envelope reads its subject, contract, and producer from the run", () => {
  it("records the repository, commit, and ref the run declares", () => {
    process.env["GITHUB_REPOSITORY"] = REPO;
    process.env["GITHUB_SHA"] = "a".repeat(40);
    process.env["GITHUB_REF"] = "refs/heads/main";

    const doc = build();

    expect(doc.subject.repository).toBe(REPO);
    expect(doc.subject.commit).toBe("a".repeat(40));
    expect(doc.subject.ref).toBe("refs/heads/main");
  });

  it("builds a run url only when every part of one is known", () => {
    process.env["GITHUB_RUN_ID"] = "7";
    // No repository and no server url, so a url cannot be built. A partial one
    // would be a link an auditor cannot follow, presented as if it were.
    expect(build().producer.run_url).toBeNull();

    process.env["GITHUB_REPOSITORY"] = REPO;
    process.env["GITHUB_SERVER_URL"] = "https://ghe.example";
    expect(build().producer.run_url).toBe(
      `https://ghe.example/${REPO}/actions/runs/7`
    );
  });

  it("digests the inputs the caller states, order-insensitively", () => {
    process.env["LISA_GATE_EVIDENCE_INPUTS"] = '{"a":1,"b":2}';
    const one = build().contract.inputs_digest;
    process.env["LISA_GATE_EVIDENCE_INPUTS"] = '{"b":2,"a":1}';
    const other = build().contract.inputs_digest;

    expect(one).toMatch(DIGEST);
    expect(one).toBe(other);
  });

  it("records no inputs digest when the caller stated none", () => {
    // Null reads as "not established", which is what it is. A digest of an
    // empty object would read as "this run took no inputs" — a claim nothing
    // here can make.
    expect(build().contract.inputs_digest).toBeNull();
  });

  it("records no inputs digest when the caller stated unreadable JSON", () => {
    // The caller established nothing about its inputs, so a verifier must
    // rerun. Throwing here would instead erase the gate's real verdict and
    // prevent the evidence document from being written at all.
    process.env["LISA_GATE_EVIDENCE_INPUTS"] = "not json";
    expect(build().contract.inputs_digest).toBeNull();
  });

  it("takes a caller chain the caller derived", () => {
    process.env["LISA_GATE_EVIDENCE_CALLER_CHAIN"] = '["Release","🔍 Quality"]';
    expect(build().producer.caller_chain).toEqual(["Release", "🔍 Quality"]);
  });

  it("refuses a caller chain that is not a list of strings", () => {
    // A verifier reads a null chain as ineligible and reruns. Accepting a
    // malformed value would make it read as an eligible depth instead.
    process.env["LISA_GATE_EVIDENCE_CALLER_CHAIN"] = '{"depth":1}';
    expect(build().producer.caller_chain).toBeNull();

    process.env["LISA_GATE_EVIDENCE_CALLER_CHAIN"] = "[1,2]";
    expect(build().producer.caller_chain).toBeNull();

    process.env["LISA_GATE_EVIDENCE_CALLER_CHAIN"] = "not json";
    expect(build().producer.caller_chain).toBeNull();
  });

  it("declares no reuse, so a proof cannot rest on a proof of nothing", () => {
    expect(build().producer.reused_gates).toEqual([]);
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
