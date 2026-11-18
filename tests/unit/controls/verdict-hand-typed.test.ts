/**
 * A record typed into the evidence file is read by the same rules the
 * writer keeps an earlier record by.
 *
 * The writer drops an earlier record that no run could have written, and
 * holds the ones it keeps to the default lifetime. But a record typed in
 * after the last run has been through no writer, and the verdict read it as
 * it stood: an exercised pair at the pull-request moment, with a year's
 * lifetime, made a requirement conforming until the next run. So the rules
 * are applied on every read too: a known moment the entry is enforced at,
 * the digest the evidence file gives for what defines the checks, and never
 * more than the default lifetime.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_FRESHNESS_SECONDS,
  MAX_FRESHNESS_SECONDS,
} from "../../../src/controls/evidence-types.js";
import {
  controlAnswer,
  findingAnswer,
  type AnswerContext,
} from "../../../src/controls/verdict-answers.js";
import {
  entryServing,
  findingRecord,
  halfRecord,
  heldPair,
  locatedRecord,
  observedRecord,
  onPullRequests,
  OTHER_CHECKS_DIGEST,
  RECORDED_AT,
  SAMPLE_CHECKS,
  SOON_AFTER,
} from "./support/evidence-samples.js";
import { API, of, verdictOf } from "./support/verdict-run.js";

const PULL_REQUEST = "pull-request";
const UNKNOWN = "unknown";
const NO_EVIDENCE = "no-evidence";
const A_YEAR = { freshness_seconds: MAX_FRESHNESS_SECONDS };
const OTHER = { checks_digest: OTHER_CHECKS_DIGEST };
const DAY_MS = 24 * 60 * 60 * 1000;

/** The sample entry, enforced at commit only. */
const AT_COMMIT = entryServing(API);

/** The same entry, enforced on pull requests too. */
const ON_PULL_REQUESTS = onPullRequests(AT_COMMIT);

/** A requirement that needs exercised evidence, read a minute after. */
const CONTEXT: AnswerContext = {
  minimum: "exercised",
  kind: "gate",
  now: SOON_AFTER,
  checksDigest: SAMPLE_CHECKS.digest,
};

/**
 * A time some days after the samples were recorded.
 * @param days - How many days
 * @returns The time
 */
function daysAfter(days: number): Date {
  return new Date(Date.parse(RECORDED_AT) + days * DAY_MS);
}

describe("a pair typed in at the pull-request moment", () => {
  const typed = heldPair(API, "SI7", { moment: PULL_REQUEST, ...A_YEAR });

  it("counts for nothing when its entry is not enforced on pull requests", () => {
    const answer = controlAnswer(AT_COMMIT, typed, CONTEXT);

    expect(answer).toMatchObject({
      verdict: UNKNOWN,
      reason: NO_EVIDENCE,
      records: [],
    });
    expect(answer.detail).toContain(
      "it names a moment at which this control is not enforced"
    );
    expect(of(verdictOf([AT_COMMIT], typed))).toMatchObject({
      verdict: UNKNOWN,
      evidence: [],
    });
  });

  it("counts for nothing when it carries a digest other than the file's", () => {
    const other = heldPair(API, "SI7", { moment: PULL_REQUEST, ...OTHER });
    const answer = controlAnswer(ON_PULL_REQUESTS, other, CONTEXT);

    expect(answer).toMatchObject({ verdict: UNKNOWN, reason: NO_EVIDENCE });
    expect(answer.detail).toContain(
      "it was recorded when the checks were defined differently"
    );
    expect(of(verdictOf([ON_PULL_REQUESTS], other)).verdict).toBe(UNKNOWN);
  });

  it("is relied on for the default lifetime and no longer, whatever lifetime it states", () => {
    const within = of(verdictOf([ON_PULL_REQUESTS], typed, daysAfter(29)));
    const past = of(verdictOf([ON_PULL_REQUESTS], typed, daysAfter(31)));

    expect(within.verdict).toBe("conforming");
    expect(past).toMatchObject({ verdict: UNKNOWN, reason: "stale-evidence" });
    expect(past.detail).toContain(
      `it stopped being current at ${daysAfter(30).toISOString()}`
    );
  });

  it("gives the verdict a date it is current until that is thirty days on, not a year", () => {
    const verdict = verdictOf([ON_PULL_REQUESTS], typed);

    expect(verdict.current_until).toBe(
      new Date(
        Date.parse(RECORDED_AT) + DEFAULT_FRESHNESS_SECONDS * 1000
      ).toISOString()
    );
  });
});

