/**
 * Tests for the mutation gate's shell-guard evidence verdict.
 *
 * ## The defect
 *
 * When a diff touched a shell file, the gate printed:
 *
 * ```
 *   Their only evidence is a driving test that runs the script against a
 *   payload table and asserts the blocked/allowed verdict, with a control
 *   on both sides. Check that one exists; nothing here did.
 * ```
 *
 * The first half is true. **The last four words were a string literal**, printed
 * unconditionally inside the uninstrumentable branch. Nothing on that path
 * looked for a driving test, so the sentence was not a finding that came back
 * empty — it was prose asserting a search that never ran
 * (CodySwannGT/lisa#3931). CodySwannGT/lisa#3863 added exactly the artefact it
 * says is absent, and was reported as undriven anyway, for all nine shell files
 * in that diff.
 *
 * ## The rejection control, which is the point of this file
 *
 * **A check that learns to recognise a real driving test but stops refusing an
 * unevidenced guard has moved the defect, in the direction that reads as
 * green.** So every case here comes in pairs: a guard with evidence must be
 * named as evidenced, and a guard without it must still be named as
 * unevidenced with the same prominence. A vocabulary that could only say
 * "evidenced" would pass half of this file and be worth nothing.
 *
 * The third state is the one the old message did not have a word for. "I looked
 * and found nothing" and "I did not look" are opposite facts and the reader acts
 * on them differently; a gate without a word for the second inevitably prints
 * the first.
 * @module tests/unit/scripts/mutation-gate-shell-evidence
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SHELL_EVIDENCE_FILE,
  SHELL_EVIDENCE,
  SHELL_EVIDENCE_TRACE_VAR,
  classifyShellGuardEvidence,
  describeShellGuardEvidence,
  parseShellGuardTrace,
  readShellGuardEvidence,
} from "../../../typescript/copy-overwrite/scripts/lisa-mutation.mjs";

/** The guard under discussion, as the #3863 diff spelled it. */
const GUARD = "all/copy-overwrite/scripts/lisa-hooks/parity-safety-net.sh";

/** A second guard, so a trace can be about one file and not another. */
const OTHER = "scripts/unrelated-guard.sh";

/** The digest the trace records for the version it observed. */
const DIGEST = "a".repeat(64);

/**
 * One trace record, as the tracer appends them.
 * @param over - Fields this case states differently.
 * @returns One JSONL line.
 */
const line = (over: {
  script?: string;
  status?: number | null;
  sha256?: string;
}): string =>
  JSON.stringify({
    script: GUARD,
    status: 2,
    origin: "tests/unit/hooks/safety-net-worktree-delete.test.ts:41",
    sha256: DIGEST,
    ...over,
  });

/**
 * Classify one guard against a stated trace.
 * @param jsonl - Trace content, or null when there is no evidence source.
 * @param digest - The guard's digest as it stands now.
 * @returns The verdict.
 */
const classify = (
  jsonl: string | null,
  digest: string | null = DIGEST
): { state: string; detail: string } =>
  classifyShellGuardEvidence({
    file: GUARD,
    observed: jsonl === null ? null : parseShellGuardTrace(jsonl),
    currentDigest: digest,
  });

describe("a shell guard WITH a driving test is named as evidenced", () => {
  it("recognises the #3863 shape: driven to a refusal and to an allow", () => {
    // The concrete counter-example the ticket is built on: the safety-net
    // suite drives the shipped hook to exit 2 for a registered worktree and to
    // exit 0 for the prefix-sharing sibling beside it.
    const verdict = classify(`${line({ status: 2 })}\n${line({ status: 0 })}`);

    expect(verdict.state).toBe(SHELL_EVIDENCE.evidenced);
    expect(verdict.detail).toContain("exit 2");
    expect(verdict.detail).toContain("exit 0");
  });

  it("counts an observation whose record carries no digest", () => {
    // A trace written before the tracer recorded digests cannot be checked for
    // drift. Taken at face value, and said so in the module, because this is
    // the one place the classification can be too generous.
    const verdict = classify(
      `${JSON.stringify({ script: GUARD, status: 2 })}\n${JSON.stringify({
        script: GUARD,
        status: 0,
      })}`
    );

    expect(verdict.state).toBe(SHELL_EVIDENCE.evidenced);
  });
});

