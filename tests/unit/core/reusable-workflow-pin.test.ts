/**
 * Tests the text surface that reads and rewrites a Lisa reusable-workflow ref.
 *
 * Every assertion here corresponds to a way the rewrite could look like it
 * worked while leaving a caller mutable, because that is the failure mode this
 * module exists inside: a workflow that resolves the wrong ref does not error,
 * it silently runs different code, and a workflow that fails to resolve at all
 * runs zero jobs and reports nothing.
 * @module tests/unit/core/reusable-workflow-pin
 */
import { describe, expect, it } from "vitest";

import {
  findReusableWorkflowRefs,
  isMutableRef,
  isPinnedAt,
  pinReusableWorkflowRefs,
} from "../../../src/core/reusable-workflow-pin.js";

/** A full-length commit SHA. */
const SHA = "0123456789abcdef0123456789abcdef01234567";

/** The pin every caller in these fixtures must end up carrying. */
const PIN = { sha: SHA, version: "4.4.11" } as const;

/** A caller line for the quality reusable, tracking the mutable default ref. */
const QUALITY_AT_MAIN =
  "    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main\n";

/** A caller line for the gates reusable, tracking the mutable default ref. */
const GATES_AT_MAIN =
  "    uses: CodySwannGT/lisa/.github/workflows/gates.yml@main";

describe("finding caller references", () => {
  it("reads the workflow and the ref from a bare uses line", () => {
    const refs = findReusableWorkflowRefs(
      "jobs:\n  quality:\n    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main\n"
    );
    expect(refs).toEqual([
      { line: 3, workflow: "quality.yml", ref: "main", comment: null },
    ]);
  });

  it("reads a quoted uses value", () => {
    const refs = findReusableWorkflowRefs(
      '    uses: "CodySwannGT/lisa/.github/workflows/gates.yml@v3.1.0"\n'
    );
    expect(refs[0]?.ref).toBe("v3.1.0");
  });

  it("separates the ref from its trailing version comment", () => {
    const refs = findReusableWorkflowRefs(
      `    uses: CodySwannGT/lisa/.github/workflows/quality.yml@${SHA} # v4.4.11\n`
    );
    expect(refs[0]?.ref).toBe(SHA);
    expect(refs[0]?.comment).toBe("v4.4.11");
  });

  it("ignores a reference that is itself inside a comment", () => {
    const refs = findReusableWorkflowRefs(
      "    # uses: CodySwannGT/lisa/.github/workflows/quality.yml@v1.2.3\n"
    );
    expect(refs).toEqual([]);
  });

  it("ignores another organisation's reusable workflow", () => {
    const refs = findReusableWorkflowRefs(
      "    uses: someone/else/.github/workflows/quality.yml@main\n"
    );
    expect(refs).toEqual([]);
  });

  it("ignores a step-level third-party action", () => {
    const refs = findReusableWorkflowRefs(
      "      - uses: actions/checkout@v6\n"
    );
    expect(refs).toEqual([]);
  });

  it("finds every reference in a file, not only the first", () => {
    const refs = findReusableWorkflowRefs(
      [
        GATES_AT_MAIN,
        "    uses: CodySwannGT/lisa/.github/workflows/release.yml@main",
        GATES_AT_MAIN,
      ].join("\n")
    );
    expect(refs).toHaveLength(3);
  });
});

describe("classifying a ref", () => {
  it("calls a branch mutable", () => {
    expect(
      isMutableRef({ line: 1, workflow: "a.yml", ref: "main", comment: null })
    ).toBe(true);
  });

  it("calls a version tag mutable — a tag is movable and it silently froze one caller for a thousand releases", () => {
    expect(
      isMutableRef({
        line: 1,
        workflow: "a.yml",
        ref: "v3.35.0",
        comment: null,
      })
    ).toBe(true);
  });

  it("calls a SHORT sha mutable, because it is ambiguous", () => {
    expect(
      isMutableRef({
        line: 1,
        workflow: "a.yml",
        ref: "0123456",
        comment: null,
      })
    ).toBe(true);
  });

  it("accepts exactly 40 lowercase hex characters and nothing else", () => {
    expect(
      isMutableRef({ line: 1, workflow: "a.yml", ref: SHA, comment: null })
    ).toBe(false);
    expect(
      isMutableRef({
        line: 1,
        workflow: "a.yml",
        ref: SHA.toUpperCase(),
        comment: null,
      })
    ).toBe(true);
    expect(
      isMutableRef({
        line: 1,
        workflow: "a.yml",
        ref: `${SHA}0`,
        comment: null,
      })
    ).toBe(true);
  });
});

