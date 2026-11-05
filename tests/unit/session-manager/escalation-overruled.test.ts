/**
 * Capturing an operator's "wrongly escalated" verdict (CodySwannGT/lisa#4657).
 *
 * A self-flagged human gate counts as the plan working, so when a human
 * rules the escalation wrong (releases the hold and applies the configured
 * wrongly-escalated label) nothing used to record the correction.
 * `planOverruledCaptures` turns each labeled item into exactly one
 * `lisa-persist-learning` candidate plus the visible marker comment that
 * stops a later cycle capturing it again. Pure: no I/O.
 * @module tests/unit/session-manager/escalation-overruled
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_CAPTURES,
  DEFAULT_WRONGLY_ESCALATED_LABEL,
  OVERRULED_MARKER,
  WRONGLY_ESCALATED_CONFIG_PATHS,
  carriesWronglyEscalated,
  overruledFingerprint,
  planOverruledCaptures,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/escalation-overruled.mjs";
import { withoutRuling } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/queue-github.mjs";

const LABEL = DEFAULT_WRONGLY_ESCALATED_LABEL;
const REF = "example-org/demo-repo#12";
const REASON = "session-manager-dispatch";
const READY = "status:ready";
const HUMAN_NEEDED = "human-needed";
const HOLD_BODY = `Pick the dispatch order.\n\n<!-- [lisa-human-gate] reason=${REASON} -->`;
const RELEASE = {
  id: 901,
  url: "https://github.com/example-org/demo-repo/issues/12#issuecomment-901",
  body: `[lisa-human-gate-release] reason=${REASON}\nThis was just a decision; make it.`,
};

/**
 * The first capture of a plan, failing the test when there is none.
 * @param plan - A capture plan
 * @returns The first capture
 */
function firstCapture(plan: ReturnType<typeof planOverruledCaptures>) {
  const [capture] = plan.captures;
  if (!capture) throw new Error("expected a capture");
  return capture;
}

/**
 * A labeled, released, uncaptured item.
 * @param overrides - Fields to replace
 * @returns Item
 */
function overruledItem(overrides: Record<string, unknown> = {}) {
  return {
    ref: REF,
    labels: [{ name: LABEL }, { name: READY }],
    body: HOLD_BODY,
    comments: [RELEASE],
    ...overrides,
  };
}

describe("the wrongly-escalated label", () => {
  it("defaults to wrongly-escalated-to-human, keyed next to human_needed", () => {
    expect(LABEL).toBe("wrongly-escalated-to-human");
    expect(WRONGLY_ESCALATED_CONFIG_PATHS).toEqual({
      jira: "jira.labels.wrongly_escalated",
      linear: "linear.labels.build.wrongly_escalated",
      github: "github.labels.build.wrongly_escalated",
    });
  });

  it("matches label strings and { name } objects, ignoring case", () => {
    expect(carriesWronglyEscalated(["Wrongly-Escalated-To-Human"], LABEL)).toBe(
      true
    );
    expect(carriesWronglyEscalated([{ name: LABEL }], LABEL)).toBe(true);
    expect(carriesWronglyEscalated([HUMAN_NEEDED], LABEL)).toBe(false);
    expect(carriesWronglyEscalated([LABEL], "")).toBe(false);
  });
});

