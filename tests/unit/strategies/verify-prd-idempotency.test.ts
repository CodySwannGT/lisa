/**
 * Regression tests for the `/lisa:verify-prd` idempotency layer (#600, PRD #553,
 * Story #590, Epic #587) — re-running PRD-level verification against the same PRD
 * MUST NOT duplicate evidence comments, fix issues, or lifecycle labels/statuses.
 *
 * Issue #600 layers idempotency on top of the merged scaffold (#597), PASS path
 * (#598), and FAIL path (#599). The three guarantees under test:
 *
 *   (1) EVIDENCE / FAILURE-REPORT COMMENTS — each carries a stable HTML-comment
 *       sentinel (`<!-- lisa:verify-prd-evidence -->` for PASS,
 *       `<!-- lisa:verify-prd-failure-report -->` for FAIL) and is REGENERATED in
 *       place on re-run rather than appended — the same regenerate-don't-append
 *       discipline `prd-backlink` uses for its `## Tickets` section.
 *   (2) FIX ISSUES — deduped by a stable PRD-ref + requirement marker
 *       (`<!-- lisa:verify-prd-fix prd=… req=… -->`); a re-run with the same
 *       still-failing requirement REFERENCES/UPDATES the existing open fix issue
 *       instead of creating a duplicate. Match by the marker, never by title.
 *   (3) LIFECYCLE TRANSITION — a no-op when the PRD already carries the target
 *       role (already `verified` / already `blocked`); exactly one lifecycle
 *       label/status remains — mirroring `github-prd-intake` Phase 3f.1.
 *
 * This file holds BOTH the doc-presence assertions (the skill documents the three
 * guards across both plugin roots — source of truth and generated artifact, so an
 * artifact-only edit or a missed `bun run build:plugins` fails the suite) AND the
 * executable selector logic that proves the dedupe decisions are derivable from
 * the documented markers (the [EVIDENCE: idempotent-rerun] codification). Split
 * out of verify-prd-scaffold.test.ts to keep each file within the max-lines
 * budget, mirroring how verify-prd-guard-logic.test.ts was split for #599.
 * @module tests/unit/strategies/verify-prd-idempotency
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Both plugin roots: source of truth and generated artifact. */
const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** The vendor-neutral rule the idempotency layer cites by slug. */
const RULE_SLUG = "prd-lifecycle-rollup";

/** Relative path of the skill within a plugin root. */
const SKILL_REL = "skills/verify-prd/SKILL.md";

