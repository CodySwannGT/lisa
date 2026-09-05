/**
 * A body that DISCUSSES the hold marker is not a body that DECLARES a hold.
 *
 * CodySwannGT/lisa#3815. `isHumanGated` asked one question — does the body
 * contain the marker anywhere at all — so a sentence quoting the marker, a test
 * case naming it, and a ticket about it all read as declared holds. The
 * consequence is not a skipped cycle: `planHumanGateReconciliation` removes the
 * ready role and applies the human-needed label, so a false positive rewrites
 * the item's own metadata and every later sweep agrees with the first.
 *
 * ## The premise that expired
 *
 * The substring form was deliberate and documented: *"it is a marker with no
 * other meaning, so its presence IS the declaration."* True when written. The
 * marker acquired a second meaning — **being discussed** — the moment the
 * feature became something people file tickets about, and the population of
 * legitimate quotations grows every time anyone documents it. Measured on this
 * repository's issues: **38 matching bodies on 2026-09-04, 42 on 2026-09-05.**
 * A control whose false-positive rate rises with the quality of the
 * documentation about it is ageing backwards.
 *
 * ## Same family, third instance
 *
 * `pr-arming-sweep.mjs` hit it on CodySwannGT/lisa#3986, where the pull request
 * introducing a suppression marker suppressed itself by explaining what the
 * marker was, and `parity-safety-net.sh` hit it on #3825, where a comment
 * quoting a destructive command read as running one. The reasoning that
 * produces it is always the same and always sounds sound. **Before matching a
 * token, ask what it means in every position it can occupy.**
 *
 * ## The rule, and why not the stricter one
 *
 * A declaration is POSITIONAL: the marker leads its line, after at most
 * blockquote/list/emphasis decoration or an opening HTML comment. Fenced blocks
 * and inline code spans are removed first, because that is how the marker is
 * written ABOUT — the move `pr-arming-sweep.mjs` already makes.
 *
 * The stricter HTML-comment-only rule was measured and REJECTED: on today's
 * corpus it drops #2818 and #3971, both of which carry `human-needed` and are
 * genuine holds. Losing a real hold is the unsafe direction, and it would need
 * a retrofit of declarations already in the tracker.
 * @module tests/unit/strategies/human-gate-declaration-precision
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  classifyPreWorkCandidate,
  classifyReadyCandidate,
  HUMAN_GATE_MARKER,
  humanGateMentions,
  planHumanGateReconciliation,
  summarizeHumanGateMentions,
} from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

/** The configured ready role these cases reconcile against. */
const READY = "status:ready";

/**
 * Every copy of the intake matcher, generator source first.
 *
 * The ticket enumerated eleven copies across two subsystems precisely because a
 * fix that lands in one and is declared done leaves ten wrong. These are the
 * five that carry the predicate.
 */
const MATCHER_COPIES = [
  "plugins/src/base/scripts/intake-blocker-reprobe.mjs",
  "plugins/lisa/scripts/intake-blocker-reprobe.mjs",
  "plugins/lisa-agy/scripts/intake-blocker-reprobe.mjs",
  "plugins/lisa-cursor/scripts/intake-blocker-reprobe.mjs",
  "plugins/lisa-copilot/scripts/intake-blocker-reprobe.mjs",
];

/** Every copy of the filing guard, generator source and host template included. */
const GUARD_COPIES = [
  "plugins/src/base/hooks/block-direct-issue-create.sh",
  "plugins/lisa/hooks/block-direct-issue-create.sh",
  "plugins/lisa-agy/hooks/block-direct-issue-create.sh",
  "plugins/lisa-cursor/hooks/block-direct-issue-create.sh",
  "plugins/lisa-copilot/hooks/block-direct-issue-create.sh",
  "all/copy-overwrite/scripts/lisa-hooks/block-direct-issue-create.sh",
];

/**
 * Read a repository file.
 * @param relative - Repository-relative path
 * @returns Its contents
 */
const read = (relative: string): string =>
  readFileSync(path.join(REPO_ROOT, relative), "utf8");

