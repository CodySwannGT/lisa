/**
 * Agent-authored GitHub gate actions say which lane performed them (#3625).
 *
 * ## The defect
 *
 * Lisa lanes share the operator's GitHub credential, so a merge, a review
 * dismissal and an auto-merge change are all recorded as actions by the
 * account owner. With one shared key no actor field can carry lane identity —
 * `botActor` is null and the actor resolves to the key owner — so the message
 * body is the only channel there is, and Lisa wrote nothing into it.
 *
 * ## The trap these cases exist to pin
 *
 * The obvious identifier is the session id, and it is precisely what #3731
 * forbids publishing — while one of the artifacts attribution is written into
 * is a merge commit message, in a public repository. So the discriminating
 * assertion is not "a trailer appeared" but "a trailer appeared AND carries no
 * session identifier". A formatter that attributed with the session would
 * satisfy every attribution case and ship the leak.
 * @module tests/unit/strategies/lane-attribution
 */
import { describe, expect, it } from "vitest";

import {
  TRAILER_MARKER,
  assertNoSessionIdentifier,
  derivedLane,
  normalizeLane,
  resolveLane,
  stripLaneTrailer,
  withLaneTrailer,
} from "../../../plugins/src/base/scripts/lane-attribution.mjs";

const LANE = "lane-c";
const OWNER = "octocat";
const SESSION = "session_014Jh4nA3g7v8xSd2s1PdyzQ";
const UUID = "01a0632b-ebcb-7b41-b34d-41f7bd828e20";
const DISMISSAL = "Addressed; threads resolved.";

describe("which lane, resolved without naming the session", () => {
  it("prefers the operator's chosen lane name", () => {
    expect(
      resolveLane({ LISA_LANE: LANE, CLAUDE_SESSION_ID: SESSION })
    ).toEqual({ lane: LANE, source: "LISA_LANE" });
  });

  it("falls back to a one-way digest rather than the session id", () => {
    const resolved = resolveLane({ CLAUDE_SESSION_ID: SESSION });

    expect(resolved?.source).toBe("derived-from-session");
    expect(resolved?.lane).toMatch(/^auto-[0-9a-f]{8}$/);
    // The whole point: distinguishes lanes, discloses nothing.
    expect(resolved?.lane).not.toContain(SESSION);
  });

  it("gives concurrent lanes different tokens", () => {
    expect(derivedLane("session-a")).not.toBe(derivedLane("session-b"));
  });

  it("resolves nothing when nothing identifies the process", () => {
    expect(resolveLane({})).toBeNull();
  });

  it("refuses a lane label that is not safe to publish", () => {
    expect(normalizeLane("lane c/../../etc")).toBe("");
    expect(normalizeLane("")).toBe("");
    expect(normalizeLane("lane-c")).toBe("lane-c");
  });
});

describe("a session identifier never reaches a published artifact", () => {
  it("refuses a session URL", () => {
    expect(() =>
      assertNoSessionIdentifier(`see https://claude.ai/code/${SESSION}`)
    ).toThrow(/refuses to publish a session identifier/);
  });

  it("refuses a bare session token with no URL around it", () => {
    expect(() =>
      assertNoSessionIdentifier(`Codex (session ${SESSION})`)
    ).toThrow(/refuses to publish a session identifier/);
  });

  it("refuses a bare session UUID", () => {
    // The shape actually observed leaking into a public issue comment.
    expect(() => assertNoSessionIdentifier(`session ${UUID}`)).toThrow(
      /refuses to publish a session identifier/
    );
  });

  it("passes ordinary action text through untouched", () => {
    // The control. A refusal that fired on everything would be satisfied by
    // the cases above while making attribution unusable.
    expect(assertNoSessionIdentifier(DISMISSAL)).toBe(DISMISSAL);
  });
});

describe("the trailer says who acted, and that GitHub will not", () => {
  it("attributes a review dismissal without losing its reason", () => {
    const attributed = withLaneTrailer(DISMISSAL, { lane: LANE }, OWNER);

    expect(attributed).toContain(DISMISSAL);
    expect(attributed).toContain(`${TRAILER_MARKER} ${LANE}`);
    // Without this sentence a reader who sees the operator's avatar has no
    // reason to doubt it.
    expect(attributed).toContain(
      `GitHub shows ${OWNER} as the actor because every lane shares that credential`
    );
  });

  it("carries no session identifier", () => {
    const attributed = withLaneTrailer(
      DISMISSAL,
      resolveLane({ CLAUDE_SESSION_ID: SESSION }),
      OWNER
    );

    expect(attributed).toContain(TRAILER_MARKER);
    expect(() => assertNoSessionIdentifier(attributed)).not.toThrow();
    expect(attributed).not.toContain(SESSION);
  });

  it("attributes an empty body, for an action GitHub gives no text field", () => {
    // Enabling auto-merge has no message anywhere, so the comment Lisa posts
    // is the entire artifact.
    expect(withLaneTrailer("", { lane: LANE }, OWNER)).toBe(
      withLaneTrailer("", { lane: LANE }, OWNER)
    );
    expect(withLaneTrailer("", { lane: LANE }, OWNER)).toContain(
      `${TRAILER_MARKER} ${LANE}`
    );
  });

  it("leaves the body alone when no lane is resolved", () => {
    // A placeholder saying "unknown lane" tells a reader nothing, and a
    // trailer that is sometimes meaningless trains readers to skip all of them.
    expect(withLaneTrailer(DISMISSAL, null, OWNER)).toBe(DISMISSAL);
  });
});

describe("retries do not stack trailers", () => {
  it("keeps exactly one trailer when the body already carries this lane's", () => {
    const once = withLaneTrailer(DISMISSAL, { lane: LANE }, OWNER);
    const twice = withLaneTrailer(once, { lane: LANE }, OWNER);

    expect(twice).toBe(once);
    expect(twice.split(TRAILER_MARKER)).toHaveLength(2);
  });

  it("replaces ANOTHER lane's trailer rather than appending beside it", () => {
    // Lane-agnostic dedupe. Matching only this lane's marker lets a body
    // signed by one lane collect a second trailer, which reads as two lanes
    // having acted — worse than no attribution at all.
    const byOther = withLaneTrailer(DISMISSAL, { lane: "lane-b" }, OWNER);
    const byThis = withLaneTrailer(byOther, { lane: LANE }, OWNER);

    expect(byThis.split(TRAILER_MARKER)).toHaveLength(2);
    expect(byThis).toContain(`${TRAILER_MARKER} ${LANE}`);
    expect(byThis).not.toContain("lane-b");
    expect(byThis).toContain(DISMISSAL);
  });

  it("strips a trailer back off without eating the body", () => {
    expect(
      stripLaneTrailer(withLaneTrailer(DISMISSAL, { lane: LANE }, OWNER))
    ).toBe(DISMISSAL);
  });

  it("leaves a body carrying no trailer untouched", () => {
    expect(stripLaneTrailer(DISMISSAL)).toBe(DISMISSAL);
  });
});
