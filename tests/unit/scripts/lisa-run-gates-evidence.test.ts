/**
 * The gate runner RECORDS what it proved, and never records what it did not.
 *
 * `lisa-gates.mjs` has shipped `EVIDENCE_FIELDS` and `readEvidence` since the
 * continuous moment was added — a reader that demotes stale or work-less
 * evidence to `unknown`. Both were exported with ZERO production callers: the
 * reader existed and nothing wrote. So a `pre-deploy:production` gate that
 * required a recent `continuous:staging` result would resolve against nothing,
 * and "nothing" is the one answer that must never read as satisfied
 * (CodySwannGT/lisa#3022).
 *
 * These are the properties that make a recorded envelope worth trusting:
 *
 * - it BINDS to a subject and a contract — which tree, under which rules,
 *   produced by which workflow — so evidence of one thing cannot be mistaken
 *   for evidence of another;
 * - a gate this run did not observe is recorded `unknown`, never omitted into
 *   ambiguity and never `pass`;
 * - a moment that declared nothing records an EMPTY gate list, so the change
 *   cannot manufacture evidence for gates that did not run;
 * - a run that could not write its envelope FAILS, because a missing record and
 *   a clean record must not look the same.
 * @module tests/unit/scripts/lisa-run-gates-evidence
 */