describe("a record typed in at a moment no attest run speaks for", () => {
  it.each(["nightly", "post-tool", "pre-deploy:production"])(
    "counts for nothing at %s, even when the entry is enforced there",
    moment => {
      const enforced = {
        ...AT_COMMIT,
        enforcement_points: [
          ...AT_COMMIT.enforcement_points,
          { moment, level: "required", location: "scheduled-run" } as const,
        ],
      };
      const answer = controlAnswer(
        enforced,
        heldPair(API, "SI7", { moment }),
        CONTEXT
      );

      expect(answer).toMatchObject({ verdict: UNKNOWN, reason: NO_EVIDENCE });
      expect(answer.detail).toContain(
        "it names a moment at which no attest run records anything about a control"
      );
    }
  );

  it("cannot fail a control either: a record that does not count is not read", () => {
    const records = [
      ...heldPair(API),
      halfRecord(API, "violation", "SI7", {
        moment: "nightly",
        result: "failed",
      }),
    ];

    expect(controlAnswer(AT_COMMIT, records, CONTEXT)).toMatchObject({
      verdict: "conforming",
      records: heldPair(API),
    });
  });
});

describe("the records a control's answer is read from", () => {
  it("are the ones that count, and the rest are set aside without a word when some do", () => {
    const records = [
      ...heldPair(API),
      ...heldPair(API, "SI7", { moment: PULL_REQUEST, ...OTHER }),
      observedRecord(API, "SI7", { result: "failed", ...OTHER }),
    ];

    expect(controlAnswer(ON_PULL_REQUESTS, records, CONTEXT)).toMatchObject({
      verdict: "conforming",
      detail: "",
      records: heldPair(API),
    });
  });

  it("still fail a control on a record that counts", () => {
    const records = [
      ...heldPair(API),
      observedRecord(API, "SI7", { result: "failed" }),
    ];

    expect(controlAnswer(ON_PULL_REQUESTS, records, CONTEXT).verdict).toBe(
      "non-conforming"
    );
  });

  it("say there is no proof on record when there is no record at all", () => {
    expect(controlAnswer(AT_COMMIT, [], CONTEXT).detail).toBe(
      `No proof of the control ${API} is on record for this requirement. Run the attest step.`
    );
  });
});

describe("a record of an audit finding typed in under another digest", () => {
  const context: AnswerContext = {
    ...CONTEXT,
    minimum: "observed",
    kind: "artifact",
  };

  it("counts for nothing", () => {
    const answer = findingAnswer(locatedRecord("AC1.1", OTHER), context);

    expect(answer).toMatchObject({
      verdict: UNKNOWN,
      reason: NO_EVIDENCE,
      records: [],
    });
    expect(answer.detail).toContain(
      "Evidence is on file for the audit's finding about the whole repository and none of it counts"
    );
  });

  it("cannot make a requirement not apply, or fail it", () => {
    const na = findingRecord("AC1.1", "not-applicable", {
      reason: "not-applicable",
      ...OTHER,
    });
    const failed = findingRecord("AC1.1", "failed", OTHER);

    expect(findingAnswer(na, context).verdict).toBe(UNKNOWN);
    expect(findingAnswer(failed, context).verdict).toBe(UNKNOWN);
  });

  it("counts under the file's digest, for the default lifetime at most", () => {
    const located = locatedRecord("AC1.1", A_YEAR);

    expect(findingAnswer(located, context).verdict).toBe("conforming");
    expect(
      findingAnswer(located, { ...context, now: daysAfter(31) })
    ).toMatchObject({ verdict: UNKNOWN, reason: "stale-evidence" });
  });
});