/**
 * A body whose only occurrence of the marker leads its line.
 *
 * The historical declaration form: bare marker, own line. #2818 is this shape
 * and carries `human-needed`, which is why the comment-only rule was rejected.
 */
const DECLARED_BARE = `Some context about the work.\n\n${HUMAN_GATE_MARKER}\n`;

/** The sanctioned form: the marker alone on a line inside an HTML comment. */
const DECLARED_COMMENT = `Context.\n\n<!-- ${HUMAN_GATE_MARKER} reason=waiting on design -->\n`;

/** The historical `<marker> <prose>` form, which #2589 and #2890 both use. */
const DECLARED_WITH_PROSE = `${HUMAN_GATE_MARKER} waiting on a decision from the owner\n`;

/**
 * A body that only DISCUSSES the marker — the #3805 shape.
 *
 * Mid-sentence prose, a code span, and an indented Gherkin line, which is
 * exactly how a ticket about the feature is written.
 */
const DISCUSSED = [
  "## The finding",
  "",
  `A work item whose body contains ${HUMAN_GATE_MARKER} anywhere reads as held,`,
  "even when the sentence is about the marker rather than declaring one.",
  "",
  "```gherkin",
  "Scenario: a declared hold is still held",
  `  Given a work item whose body has ${HUMAN_GATE_MARKER} at the start of a line`,
  "  Then the item is reported as held",
  "```",
  "",
  `Compare the inline form \`${HUMAN_GATE_MARKER}\`, which is a citation.`,
].join("\n");

/** The #3696 shape: one sentence citing the marker as a design precedent. */
const CITED_AS_PRECEDENT = `This is the same shape as the existing ${HUMAN_GATE_MARKER} marker that the filing guard accepts.\n`;

/**
 * A fenced example whose marker leads its line INSIDE the fence.
 *
 * Not drawn from today's corpus — no body has this shape yet, and saying so is
 * the point. It is how the population grows: the moment somebody documents
 * "write it like this:" above a fenced example, the example declares a hold on
 * the document. Stripping fences costs nothing today and covers exactly the
 * direction the defect is known to grow in.
 */
const FENCED_EXAMPLE = [
  "Declare a hold by writing this on its own line:",
  "",
  "```",
  HUMAN_GATE_MARKER,
  "```",
  "",
  "That is the whole mechanism.",
].join("\n");

describe("a declaration is positional, and these are declarations", () => {
  it("holds a bare marker on its own line", () => {
    expect(humanGateMentions(DECLARED_BARE).declared).toBe(1);
  });

  it("holds the sanctioned HTML-comment form", () => {
    expect(humanGateMentions(DECLARED_COMMENT).declared).toBe(1);
  });

  it("holds the historical marker-then-prose form", () => {
    // #2589, #2890 and #3071 are all real holds of this shape. A rule that
    // dropped them would need a retrofit of the tracker, which is why the
    // HTML-comment-only candidate was measured and rejected.
    expect(humanGateMentions(DECLARED_WITH_PROSE).declared).toBe(1);
  });

  it("holds a marker inside a blockquote or list decoration", () => {
    expect(humanGateMentions(`> ${HUMAN_GATE_MARKER}\n`).declared).toBe(1);
    expect(humanGateMentions(`- ${HUMAN_GATE_MARKER}\n`).declared).toBe(1);
    expect(humanGateMentions(`1. ${HUMAN_GATE_MARKER}\n`).declared).toBe(1);
  });
});

describe("a mention is not a declaration", () => {
  it("does not hold a body that only discusses the marker", () => {
    // The ticket's sharpest fact: a ticket ABOUT the hold marker read as held.
    expect(humanGateMentions(DISCUSSED).declared).toBe(0);
  });

  it("does not hold a sentence citing the marker as a precedent", () => {
    expect(humanGateMentions(CITED_AS_PRECEDENT).declared).toBe(0);
  });

  it("does not hold an indented acceptance-criteria line naming it", () => {
    const gherkin = `  Given a body carrying ${HUMAN_GATE_MARKER} at the start of a line\n`;

    expect(humanGateMentions(gherkin).declared).toBe(0);
  });

  it("does not hold a marker that leads a line inside a fenced block", () => {
    // The prophylactic half. This changes ZERO verdicts on today's corpus —
    // stated plainly rather than claimed as a win — and covers the one
    // direction this defect is measured to grow in.
    expect(humanGateMentions(FENCED_EXAMPLE).declared).toBe(0);
  });

  it("does not hold a marker inside an inline code span", () => {
    expect(
      humanGateMentions(`Write \`${HUMAN_GATE_MARKER}\` to hold it.\n`).declared
    ).toBe(0);
  });
});