import { type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { readEvidence } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { SCRIPT } from "./lisa-run-gates-fixtures.js";

/**
 * One recorded gate observation: `EVIDENCE_FIELDS` verbatim, plus two.
 *
 * Spelled out here rather than imported because the module under test is a
 * `.mjs` with no declaration file. The seven `EVIDENCE_FIELDS` names must
 * match exactly or `readEvidence` needs an adapter — and an adapter is how one
 * schema quietly becomes two.
 */
type GateEvidence = {
  gate: string;
  status: string;
  work: number | null;
  measures: Record<string, unknown>;
  prover: { tool: string | null; version: string | null };
  observed_at: string;
  max_age_minutes: number | null;
  /** Without a per-row level a required gate can be "covered" by evidence that
   * was optional when it ran. */
  level: string;
  /** The registry label, which ties the row to the derived context string. */
  label: string;
};

/** The document one run of one moment records, `lisa.gate-evidence/v1`. */
type Envelope = {
  schema: string;
  verdict: string;
  observed_at: string;
  subject: {
    repository: string | null;
    tree: string | null;
    commit: string | null;
    ref: string | null;
  };
  contract: {
    moment: string;
    runner: string | null;
    gates_digest: string | null;
    registry_version: string | null;
    workflow_ref: string | null;
    workflow_sha: string | null;
    inputs_digest: string | null;
  };
  producer: {
    run_id: string | null;
    run_attempt: string | null;
    run_url: string | null;
    workflow: string | null;
    event: string | null;
    actor: string | null;
    caller_chain: string[] | null;
    reused_gates: string[];
  };
  gates: GateEvidence[];
};

/** A moment in the continuous family, where freshness is the whole point. */
const CONTINUOUS = "continuous:staging";

/** The deploy moment a continuous result is meant to gate promotion into. */
const PRE_DEPLOY = "pre-deploy:production";

/** The one schema token, shared with the release verifier in #3013. */
const SCHEMA = "lisa.gate-evidence/v1";

/** Shape every digest field must have, so a placeholder cannot pass for one. */
const DIGEST = /^sha256:[0-9a-f]{64}$/;

/**
 * Run the real CLI against a throwaway project and read back what it recorded.
 *
 * The temp root is removed only AFTER the envelope is read: the whole subject
 * of this file is a file the runner writes, and a harness that deleted the
 * directory first would test nothing.
 * @param options Inputs.
 * @param options.config `.lisa.config.json` contents, or null to omit it.
 * @param options.moment The moment to ask for.
 * @param options.evidence Where to tell the runner to record, relative to the
 *   project root. Defaults to a writable path; pass an unwritable one to prove
 *   the failure path.
 * @param options.env Extra environment, e.g. the GitHub run variables.
 * @returns The child process and the parsed envelope, when one was written.
 */
function record(options: {
  config: string | null;
  moment: string;
  evidence?: string;
  env?: Record<string, string>;
}): { child: SpawnSyncReturns<string>; envelope: Envelope | null } {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-gate-evidence-"));
  try {
    if (options.config !== null) {
      writeFileSync(path.join(root, ".lisa.config.json"), options.config);
    }
    const target = path.join(root, options.evidence ?? "evidence.json");
    const child = boundedSpawnSync({
      label: `lisa-run-gates.mjs --moment=${options.moment} --evidence`,
      command: process.execPath,
      args: [SCRIPT, `--moment=${options.moment}`, `--evidence=${target}`],
      cwd: root,
      env: { ...process.env, ...options.env },
    });
    let envelope: Envelope | null = null;
    try {
      envelope = JSON.parse(readFileSync(target, "utf8")) as Envelope;
    } catch {
      envelope = null;
    }
    return { child, envelope };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

/** A gates block declaring one unprovable gate at the continuous moment. */
const DECLARED_AT_CONTINUOUS = JSON.stringify({
  gates: {
    accessibility: { [CONTINUOUS]: "required" },
    runner: "bun run",
  },
});

describe("the runner records an evidence envelope", () => {
  it("writes a document naming every gate declared at the moment", () => {
    const { envelope } = record({
      config: DECLARED_AT_CONTINUOUS,
      moment: CONTINUOUS,
    });

    expect(envelope).not.toBeNull();
    expect(envelope?.schema).toBe(SCHEMA);
    expect(envelope?.gates.map(gate => gate.gate)).toEqual(["accessibility"]);
  });

  it("keeps every EVIDENCE_FIELDS key, so no reader needs an adapter", () => {
    // The seven names are `lisa-gates.mjs`'s and `readEvidence` reads a row
    // directly. Renaming one would force an adapter somewhere, and an adapter
    // is how one schema quietly becomes two. `task` and `command` are
    // deliberately absent: they live in `contract.gates_digest`, and a second
    // copy on the row is a second place to drift.
    const { envelope } = record({
      config: DECLARED_AT_CONTINUOUS,
      moment: CONTINUOUS,
    });
    const [gate] = envelope?.gates ?? [];

    expect(Object.keys(gate ?? {}).sort((a, b) => a.localeCompare(b))).toEqual([
      "gate",
      "label",
      "level",
      "max_age_minutes",
      "measures",
      "observed_at",
      "prover",
      "status",
      "work",
    ]);
    expect(gate?.level).toBe("required");
    // Null, never the string "unknown": a verifier treats a null-version row
    // as uncoverable and reruns, and a placeholder that looked like a version
    // would defeat exactly that.
    expect(gate?.prover.version).toBeNull();
  });

  it("binds the evidence to the tree and the run it observed", () => {
    const { envelope } = record({
      config: DECLARED_AT_CONTINUOUS,
      moment: CONTINUOUS,
      env: {
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_REF: "refs/heads/main",
        GITHUB_RUN_ATTEMPT: "2",
        GITHUB_RUN_ID: "42",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
      },
    });

    expect(envelope?.subject.repository).toBe("owner/repo");
    expect(envelope?.subject.commit).toBe(
      "0123456789abcdef0123456789abcdef01234567"
    );
    expect(envelope?.subject.ref).toBe("refs/heads/main");
    expect(envelope?.contract.moment).toBe(CONTINUOUS);
    expect(envelope?.producer.run_id).toBe("42");
    expect(envelope?.producer.run_attempt).toBe("2");
    expect(envelope?.producer.run_url).toBe(
      "https://github.com/owner/repo/actions/runs/42"
    );
  });

  it("records the workflow identity a tree hash cannot carry", () => {
    // Consumers call the reusable workflow at `@main`, so its contents can
    // change with NO change to the caller's tree. Tree identity alone would
    // let an older, weaker workflow's evidence satisfy a stricter one — and
    // the same workflow at the same sha proves different things when handed
    // different inputs.
    const { envelope } = record({
      config: DECLARED_AT_CONTINUOUS,
      moment: CONTINUOUS,
      env: {
        GITHUB_WORKFLOW_REF: "o/r/.github/workflows/gates.yml@refs/heads/main",
        GITHUB_WORKFLOW_SHA: "89abcdef89abcdef89abcdef89abcdef89abcdef",
        LISA_GATE_EVIDENCE_INPUTS: '{"moment":"continuous:staging"}',
      },
    });

    expect(envelope?.contract.workflow_ref).toBe(
      "o/r/.github/workflows/gates.yml@refs/heads/main"
    );
    expect(envelope?.contract.workflow_sha).toBe(
      "89abcdef89abcdef89abcdef89abcdef89abcdef"
    );
    expect(envelope?.contract.inputs_digest).toMatch(DIGEST);
  });

  it("declares no reuse, so a proof cannot rest on a proof of nothing", () => {
    // Emitted empty from day one even though nothing reuses yet. An absent
    // field and an empty one must not be the same to a reader, or every
    // envelope written before the field existed reads as having reused
    // everything.
    const { envelope } = record({
      config: DECLARED_AT_CONTINUOUS,
      moment: CONTINUOUS,
    });

    expect(envelope?.producer.reused_gates).toEqual([]);
    // Never a guessed literal. Depth is a property of how a consumer wired its
    // workflows, and the only truthful derivation needs API scope this runner
    // does not have — so unstated records null and a verifier reruns.
    expect(envelope?.producer.caller_chain).toBeNull();
  });

  it("records a gate it could not prove as unknown, never as a pass", () => {
    // `accessibility` is the one deploy-only gate no stack ships a prover for.
    // It resolves to no command, so the runner calls it UNPROVABLE — and the
    // envelope must say `unknown`, which `readEvidence` refuses to credit.
    const { envelope } = record({
      config: DECLARED_AT_CONTINUOUS,
      moment: CONTINUOUS,
    });
    const [gate] = envelope?.gates ?? [];

    expect(gate?.status).toBe("unknown");
    expect(readEvidence(gate, {}, Date.now()).status).toBe("unknown");
  });
});

describe("the contract digest is over the resolved plan", () => {
  it("changes when a level changes, so evidence cannot outlive its contract", () => {
    // The case the digest exists for: without it, a result recorded while the
    // gate was `optional` could satisfy a moment that now declares it
    // `required` — a silent downgrade no timestamp catches.
    const one = record({ config: DECLARED_AT_CONTINUOUS, moment: CONTINUOUS });
    const other = record({
      config: JSON.stringify({
        gates: {
          accessibility: { [CONTINUOUS]: "optional" },
          runner: "bun run",
        },
      }),
      moment: CONTINUOUS,
    });

    expect(one.envelope?.contract.gates_digest).toMatch(DIGEST);
    expect(one.envelope?.contract.gates_digest).not.toBe(
      other.envelope?.contract.gates_digest
    );
  });

  it("ignores unrelated config keys, which prove nothing about this moment", () => {
    // Digesting the FILE would force a rerun every time an unrelated key was
    // edited, while proving nothing changed here. The bytes differ; the
    // resolved plan does not, so the digest must not.
    const bare = record({ config: DECLARED_AT_CONTINUOUS, moment: CONTINUOUS });
    const noisy = record({
      config: JSON.stringify({
        gates: {
          accessibility: { [CONTINUOUS]: "required" },
          runner: "bun run",
        },
        tracker: "github",
      }),
      moment: CONTINUOUS,
    });

    // The equality alone would pass vacuously when NEITHER run records —
    // undefined equals undefined — which is the shape of an inert assertion.
    // Pinning the shape first is what makes the equality mean something.
    expect(bare.envelope?.contract.gates_digest).toMatch(DIGEST);
    expect(noisy.envelope?.contract.gates_digest).toBe(
      bare.envelope?.contract.gates_digest
    );
  });

  it("records a gate declared off, which absence cannot express", () => {
    // A gate declared `off` runs nothing, so it never appears in `gates[]`.
    // If the digest ignored it too, "this project decided against the gate"
    // and "the registry never knew the gate existed" would produce identical
    // evidence — and only one of those is a decision on the record.
    const without = record({
      config: DECLARED_AT_CONTINUOUS,
      moment: CONTINUOUS,
    });
    const withOff = record({
      config: JSON.stringify({
        gates: {
          accessibility: { [CONTINUOUS]: "required" },
          "load-capacity": { [CONTINUOUS]: "off" },
          runner: "bun run",
        },
      }),
      moment: CONTINUOUS,
    });

    expect(withOff.envelope?.gates.map(gate => gate.gate)).toEqual([
      "accessibility",
    ]);
    expect(withOff.envelope?.contract.gates_digest).not.toBe(
      without.envelope?.contract.gates_digest
    );
  });
});

describe("the envelope never manufactures evidence", () => {
  it("records an empty gate list for a moment that declared nothing", () => {
    // The negative control. A gates block that declares only at
    // `pull-request` proves NOTHING at `pre-deploy:production`, and the
    // envelope for that moment must say so by naming no gate at all. An
    // envelope that inherited rows from another moment would be evidence of
    // one thing read as evidence of another — the failure the subject binding
    // exists to prevent, committed by the recorder itself.
    const { envelope } = record({
      config: JSON.stringify({
        gates: {
          "code-style": { "pull-request": "required" },
          runner: "bun run",
        },
      }),
      moment: PRE_DEPLOY,
    });

    expect(envelope).not.toBeNull();
    expect(envelope?.gates).toEqual([]);
    expect(envelope?.contract.moment).toBe(PRE_DEPLOY);
    // And the reader gets `unknown` for the gate nobody proved here, rather
    // than a pass inherited from the moment where it IS declared.
    const looked = envelope?.gates.find(gate => gate.gate === "code-style");
    expect(readEvidence(looked, {}, Date.now()).status).toBe("unknown");
  });

  it("records that the registry governs nothing when there is no gates block", () => {
    const { child, envelope } = record({
      config: JSON.stringify({ tracker: "github" }),
      moment: CONTINUOUS,
    });

    // 78 = NO_GATES, which the workflow treats as a pass. That is exactly why
    // the envelope has to exist for it: the reader must be able to tell
    // "ran, and this project declares nothing" from "never ran". `verdict` is
    // what keeps an empty envelope from being byte-similar to a clean one.
    expect(child.status).toBe(78);
    expect(envelope?.verdict).toBe("no-gates");
    expect(envelope?.gates).toEqual([]);
  });
});

describe("a run that recorded nothing is not a pass", () => {
  it("fails rather than exiting clean when the envelope cannot be written", () => {
    // The path's parent is a FILE, so every write under it fails. This moment
    // otherwise exits NO_GATES (78); the failed recording upgrades that
    // non-blocking result to RUNNER_FAILED.
    const { child, envelope } = record({
      config: JSON.stringify({ tracker: "github" }),
      moment: CONTINUOUS,
      evidence: ".lisa.config.json/evidence.json",
    });

    expect(envelope).toBeNull();
    // 70 = RUNNER_FAILED. Not 0, and not 78.
    expect(child.status).toBe(70);
  });

  it("does not weaken an existing refusal when its envelope cannot be written", () => {
    const { child, envelope } = record({
      config: JSON.stringify({
        gates: {
          "runtime-web-vulnerability": {
            "pull-request": "required",
          },
        },
      }),
      moment: "pull-request",
      evidence: ".lisa.config.json/evidence.json",
    });

    expect(envelope).toBeNull();
    expect(child.status).toBe(1);
    expect(child.stderr).toContain('cannot run at "pull-request"');
  });
});