describe("a shell guard WITHOUT one is still named as unevidenced", () => {
  it("refuses a guard the run never observed at all", () => {
    // The rejection control. A check that recognised the case above and lost
    // this one would report every shell guard as evidenced, which is the
    // original defect with the opposite sign.
    const verdict = classify(line({ script: OTHER }));

    expect(verdict.state).toBe(SHELL_EVIDENCE.unevidenced);
    expect(verdict.detail).toContain("UNEVIDENCED");
  });

  it("refuses a guard driven only onto its allow path", () => {
    // CodySwannGT/lisa#3054: every verdict site in `parity-safety-net.sh`
    // reached its answer through `grep -q`, and a grep exiting 2 made the
    // shipped hook ALLOW catastrophic deletes. An allows-only suite cannot
    // detect that by construction, so it is not evidence.
    const verdict = classify(line({ status: 0 }));

    expect(verdict.state).toBe(SHELL_EVIDENCE.allowOnly);
    expect(verdict.detail).toContain("never observed refusing");
  });

  it("refuses a guard driven only onto its refusal path", () => {
    // The control on the other side is half of what the message asks for. A
    // guard nothing observed allowing may be refusing everything.
    const verdict = classify(line({ status: 2 }));

    expect(verdict.state).toBe(SHELL_EVIDENCE.allowOnly);
    expect(verdict.detail).toContain("never allowing");
  });

  it("refuses a guard whose only observations are of a different version", () => {
    // Stale evidence is the false claim with a longer half-life: a guard that
    // inherits its predecessor's coverage reads as proven while nothing has
    // driven the bytes that ship.
    const verdict = classify(
      `${line({ status: 2 })}\n${line({ status: 0 })}`,
      "b".repeat(64)
    );

    expect(verdict.state).toBe(SHELL_EVIDENCE.stale);
    expect(verdict.detail).toContain("UNEVIDENCED");
  });
});

describe("what it did not check is never reported as what does not exist", () => {
  it("names the absent evidence source rather than the absent test", () => {
    const verdict = classify(null);

    expect(verdict.state).toBe(SHELL_EVIDENCE.notComputed);
    expect(verdict.detail).toContain("NOT COMPUTED");
  });

  it("says so in the summary, in those words", () => {
    const described = describeShellGuardEvidence(
      [GUARD],
      { source: null, reason: "no trace was produced" },
      () => DIGEST
    );

    expect(described.summary).toContain("did NOT check");
    expect(described.summary).toContain('never as "nothing exists"');
  });

  it("reports no evidence source when the trace cannot be read", () => {
    const evidence = readShellGuardEvidence("/nonexistent-root-for-this-test", {
      [SHELL_EVIDENCE_TRACE_VAR]: "",
    } as NodeJS.ProcessEnv);

    expect(evidence.source).toBeNull();
    expect("reason" in evidence && evidence.reason).toContain(
      DEFAULT_SHELL_EVIDENCE_FILE
    );
  });

  it("names the variable when the operator pointed it at nothing", () => {
    const evidence = readShellGuardEvidence("/nonexistent-root-for-this-test", {
      [SHELL_EVIDENCE_TRACE_VAR]: "/nowhere/trace.jsonl",
    } as NodeJS.ProcessEnv);

    expect(evidence.source).toBeNull();
    expect("reason" in evidence && evidence.reason).toContain(
      SHELL_EVIDENCE_TRACE_VAR
    );
  });
});

describe("the rendered report distinguishes the states side by side", () => {
  it("names one file evidenced and the other unevidenced in the same run", () => {
    // The property the ticket turns on: a genuinely unevidenced shell guard
    // used to produce a message byte-identical to an evidenced one, so nothing
    // distinguished them at review time.
    const described = describeShellGuardEvidence(
      [GUARD, OTHER],
      {
        source: "/tmp-trace.jsonl",
        observed: parseShellGuardTrace(
          `${line({ status: 2 })}\n${line({ status: 0 })}`
        ),
      },
      () => DIGEST
    );

    expect(described.verdicts).toEqual([
      {
        file: GUARD,
        state: SHELL_EVIDENCE.evidenced,
        detail: expect.any(String),
      },
      {
        file: OTHER,
        state: SHELL_EVIDENCE.unevidenced,
        detail: expect.any(String),
      },
    ]);
    expect(described.summary).toContain("1 of 2 file(s)");
    expect(described.summary).toContain("NO driving-test evidence");
  });

  it("says every file was driven when every file was", () => {
    const described = describeShellGuardEvidence(
      [GUARD],
      {
        source: "/tmp-trace.jsonl",
        observed: parseShellGuardTrace(
          `${line({ status: 2 })}\n${line({ status: 0 })}`
        ),
      },
      () => DIGEST
    );

    expect(described.summary).toContain("was observed being driven");
    expect(described.summary).not.toContain("NO driving-test evidence");
  });

  it("skips a torn line rather than refusing to answer", () => {
    // A trace is an observation log appended during a test run. One partial
    // write must not turn every other observation into a refusal.
    const observed = parseShellGuardTrace(
      `${line({ status: 2 })}\n{"script":\n${line({ status: 0 })}`
    );

    expect(
      [...(observed.get(GUARD)?.statuses ?? [])].sort(
        (left, right) => left - right
      )
    ).toEqual([0, 2]);
  });
});
