/**
 * Every two-channel coupling records whether it can see a STALE artifact (#3687).
 *
 * `scripts/two-channel-couplings.json` registers every place a reusable workflow
 * delivered at `@main` reads a file delivered on the `lisa apply` channel. Every
 * entry reasoned about one hazard — the read path being ABSENT — and **absence
 * is the benign half**: an absent script skips, posts no context, and an absent
 * required context is not a red one.
 *
 * The harmful half is PRESENT-AND-OLD. A gate that actively posts a verdict
 * derived from superseded logic is believed by every reader, and #3477 measured
 * that on one entry: a copy six weeks and a major behind satisfied the gate's
 * only staleness probe in silence, because the probe was a single hardcoded
 * capability floor and could not answer "how old".
 *
 * ## Why a required field rather than a sweep
 *
 * A sweep decays the moment somebody adds entry 25. The refusal below is the
 * deliverable: an unclassified coupling fails the gate, so a new one cannot
 * silently inherit "nobody looked", and the audit of the existing entries is
 * that field's FIRST EXECUTION rather than the thing being shipped.
 *
 * ## Two fields, deliberately
 *
 * `detects` is an OBSERVATION of what the coupling can do; `reason` is the
 * DECISION about whether that is acceptable. A coupling that cannot see age and
 * is fine that way (an advisory read, an artifact with no verdict-bearing logic)
 * is a different fact from one that cannot see age and should. Collapsing them
 * into a single "not-needed" token would let an unexamined default wear the same
 * word as a considered exemption — the defect one level up.
 *
 * MEASURED against `origin/main` before this change: 24 registered couplings,
 * **zero** carrying any staleness field, and four with a real handshake the
 * registry did not record. The four were confirmed by reading each workflow's
 * guard: a first pass using a keyword window falsely reported handshakes for
 * `nightly-e2e-suites.schema.json` and `check-skipped-required-checks.mjs`, both
 * of which merely sit near an unrelated handshake's prose.
 * @module tests/unit/scripts/two-channel-staleness-classification
 */
import { describe, expect, it } from "vitest";

import {
  type StalenessClassification,
  stalenessCoverage,
  stalenessProblems,
} from "../../../scripts/generate-two-channel-couplings.js";

/** A reason long enough to be a decision rather than a label. */
const REASON =
  "Files a tracker issue after a nightly failure; it posts no required check and gates no merge.";

/** The key shape the registry uses, `<workflow>::<path>`. */
const KEY = "quality.yml::scripts/check-threshold-ratchet.mjs";

/** A second live key, so "orphaned" can be told from "unclassified". */
const OTHER_KEY = "quality.yml::scripts/lisa-work-item.mjs";

/** The `detects` token for a coupling that can only see presence. */
const EXISTENCE_ONLY = "existence-only";

/** The `detects` token for a coupling that asks for a contract version. */
const VERSION_HANDSHAKE = "version-handshake";

/** A key naming a coupling nothing reads any more. */
const GONE_KEY = "gone.yml::scripts/removed.mjs";

/** The classifications map, as the ledger stores it. */
type Recorded = Readonly<Record<string, StalenessClassification>>;

/**
 * A minimal report carrying the given live coupling keys.
 *
 * A `package-backed` entry is always included: those are omitted from the ledger
 * by the generator, so requiring a classification for one would be a demand
 * nobody can satisfy.
 *
 * @param keys - Coupling keys that appear in the ledger
 * @returns A report shaped as the classifier consumes it
 */
function reportWith(keys: readonly string[]): {
  readonly entries: readonly {
    readonly key: string;
    readonly verdict: string;
  }[];
} {
  return {
    entries: [
      ...keys.map(key => ({ key, verdict: "apply-lagged" })),
      { key: "quality.yml::scripts/packaged.mjs", verdict: "package-backed" },
    ],
  };
}

/**
 * Problems reported for the given live keys and recorded classifications.
 *
 * @param keys - Coupling keys that appear in the ledger
 * @param staleness - The recorded classifications
 * @returns The problem paragraphs
 */
function problems(
  keys: readonly string[],
  staleness: Recorded
): readonly string[] {
  return stalenessProblems(reportWith(keys), staleness);
}

