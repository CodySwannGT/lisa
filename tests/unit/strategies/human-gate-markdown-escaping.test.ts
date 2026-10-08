/** Stored Markdown escapes must preserve holds, authorized releases and precision. */
import { describe, expect, it } from "vitest";

import {
  HUMAN_GATE_NOTE_MARKER,
  HUMAN_GATE_RELEASE_NOTE_MARKER,
  NORMALIZATION_HOLD_NOTE_MARKER,
  bodyDeclaresHold,
  classifyReadyCandidate,
  humanGateHolds,
  humanGateMentions,
  humanGateReleases,
  humanGateVerdict,
  normalizeProviderMarkdown,
  planHumanGateRelease,
} from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";

const REASON = "pricing_tier-v2";
const HOLD = `<!-- [lisa-human-gate] reason=${REASON} -->`;
const RELEASE = `[lisa-human-gate-release] reason=${REASON}`;
const TRUSTED = ["owner-1"];
const NEEDED = "human-needed";
const READY = "status:ready";

/**
 * The provider's bracket and emphasis escaping, independently specified.
 * @param text - Original body
 * @returns Provider-stored punctuation escapes
 */
function stored(text: string): string {
  return text
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("_", "\\_")
    .replaceAll("*", "\\*")
    .replaceAll("-", "\\-");
}

/**
 * A Linear comment with the real normalized authorization fields.
 * @param body - Stored comment text
 * @param id - Stable provider author ID
 * @returns Provider comment and trusted human identity
 */
function comment(body: string, id = TRUSTED[0]) {
  return { body, user: { id }, botActor: null };
}

describe("human gates after provider Markdown escaping", () => {
  it.each([
    "\\[lisa-human-gate\\] reason=prioritization",
    "<!-- \\[lisa-human-gate\\] reason=prioritization -->",
    "> \\[lisa-human-gate\\] reason=prioritization",
    "\\* \\[lisa-human-gate\\] reason=prioritization",
  ])("keeps the stored declaration out of the ready queue: %s", body => {
    expect(bodyDeclaresHold(body)).toBe(true);
    expect(humanGateMentions(body)).toEqual({
      total: 1,
      declared: 1,
      demoted: 0,
    });
    expect(humanGateHolds(body)).toEqual(["prioritization"]);
    expect(classifyReadyCandidate({ body })).toEqual({
      claimable: false,
      reason: "human-gate",
      humanGated: true,
    });
  });

  it.each([
    { body: HOLD, release: RELEASE },
    { body: stored(HOLD), release: RELEASE },
    { body: HOLD, release: stored(RELEASE) },
    { body: stored(HOLD), release: stored(RELEASE) },
  ])("pairs raw and stored reason keys: %j", ({ body, release }) => {
    const input = {
      body,
      labels: [NEEDED],
      comments: [comment(release)],
      trustedHumanActorIds: TRUSTED,
      readyLabel: READY,
      lifecycleLabels: [READY, NEEDED],
    };
    expect(humanGateHolds(body)).toEqual([REASON]);
    expect(humanGateReleases(input.comments, TRUSTED)).toEqual([REASON]);
    expect(humanGateVerdict(input).held).toBe(false);
    expect(planHumanGateRelease(input).actions).toEqual({
      removeHumanNeededLabel: true,
      addReadyLabel: READY,
      comment: true,
    });
  });

  it.each([
    comment(stored(RELEASE), "untrusted"),
    { ...comment(stored(RELEASE)), botActor: { id: "bot-1" } },
    { body: stored(RELEASE) },
  ])("does not let stored text authorize its release author: %j", release => {
    expect(
      humanGateVerdict({
        body: stored(HOLD),
        comments: [release],
        trustedHumanActorIds: TRUSTED,
      }).held
    ).toBe(true);
  });

  it("keeps another reason outstanding", () => {
    expect(
      humanGateVerdict({
        body: stored(HOLD),
        comments: [comment(stored("[lisa-human-gate-release] reason=other"))],
        trustedHumanActorIds: TRUSTED,
      }).held
    ).toBe(true);
  });

  it.each([
    "A discussion of \\[lisa-human-gate\\]",
    "`\\[lisa-human-gate\\]`",
    "```\n\\[lisa-human-gate\\]\n```",
  ])("keeps escaped examples as mentions: %s", body => {
    expect(humanGateMentions(body)).toEqual({
      total: 1,
      declared: 0,
      demoted: 1,
    });
    expect(bodyDeclaresHold(body)).toBe(false);
    expect(classifyReadyCandidate({ body }).claimable).toBe(true);
  });

  it.each([
    HUMAN_GATE_NOTE_MARKER,
    HUMAN_GATE_RELEASE_NOTE_MARKER,
    NORMALIZATION_HOLD_NOTE_MARKER,
  ])(
    "does not turn a stored bookkeeping note into a hold or release: %s",
    note => {
      expect(normalizeProviderMarkdown(stored(note))).toBe(note);
      expect(humanGateHolds(stored(note))).toEqual([]);
      expect(humanGateReleases([comment(stored(note))], TRUSTED)).toEqual([]);
    }
  );

  it("decodes one layer rather than repeatedly promoting literal escapes", () => {
    const literal = stored(stored(HOLD));
    expect(bodyDeclaresHold(literal)).toBe(false);
    expect(humanGateMentions(literal)).toEqual({
      total: 0,
      declared: 0,
      demoted: 0,
    });
  });

  it("leaves non-punctuation escapes and unrelated provider prose intact", () => {
    expect(normalizeProviderMarkdown("plain \\q and \\é")).toBe(
      "plain \\q and \\é"
    );
  });
});