/** The stable sentinel markers the idempotency layer documents. */
const EVIDENCE_MARKER = "<!-- lisa:verify-prd-evidence -->";
const FAILURE_MARKER = "<!-- lisa:verify-prd-failure-report -->";
const FIX_MARKER_PREFIX = "<!-- lisa:verify-prd-fix";

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("verify-prd idempotency (#600)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    describe(SKILL_REL, () => {
      const skill = read(root, SKILL_REL);

      // (0) Idempotency is now IN SCOPE — the frontmatter and scope no longer
      //     defer it to a sibling.
      it("declares idempotency in scope, not deferred to sibling work", () => {
        // A dedicated Phase 8 exists for idempotency.
        expect(skill).toMatch(/Phase 8[^]*Idempotency/i);
        // The frontmatter no longer says idempotency is sibling work.
        expect(skill).not.toMatch(
          /[Rr]e-run idempotency is handled by sibling work/
        );
        // It is no longer listed as out-of-scope sibling work.
        expect(skill).not.toMatch(/Idempotency.{0,6}\(#600\).{0,40}sibling/i);
      });

      // (1) Evidence + failure-report comments: stable sentinel + regenerate.
      it("documents stable sentinels and regenerate-in-place for both comments", () => {
        expect(skill).toContain(EVIDENCE_MARKER);
        expect(skill).toContain(FAILURE_MARKER);
        // Regenerate in place / edit existing — explicitly NOT append.
        expect(skill).toMatch(/regenerate[^]*in place|edit it in place/i);
        expect(skill).toMatch(/never append|not[^]*append/i);
        // Cites the prd-backlink regenerate-don't-append precedent.
        expect(skill).toMatch(/prd-backlink/);
      });

      // (2) Fix issues: dedupe by stable marker, reference don't duplicate.
      it("documents fix-issue dedupe by a stable marker (match by ref, not title)", () => {
        expect(skill).toContain(FIX_MARKER_PREFIX);
        // The marker is keyed by PRD ref + requirement identity.
        expect(skill).toMatch(/prd=[^]*req=|PRD-ref \+ requirement/i);
        // Reference/update an existing OPEN fix issue rather than duplicating.
        expect(skill).toMatch(/reference[^]*not[^]*duplicate|never duplicate/i);
        expect(skill).toMatch(
          /existing[^]*open[^]*fix issue|open[^]*fix issue/i
        );
        // The rollup dedupe-key discipline: match by stable ref, never by title.
        expect(skill).toMatch(
          /match by[^]*stable ref|stable ref, never by title/i
        );
      });

      // (3) Lifecycle transition: no-op when already at target role.
      it("documents a no-op transition when the PRD already carries the target role", () => {
        expect(skill).toMatch(/no-op if already verified/i);
        expect(skill).toMatch(/no-op if already ticketed/i);
        // Single-label invariant: exactly one lifecycle label/status remains.
        expect(skill).toMatch(/single-label invariant/i);
        expect(skill).toMatch(
          /exactly \*{0,2}one\*{0,2} (PRD-)?lifecycle label/i
        );
        // Mirrors github-prd-intake Phase 3f.1's already-shipped guard.
        expect(skill).toMatch(/github-prd-intake/);
        expect(skill).toMatch(/3f\.1/);
      });

      // (4) Cites the rule by slug — consumer, not a second source of truth.
      it("cites prd-lifecycle-rollup for the idempotency dedupe key", () => {
        expect(skill).toContain(RULE_SLUG);
        expect(skill).toMatch(/idempotency dedupe key/i);
      });
    });
  });
});

/**
 * A PRD comment as the skill reads it back when deciding whether to regenerate or
 * create: its id and full body (which may or may not carry a sentinel).
 */
type PrdComment = {
  readonly id: number;
  readonly body: string;
};

/**
 * Decide whether a sentinel-marked comment should be UPDATED in place or a new
 * one CREATED — the executable proof of Phase 6.3 / 7.3 regenerate-don't-append.
 * Matches strictly on the literal sentinel substring, never on prose or position
 * (so a re-run finds the one canonical comment and refreshes it).
 * @param comments - The PRD's current comments, in API order.
 * @param sentinel - The stable HTML-comment marker to match.
 * @returns The id to PATCH when a marked comment exists, else `"create"`.
 */
const selectCommentAction = (
  comments: readonly PrdComment[],
  sentinel: string
):
  | { readonly action: "update"; readonly id: number }
  | { readonly action: "create" } => {
  const existing = comments.find(comment => comment.body.includes(sentinel));
  return existing === undefined
    ? { action: "create" }
    : { action: "update", id: existing.id };
};

/**
 * An open fix issue as the skill reads it back when deduping: its ref, title
 * (NEVER matched on), and body (which carries the dedupe marker).
 */
type FixIssue = {
  readonly ref: string;
  readonly title: string;
  readonly body: string;
};

/**
 * Build the stable fix-issue dedupe marker from the PRD ref + requirement id —
 * the key encoded in the issue body, per Phase 7.4 / 8.
 * @param prdRef - The PRD's stable child-ref identity (e.g. `org/repo#553`).
 * @param reqId - The stable requirement/AC identity (independent of wording).
 * @returns The literal marker string.
 */
const fixMarker = (prdRef: string, reqId: string): string =>
  `<!-- lisa:verify-prd-fix prd=${prdRef} req=${reqId} -->`;