/**
 * The fleet coverage sentence for the given keys and classifications.
 *
 * @param keys - Coupling keys that appear in the ledger
 * @param staleness - The recorded classifications
 * @returns The coverage sentence
 */
function coverage(keys: readonly string[], staleness: Recorded): string {
  return stalenessCoverage(reportWith(keys), staleness);
}

describe("an unclassified coupling cannot be added", () => {
  it("refuses a live coupling carrying no classification, and names it", () => {
    // The whole point: this is what stops entry 25 inheriting "nobody looked".
    const found = problems([KEY], {});

    expect(found).toHaveLength(1);
    expect(found[0]).toContain("UNCLASSIFIED COUPLING");
    expect(found[0]).toContain(KEY);
  });

  it("says what to do about it, not only that it refused", () => {
    expect(problems([KEY], {}).join(" ")).toContain("version-handshake");
  });

  it("demands nothing for a package-backed coupling, which the ledger omits", () => {
    expect(problems([], {})).toEqual([]);
  });
});

describe("a classification must be well formed and reasoned", () => {
  it("refuses a `detects` value outside the vocabulary", () => {
    const found = problems([KEY], {
      [KEY]: { detects: "probably-fine" } as unknown as StalenessClassification,
    });

    expect(found[0]).toContain("MALFORMED CLASSIFICATION");
  });

  it("refuses a non-handshake carrying no reason", () => {
    const found = problems([KEY], { [KEY]: { detects: EXISTENCE_ONLY } });

    expect(found[0]).toContain("UNREASONED CLASSIFICATION");
  });

  it("refuses a reason that is a label rather than a decision", () => {
    const found = problems([KEY], {
      [KEY]: { detects: EXISTENCE_ONLY, reason: "n/a" },
    });

    expect(found[0]).toContain("UNREASONED CLASSIFICATION");
  });

  it("does not demand a reason from a coupling that already handshakes", () => {
    // A handshake justifies itself; making it write prose too would be a
    // requirement with no content.
    expect(problems([KEY], { [KEY]: { detects: VERSION_HANDSHAKE } })).toEqual(
      []
    );
  });
});

describe("a classification cannot outlive the coupling it describes", () => {
  it("refuses a classification naming nothing live", () => {
    // The hazard the ledger already refuses for a stale ratification: a
    // judgement left behind after its subject is gone is inherited for free by
    // the next path that happens to match the key.
    const found = problems([KEY], {
      [KEY]: { detects: EXISTENCE_ONLY, reason: REASON },
      [GONE_KEY]: { detects: EXISTENCE_ONLY, reason: REASON },
    });

    expect(found).toHaveLength(1);
    expect(found[0]).toContain("STALE CLASSIFICATION");
    expect(found[0]).toContain(GONE_KEY);
  });
});

describe("the generator reports fleet staleness coverage", () => {
  it("states how many couplings can see age and how many see absence only", () => {
    const line = coverage([KEY, OTHER_KEY], {
      [KEY]: { detects: EXISTENCE_ONLY, reason: REASON },
      [OTHER_KEY]: { detects: VERSION_HANDSHAKE },
    });

    expect(line).toContain(
      "1 of 2 coupling(s) can see how old the artifact is"
    );
    expect(line).toContain("1 detect absence only");
  });

  it("counts a capability probe apart from a handshake", () => {
    // The #3477 defect: a probe detects staleness at exactly one floor and is
    // invisible above it, so folding it into the handshake count would report
    // coverage the fleet does not have.
    const line = coverage([KEY], {
      [KEY]: { detects: "capability-probe", reason: REASON },
    });

    expect(line).toContain("0 of 1 coupling(s) can see how old");
    expect(line).toContain("1 detect it at one floor only");
  });
});

describe("rejection control: a fully classified registry is silent", () => {
  it("reports no problem when every live coupling is classified", () => {
    // Without this every assertion above is satisfied by a classifier that
    // refuses everything.
    expect(
      problems([KEY, OTHER_KEY], {
        [KEY]: { detects: EXISTENCE_ONLY, reason: REASON },
        [OTHER_KEY]: { detects: VERSION_HANDSHAKE },
      })
    ).toEqual([]);
  });
});