describe("planOverruledCaptures", () => {
  it("routes exactly one wrongly-escalated candidate for an overruled gate", () => {
    const plan = planOverruledCaptures({
      items: [overruledItem()],
      label: LABEL,
    });
    expect(plan.captures).toHaveLength(1);
    const capture = firstCapture(plan);
    const fingerprint = overruledFingerprint(REF);
    expect(capture.fingerprint).toBe(fingerprint);
    expect(
      capture.comment.startsWith(`${OVERRULED_MARKER} key=${fingerprint} `)
    ).toBe(true);
    expect(capture.candidate).toMatchObject({
      signal: "wrongly-escalated",
      triggering_issue: REF,
      provenance: [REF],
      scope_hint: "project",
      stage_hint: "filing",
      label: LABEL,
      hold_reasons: [REASON],
    });
    expect(capture.candidate.rule).toMatch(/^Planning \(filing\): /);
    expect(capture.candidate.rule.length).toBeLessThanOrEqual(240);
    expect(capture.candidate.evidence.hold[0]).toMatchObject({
      source: "body",
    });
    expect(capture.candidate.evidence.release[0]).toMatchObject({
      id: "901",
      url: RELEASE.url,
    });
    expect(capture.candidate.evidence_links).toEqual([REF, RELEASE.url]);
  });

  it("takes the session manager's question comment as the hold when the body has none", () => {
    const question = {
      id: 5,
      body: "[lisa-session-manager-question] example-org/demo-repo#12 needs a human: it needs a design or product decision.",
    };
    const plan = planOverruledCaptures({
      items: [overruledItem({ body: "No marker here.", comments: [question] })],
      label: LABEL,
    });
    expect(firstCapture(plan).candidate.evidence.hold).toEqual([
      expect.objectContaining({ id: "5", source: "comment" }),
    ]);
    expect(firstCapture(plan).candidate.hold_reasons).toEqual([]);
  });

  it("is idempotent: an item already carrying its marker is not captured again", () => {
    const first = planOverruledCaptures({
      items: [overruledItem()],
      label: LABEL,
    });
    const posted = { id: 902, body: firstCapture(first).comment };
    const second = planOverruledCaptures({
      items: [overruledItem({ comments: [RELEASE, posted] })],
      label: LABEL,
    });
    expect(second.captures).toEqual([]);
    expect(second.skipped).toEqual([{ ref: REF, reason: "already captured" }]);
  });

  it("does not treat another item's marker, or a mention mid-sentence, as captured", () => {
    const other = `${OVERRULED_MARKER} key=${overruledFingerprint("o/r#1")} other`;
    const mention = `We post ${OVERRULED_MARKER} key=${overruledFingerprint(REF)} later.`;
    const plan = planOverruledCaptures({
      items: [overruledItem({ comments: [other, mention] })],
      label: LABEL,
    });
    expect(plan.captures).toHaveLength(1);
  });

  it("skips items without the label", () => {
    const plan = planOverruledCaptures({
      items: [overruledItem({ labels: [HUMAN_NEEDED] }), { labels: [LABEL] }],
      label: LABEL,
    });
    expect(plan.captures).toEqual([]);
    expect(plan.skipped).toEqual([
      { ref: REF, reason: "no wrongly-escalated label" },
      { ref: null, reason: "no ref" },
    ]);
  });

  it("honours a configured label name and ignores the default then", () => {
    const plan = planOverruledCaptures({
      items: [
        overruledItem(),
        overruledItem({ ref: "o/r#2", labels: ["ops:overruled"] }),
      ],
      label: "ops:overruled",
    });
    expect(plan.captures.map(capture => capture.ref)).toEqual(["o/r#2"]);
  });

  it("caps captures per cycle and defers the rest", () => {
    const items = Array.from({ length: DEFAULT_MAX_CAPTURES + 2 }, (_, index) =>
      overruledItem({ ref: `o/r#${index + 1}` })
    );
    const plan = planOverruledCaptures({ items, label: LABEL });
    expect(plan.captures).toHaveLength(DEFAULT_MAX_CAPTURES);
    expect(plan.deferred).toEqual(["o/r#4", "o/r#5"]);
    expect(
      planOverruledCaptures({ items, label: LABEL, max: 0 }).captures
    ).toEqual([]);
    expect(() =>
      planOverruledCaptures({ items, label: LABEL, max: -1 })
    ).toThrow(/non-negative/);
  });

  it("reads Linear-escaped markers, so a Linear item is captured once and keeps its release", () => {
    const escape = (text: string) => text.replace(/[[\]]/g, "\\$&");
    const release = { id: 7, body: escape(RELEASE.body) };
    const first = planOverruledCaptures({
      items: [overruledItem({ comments: [release] })],
      label: LABEL,
    });
    expect(firstCapture(first).candidate.evidence.release).toHaveLength(1);
    const posted = { id: 8, body: escape(firstCapture(first).comment) };
    const second = planOverruledCaptures({
      items: [overruledItem({ comments: [release, posted] })],
      label: LABEL,
    });
    expect(second.captures).toEqual([]);
    expect(second.skipped).toEqual([{ ref: REF, reason: "already captured" }]);
  });

  it("gives each item its own stable fingerprint", () => {
    expect(overruledFingerprint(REF)).toBe(overruledFingerprint(REF));
    expect(overruledFingerprint(REF)).not.toBe(overruledFingerprint("o/r#1"));
    expect(overruledFingerprint(REF)).toMatch(/^eo-[0-9a-f]{12}$/);
  });
});

describe("the GitHub backlog tier", () => {
  it("does not treat the ruling label as a lifecycle label", () => {
    expect(
      withoutRuling({
        ready: READY,
        human_needed: HUMAN_NEEDED,
        wrongly_escalated: LABEL,
      })
    ).toEqual({ ready: READY, human_needed: HUMAN_NEEDED });
    expect(withoutRuling(undefined)).toBeUndefined();
  });
});