/**
 * Decide whether to REFERENCE an existing open fix issue or CREATE a new one for
 * a finding — the executable proof of Phase 7.4 dedupe-by-marker. Matches on the
 * marker only (never the title); two distinct requirements get distinct markers,
 * and a renamed issue is still matched by its unchanged marker.
 * @param openIssues - The repo's currently OPEN issues.
 * @param prdRef - The PRD's stable child-ref identity.
 * @param reqId - The finding's stable requirement/AC identity.
 * @returns The ref to reference when a marked open issue exists, else `"create"`.
 */
const selectFixIssueAction = (
  openIssues: readonly FixIssue[],
  prdRef: string,
  reqId: string
):
  | { readonly action: "reference"; readonly ref: string }
  | { readonly action: "create" } => {
  const marker = fixMarker(prdRef, reqId);
  const existing = openIssues.find(issue => issue.body.includes(marker));
  return existing === undefined
    ? { action: "create" }
    : { action: "reference", ref: existing.ref };
};

/**
 * Apply the PRD-lifecycle transition idempotently — the executable proof of
 * Phase 6.2 / 7.2 / 8 no-op-already-at-target-role and the single-label
 * invariant. Returns the resulting label set; re-running with the same target is
 * a fixed point (exactly one lifecycle label remains).
 * @param current - The PRD's current lifecycle labels.
 * @param shipped - The resolved `shipped` role label.
 * @param target - The resolved target role label (`verified` or `blocked`).
 * @returns The lifecycle labels after the transition, deduped.
 */
const applyTransition = (
  current: readonly string[],
  shipped: string,
  target: string
): { readonly labels: readonly string[]; readonly noop: boolean } => {
  if (current.includes(target)) {
    // Already at the target role: no-op, but still collapse to a single label.
    return { labels: [target], noop: true };
  }
  const next = [...new Set(current.filter(label => label !== shipped)), target];
  return { labels: next, noop: false };
};

describe("verify-prd evidence/failure comment regeneration (Phase 6.3 / 7.3)", () => {
  const EVIDENCE = "<!-- lisa:verify-prd-evidence -->";

  it("creates a new comment when no sentinel-marked comment exists", () => {
    const result = selectCommentAction(
      [
        { id: 1, body: "First human comment" },
        { id: 2, body: "Another comment, no marker" },
      ],
      EVIDENCE
    );
    expect(result).toEqual({ action: "create" });
  });

  it("updates the existing marked comment in place on re-run (no append)", () => {
    const result = selectCommentAction(
      [
        { id: 1, body: "First human comment" },
        { id: 42, body: `${EVIDENCE}\nPRD-level verification by Claude…` },
        { id: 7, body: "later unrelated comment" },
      ],
      EVIDENCE
    );
    expect(result).toEqual({ action: "update", id: 42 });
  });

  it("matches the failure-report sentinel independently of the evidence sentinel", () => {
    const FAILURE = "<!-- lisa:verify-prd-failure-report -->";
    const comments: readonly PrdComment[] = [
      { id: 10, body: `${EVIDENCE}\nPASS evidence` },
      { id: 11, body: `${FAILURE}\nFAIL report` },
    ];
    // Each sentinel selects only its own canonical comment.
    expect(selectCommentAction(comments, EVIDENCE)).toEqual({
      action: "update",
      id: 10,
    });
    expect(selectCommentAction(comments, FAILURE)).toEqual({
      action: "update",
      id: 11,
    });
  });

  it("is a fixed point: a second run still targets the same single comment", () => {
    const comments: readonly PrdComment[] = [
      { id: 99, body: `${EVIDENCE}\nregenerated body` },
    ];
    const first = selectCommentAction(comments, EVIDENCE);
    const second = selectCommentAction(comments, EVIDENCE);
    // Both runs resolve to updating the same id — never a second create.
    expect(first).toEqual({ action: "update", id: 99 });
    expect(second).toEqual(first);
  });
});