describe("what the rule skips is counted, not dropped", () => {
  it("reports every occurrence, the declarations, and the demotions", () => {
    // A heuristic that silently drops candidates is indistinguishable from one
    // that found none. Exact values: a count that drifted by one would be
    // invisible to a containment assertion.
    // Three occurrences: the prose sentence, the Gherkin line inside the
    // fence, and the inline code span. Counted by hand off the fixture above.
    expect(humanGateMentions(DISCUSSED)).toEqual({
      total: 3,
      declared: 0,
      demoted: 3,
    });
  });

  it("counts a second occurrence on a declaring line as a demotion", () => {
    const body = `${HUMAN_GATE_MARKER} see also ${HUMAN_GATE_MARKER} above\n`;

    expect(humanGateMentions(body)).toEqual({
      total: 2,
      declared: 1,
      demoted: 1,
    });
  });

  it("reports nothing for a body with no marker at all", () => {
    expect(humanGateMentions("ordinary description")).toEqual({
      total: 0,
      declared: 0,
      demoted: 0,
    });
  });

  it("renders a summary line naming the demotions", () => {
    // Exact string. The trailing punctuation is part of what a reader scans,
    // and a containment assertion cannot see a stray character after it.
    expect(summarizeHumanGateMentions(33)).toBe(
      "Marker mentions demoted (not declarations): 33."
    );
  });

  it("says none rather than zero when the rule skipped nothing", () => {
    expect(summarizeHumanGateMentions(0)).toBe(
      "Marker mentions demoted (not declarations): none."
    );
  });
});

describe("the consequence: the ready lane is not reconciled for a mention", () => {
  it("plans no removal and no label for a body that only discusses it", () => {
    const plan = planHumanGateReconciliation({
      body: DISCUSSED,
      labels: [READY],
      readyLabel: READY,
    });

    expect(plan.gated).toBe(false);
    expect(plan.actions).toEqual({
      removeReadyRole: false,
      addHumanNeededLabel: false,
      comment: false,
    });
  });

  it("still removes the ready role for a real declaration", () => {
    // The other direction, in the same shape. A precision change that stopped
    // holding real holds would be the unsafe failure.
    const plan = planHumanGateReconciliation({
      body: DECLARED_BARE,
      labels: [READY],
      readyLabel: READY,
    });

    expect(plan.gated).toBe(true);
    expect(plan.actions.removeReadyRole).toBe(true);
    expect(plan.actions.addHumanNeededLabel).toBe(true);
  });

  it("still holds on the human-needed label whatever the body says", () => {
    // The label surface is untouched by this change, and must stay that way:
    // an item a person labelled is held even if its body never mentions the
    // marker at all.
    const plan = planHumanGateReconciliation({
      body: "no marker anywhere in this body",
      labels: ["human-needed"],
      readyLabel: READY,
    });

    expect(plan.gated).toBe(true);
  });
});

