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
 * - it BINDS to a subject — which tree, which moment, which run — so evidence
 *   of one thing cannot be mistaken for evidence of another;
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

/** One recorded gate observation, in the shipped `EVIDENCE_FIELDS` shape. */
type GateEvidence = {
  gate: string;
  status: string;
  work: number | null;
  measures: Record<string, unknown>;
  prover: { tool: string | null; version: string | null };
  observed_at: string;
  max_age_minutes: number | null;
  level: string;
};

/** The document one run of one moment records. */
type Envelope = {
  schema_version: number;
  kind: string;
  verdict: string;
  observed: number;
  observed_at: string;
  recorded_at: string;
  subject: {
    repository: string | null;
    commit_sha: string | null;
    tree_sha: string | null;
    ref: string | null;
    moment: string;
    family: string;
    environment: string | null;
    config_digest: string | null;
  };
  run: Record<string, string | null>;
  gates: GateEvidence[];
};

/** A moment in the continuous family, where freshness is the whole point. */
const CONTINUOUS = "continuous:staging";

/** The deploy moment a continuous result is meant to gate promotion into. */
const PRE_DEPLOY = "pre-deploy:production";

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
    runner: "bun run",
    accessibility: { [CONTINUOUS]: "required" },
  },
});

describe("the runner records an evidence envelope", () => {
  it("writes a document naming every gate declared at the moment", () => {
    const { envelope } = record({
      config: DECLARED_AT_CONTINUOUS,
      moment: CONTINUOUS,
    });

    expect(envelope).not.toBeNull();
    expect(envelope?.kind).toBe("lisa-gate-evidence");
    expect(envelope?.gates.map(gate => gate.gate)).toEqual(["accessibility"]);
    expect(envelope?.observed).toBe(1);
  });

  it("binds the evidence to the tree, moment, and run it observed", () => {
    const { envelope } = record({
      config: DECLARED_AT_CONTINUOUS,
      moment: CONTINUOUS,
      env: {
        GITHUB_REPOSITORY: "owner/repo",
        GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
        GITHUB_REF: "refs/heads/main",
        GITHUB_RUN_ID: "42",
        GITHUB_RUN_ATTEMPT: "2",
        GITHUB_SERVER_URL: "https://github.com",
      },
    });

    expect(envelope?.subject.repository).toBe("owner/repo");
    expect(envelope?.subject.commit_sha).toBe(
      "0123456789abcdef0123456789abcdef01234567"
    );
    expect(envelope?.subject.ref).toBe("refs/heads/main");
    expect(envelope?.subject.moment).toBe(CONTINUOUS);
    expect(envelope?.subject.family).toBe("continuous");
    expect(envelope?.subject.environment).toBe("staging");
    expect(envelope?.run.id).toBe("42");
    expect(envelope?.run.attempt).toBe("2");
    expect(envelope?.run.url).toBe(
      "https://github.com/owner/repo/actions/runs/42"
    );
  });

  it("digests the gates block, so evidence cannot outlive its contract", () => {
    const one = record({ config: DECLARED_AT_CONTINUOUS, moment: CONTINUOUS });
    const other = record({
      config: JSON.stringify({
        gates: {
          runner: "bun run",
          accessibility: { [CONTINUOUS]: "optional" },
        },
      }),
      moment: CONTINUOUS,
    });

    expect(one.envelope?.subject.config_digest).toMatch(
      /^sha256:[0-9a-f]{64}$/
    );
    expect(one.envelope?.subject.config_digest).not.toBe(
      other.envelope?.subject.config_digest
    );
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
          runner: "bun run",
          "code-style": { "pull-request": "required" },
        },
      }),
      moment: PRE_DEPLOY,
    });

    expect(envelope).not.toBeNull();
    expect(envelope?.gates).toEqual([]);
    expect(envelope?.observed).toBe(0);
    expect(envelope?.subject.moment).toBe(PRE_DEPLOY);
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
    // "ran, and this project declares nothing" from "never ran".
    expect(child.status).toBe(78);
    expect(envelope?.verdict).toBe("no-gates");
    expect(envelope?.gates).toEqual([]);
  });
});

describe("a run that recorded nothing is not a pass", () => {
  it("fails rather than exiting clean when the envelope cannot be written", () => {
    // The path's parent is a FILE, so every write under it fails. Without the
    // upgrade this run would exit 0 — a green deploy gate that recorded
    // nothing, which is the shape the whole subsystem exists to refuse.
    const { child, envelope } = record({
      config: DECLARED_AT_CONTINUOUS,
      moment: CONTINUOUS,
      evidence: ".lisa.config.json/evidence.json",
    });

    expect(envelope).toBeNull();
    // 70 = RUNNER_FAILED. Not 0, and not 78.
    expect(child.status).toBe(70);
  });
});