describe("recognising a reference that is already current", () => {
  it("treats the right SHA with the wrong version comment as NOT current", () => {
    // Otherwise a version bump that resolves to the same commit — or a hand
    // edit of the comment — would leave a reader looking at a version the pin
    // above it does not name, which is the exact confusion the comment exists
    // to remove.
    expect(
      isPinnedAt(
        { line: 1, workflow: "a.yml", ref: SHA, comment: "v4.4.10" },
        PIN
      )
    ).toBe(false);
  });

  it("treats a missing comment as NOT current", () => {
    expect(
      isPinnedAt({ line: 1, workflow: "a.yml", ref: SHA, comment: null }, PIN)
    ).toBe(false);
  });

  it("accepts the exact pin with its exact comment", () => {
    expect(
      isPinnedAt(
        { line: 1, workflow: "a.yml", ref: SHA, comment: "v4.4.11" },
        PIN
      )
    ).toBe(true);
  });
});

describe("rewriting", () => {
  it("replaces @main with the full SHA and a version comment", () => {
    const after = pinReusableWorkflowRefs(
      `jobs:\n  quality:\n${QUALITY_AT_MAIN}`,
      PIN
    );
    expect(after).toContain(
      `uses: CodySwannGT/lisa/.github/workflows/quality.yml@${SHA} # v4.4.11`
    );
    expect(after).not.toContain("@main");
  });

  it("replaces a version-tag pin too, not only @main", () => {
    const after = pinReusableWorkflowRefs(
      "    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@v3.35.0\n",
      PIN
    );
    expect(after).toContain(`@${SHA} # v4.4.11`);
    expect(after).not.toContain("v3.35.0");
  });

  it("rewrites EVERY reference in the file — a partial rewrite reads as a finished one", () => {
    const after = pinReusableWorkflowRefs(
      [
        GATES_AT_MAIN,
        "    uses: CodySwannGT/lisa/.github/workflows/release.yml@v1.0.0",
        GATES_AT_MAIN,
        "",
      ].join("\n"),
      PIN
    );
    expect(findReusableWorkflowRefs(after).map(r => r.ref)).toEqual([
      SHA,
      SHA,
      SHA,
    ]);
  });

  it("is idempotent — running it on its own output changes nothing", () => {
    const once = pinReusableWorkflowRefs(QUALITY_AT_MAIN, PIN);
    expect(pinReusableWorkflowRefs(once, PIN)).toBe(once);
  });

  it("does not grow the comment on repeated runs", () => {
    let text =
      "    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main\n";
    for (let i = 0; i < 5; i++) text = pinReusableWorkflowRefs(text, PIN);
    expect(text.match(/v4\.4\.11/gu)).toHaveLength(1);
  });

  it("preserves indentation and quoting", () => {
    const after = pinReusableWorkflowRefs(
      '        uses: "CodySwannGT/lisa/.github/workflows/quality.yml@main"\n',
      PIN
    );
    expect(after).toBe(
      `        uses: "CodySwannGT/lisa/.github/workflows/quality.yml@${SHA}" # v4.4.11\n`
    );
  });

  it("leaves a commented-out reference untouched", () => {
    const source =
      "    # uses: CodySwannGT/lisa/.github/workflows/quality.yml@v1.2.3\n";
    expect(pinReusableWorkflowRefs(source, PIN)).toBe(source);
  });

  it("leaves another organisation's reusable and third-party actions untouched", () => {
    const source = [
      "    uses: someone/else/.github/workflows/quality.yml@main",
      "      - uses: actions/checkout@v6",
      "",
    ].join("\n");
    expect(pinReusableWorkflowRefs(source, PIN)).toBe(source);
  });

  it("returns the input byte-for-byte when there is nothing to pin", () => {
    const source = "name: CI\non:\n  push:\njobs:\n  a:\n    runs-on: x\n";
    expect(pinReusableWorkflowRefs(source, PIN)).toBe(source);
  });

  it("never writes a short SHA, whatever it was handed", () => {
    // The mutation this guards against is the pinner truncating: the emitted
    // ref must be the full 40 characters, and a check that only asserted "some
    // hex is present" would pass a 7-character pin GitHub answers with nothing.
    const after = pinReusableWorkflowRefs(QUALITY_AT_MAIN, PIN);
    const ref = findReusableWorkflowRefs(after)[0]?.ref ?? "";
    expect(ref).toHaveLength(40);
  });
});