describe("verify-prd fix-issue dedupe by marker (Phase 7.4)", () => {
  const PRD = "CodySwannGT/lisa#553";
  const REQ = "ac-idempotent-rerun";
  /** Ref of the pre-existing open fix issue used across the dedupe fixtures. */
  const FIX_REF = "CodySwannGT/lisa#700";

  it("creates a fix issue when no open issue carries the marker", () => {
    const result = selectFixIssueAction([], PRD, REQ);
    expect(result).toEqual({ action: "create" });
  });

  it("references the existing open fix issue on re-run with the same requirement", () => {
    const openIssues: readonly FixIssue[] = [
      {
        ref: FIX_REF,
        title: "Fix: idempotent reruns",
        body: `Some description\n${fixMarker(PRD, REQ)}\nmore`,
      },
    ];
    const result = selectFixIssueAction(openIssues, PRD, REQ);
    expect(result).toEqual({
      action: "reference",
      ref: FIX_REF,
    });
  });

  it("matches by marker, NOT by title — a renamed issue is still the same fix", () => {
    const openIssues: readonly FixIssue[] = [
      {
        ref: FIX_REF,
        // Title was edited by a human; the marker is unchanged.
        title: "completely different wording now",
        body: fixMarker(PRD, REQ),
      },
    ];
    const result = selectFixIssueAction(openIssues, PRD, REQ);
    expect(result).toEqual({
      action: "reference",
      ref: FIX_REF,
    });
  });

  it("treats two distinct requirements as two distinct fix issues", () => {
    const otherReq = "ac-fix-issue-dedupe";
    const openIssues: readonly FixIssue[] = [
      { ref: FIX_REF, title: "x", body: fixMarker(PRD, REQ) },
    ];
    // A different requirement's marker is absent → create, not collapse.
    expect(selectFixIssueAction(openIssues, PRD, otherReq)).toEqual({
      action: "create",
    });
  });

  it("does not match a marker for a different PRD even with the same req id", () => {
    const openIssues: readonly FixIssue[] = [
      {
        ref: FIX_REF,
        title: "x",
        body: fixMarker("CodySwannGT/lisa#999", REQ),
      },
    ];
    expect(selectFixIssueAction(openIssues, PRD, REQ)).toEqual({
      action: "create",
    });
  });
});

describe("verify-prd lifecycle transition idempotency (Phase 6.2 / 7.2)", () => {
  const SHIPPED = "prd-shipped";
  const VERIFIED = "prd-verified";
  const TICKETED = "prd-ticketed";

  it("transitions shipped → verified, leaving exactly one lifecycle label", () => {
    const result = applyTransition([SHIPPED], SHIPPED, VERIFIED);
    expect(result.noop).toBe(false);
    expect(result.labels).toEqual([VERIFIED]);
  });

  it("is a no-op when the PRD already carries the verified role", () => {
    const result = applyTransition([VERIFIED], SHIPPED, VERIFIED);
    expect(result.noop).toBe(true);
    expect(result.labels).toEqual([VERIFIED]);
  });

  it("is a no-op when the PRD already carries the ticketed (FAIL) role", () => {
    const result = applyTransition([TICKETED], SHIPPED, TICKETED);
    expect(result.noop).toBe(true);
    expect(result.labels).toEqual([TICKETED]);
  });

  it("collapses an accidental double-labelled PRD to a single target label", () => {
    // A hand-misconfigured PRD carrying both shipped and verified.
    const result = applyTransition([SHIPPED, VERIFIED], SHIPPED, VERIFIED);
    expect(result.labels).toEqual([VERIFIED]);
    // Never leaves shipped alongside the target.
    expect(result.labels).not.toContain(SHIPPED);
  });

  it("is a fixed point: re-running the transition yields the same single label", () => {
    const first = applyTransition([SHIPPED], SHIPPED, VERIFIED);
    const second = applyTransition(first.labels, SHIPPED, VERIFIED);
    expect(second.noop).toBe(true);
    expect(second.labels).toEqual([VERIFIED]);
  });
});