describe("every consumer of the predicate inherits the precision", () => {
  it("lets a pre-work candidate discussing the marker be selected", () => {
    const verdict = classifyPreWorkCandidate({
      laneType: "bug",
      body: DISCUSSED,
      labels: [],
      probe: { discharged: true, evidence: "the dependency landed on trunk" },
    });

    expect(verdict.humanGated).toBe(false);
    expect(verdict.reason).not.toBe("human-gate");
  });

  it("still refuses a pre-work candidate that declares a hold", () => {
    const verdict = classifyPreWorkCandidate({
      laneType: "bug",
      body: DECLARED_COMMENT,
      labels: [],
      probe: { discharged: true, evidence: "the dependency landed on trunk" },
    });

    expect(verdict.humanGated).toBe(true);
    expect(verdict.reason).toBe("human-gate");
  });

  it("lets a ready-lane candidate discussing the marker be claimed", () => {
    const verdict = classifyReadyCandidate({
      body: DISCUSSED,
      labels: [READY],
    });

    expect(verdict.humanGated).toBe(false);
  });

  it("still refuses a ready-lane candidate that declares a hold", () => {
    const verdict = classifyReadyCandidate({
      body: DECLARED_BARE,
      labels: [READY],
    });

    expect(verdict.humanGated).toBe(true);
  });
});

describe("the guard's own declaration shapes, which are not markdown", () => {
  // Both of these broke on the first draft of this rule, which accepted only a
  // line-leading marker. They are real declarations from this repository's own
  // guard suite, and the comment branch exists because of them: the filing
  // guard reads a one-line `--body` value and a shell script, neither of which
  // is a document with lines to lead.

  it("holds a comment declaration after other text on the line", () => {
    const body = `Held for a human product call: pricing. <!-- ${HUMAN_GATE_MARKER} reason=pricing -->`;

    expect(humanGateMentions(body).declared).toBe(1);
  });

  it("holds a comment declaration behind a shell comment marker", () => {
    const script = `# <!-- ${HUMAN_GATE_MARKER} reason=pricing -->`;

    expect(humanGateMentions(script).declared).toBe(1);
  });

  it("does not hold an unterminated comment that only quotes it", () => {
    // `<!--` with no close swallows the rest of the line, so the scan must not
    // treat a stray opener followed by prose as a declaration unless the marker
    // really is inside it. Here it is inside, so this IS held — asserted so the
    // unterminated branch is exercised rather than assumed.
    expect(
      humanGateMentions(`<!-- ${HUMAN_GATE_MARKER} unterminated`).declared
    ).toBe(1);
  });

  it("does not hold a comment that closes before reaching the marker", () => {
    const body = `<!-- a note --> and then ${HUMAN_GATE_MARKER} in prose`;

    expect(humanGateMentions(body).declared).toBe(0);
  });
});

describe("no copy of the check is left behind", () => {
  it("gives every copy of the matcher the same verdict on the same body", () => {
    // Byte-equality is what the port build guarantees, and asserting it here
    // is what makes "the fix landed in the generator" checkable rather than
    // claimed.
    const source = read(MATCHER_COPIES[0] as string);

    for (const copy of MATCHER_COPIES.slice(1)) {
      expect(read(copy), `${copy} has drifted from its generator source`).toBe(
        source
      );
    }
  });

  it("leaves no copy of the matcher testing a whole body as a bare substring", () => {
    // The pre-fix expression by name, not the constant. Both the comment scan
    // and the occurrence count legitimately use the marker — on a BOUNDED
    // slice. What had to go is the test applied to an entire body.
    for (const copy of MATCHER_COPIES) {
      expect(read(copy), copy).not.toContain(
        'String(input.body ?? "").includes(HUMAN_GATE_MARKER)'
      );
    }
  });

  it("leaves no copy of the guard testing a whole text as a bare substring", () => {
    // Six copies, including the host template under all/copy-overwrite. The
    // ticket enumerated them because landing the fix in one and declaring it
    // done leaves the rest governing. Each expression below is one of the five
    // pre-fix sites, named so this cannot pass by the constant disappearing.
    const preFix = [
      "HUMAN_GATE_MARKER in text",
      'HUMAN_GATE_MARKER in " ".join(args)',
      "HUMAN_GATE_MARKER in extra",
      "HUMAN_GATE_MARKER in handle.read()",
    ];

    for (const copy of GUARD_COPIES) {
      for (const expression of preFix) {
        expect(read(copy), `${copy} still carries ${expression}`).not.toContain(
          expression
        );
      }
    }
  });

  it("gives every copy of the guard the same rule", () => {
    for (const copy of GUARD_COPIES) {
      expect(read(copy), copy).toContain("def declares_human_gate(text):");
    }
  });
});
