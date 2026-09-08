/**
 * The merge driver names EVERY invalid entry, from BOTH sides, in one run (#3577).
 *
 * `mergeLearningsDocuments` parsed base, ours and theirs inside a single `try`,
 * and `parseLearningsDocument` validated entries with a `.map` that throws on
 * the first failure. Two collapses followed from one line of code:
 *
 *  - **One entry, not all of them.** With five over-length rows in a ledger, the
 *    driver named the first id it happened to reject. Whoever triaged from that
 *    message shortened that one row, saw the conflict persist, and reasonably
 *    concluded the fix had not worked.
 *  - **One side, not both.** Because the three `parseSide` calls shared a `try`,
 *    a failure in `base` meant `ours` and `theirs` were never parsed at all. An
 *    agent was shown an incoming entry from one branch, and only on a SECOND run
 *    was shown two over-length rules of its OWN. Had it stopped after one run,
 *    two more violations would have shipped.
 *
 * ## Why that is a fail-open and not merely terse
 *
 * The person reading this message is the one positioned to stop the problem
 * spreading, and the message gives them false confidence: "no error on this run"
 * does not mean the author's own entries are clean, and nothing in the output
 * said so. A validator that reports the first problem and stops makes a clean
 * run mean "no more problems found YET" — which is indistinguishable from "no
 * problems" exactly when it matters. Same family as a report naming one denial
 * out of ten.
 *
 * ## The fixture is one of each cap, deliberately
 *
 * `maxRuleCharacters` and `maxRuleLines` are two independent per-rule caps that
 * break the driver identically, and a consumer enforcing only the character cap
 * goes green while merges keep failing. A regression fixture built from
 * over-length rules alone would pass against an implementation that collected
 * only one kind, so each side below carries one of each.
 * @module tests/unit/core/learnings-merge-reports-every-invalid-entry
 */
import { describe, expect, it } from "vitest";

import {
  LEARNINGS_CONTRACT,
  type LearningEntry,
} from "../../../src/core/learnings-contract.js";
import { renderLearningsFile } from "../../../src/core/learnings-document.js";
import { mergeLearningsDocuments } from "../../../src/core/learnings-merge.js";

const CAPTURED_ON = "2026-07-16";

/** A rule one character over the character cap. */
const TOO_LONG = "x".repeat(LEARNINGS_CONTRACT.maxRuleCharacters + 1);

/** A rule one line over the line cap. */
const TOO_MANY_LINES = Array.from(
  { length: LEARNINGS_CONTRACT.maxRuleLines + 1 },
  (_unused, line) => `line ${line + 1}`
).join("\n");

/**
 * Build one valid entry.
 *
 * @param id - Stable entry id
 * @param overrides - Field overrides
 * @returns A learning entry
 */
function entry(
  id: string,
  overrides: Partial<LearningEntry> = {}
): LearningEntry {
  return {
    id,
    fingerprint: id,
    rule: `Rule for ${id}.`,
    why: `Reason for ${id}.`,
    provenance: [`issue:#${id}`],
    first_learned: CAPTURED_ON,
    last_confirmed: CAPTURED_ON,
    confidence: "high",
    ...overrides,
  };
}

/**
 * Render a document, bypassing the writer's own validation.
 *
 * The ledger on disk is the thing being validated, and a conflicted or
 * hand-edited one can carry rows the writer would never emit. Rendering through
 * the normal path and then substituting the rule text is what produces a
 * document shaped exactly like the ones measured in the field.
 *
 * @param entries - Entries to render
 * @param invalid - Rule text keyed by entry id, substituted after rendering
 * @returns A document carrying the substituted rules
 */
function documentWith(
  entries: readonly LearningEntry[],
  invalid: Readonly<Record<string, string>>
): string {
  let rendered = renderLearningsFile(entries);
  for (const [id, rule] of Object.entries(invalid)) {
    const placeholder = JSON.stringify(`Rule for ${id}.`);
    rendered = rendered.replace(placeholder, JSON.stringify(rule));
  }
  return rendered;
}

/** Entry ids used across the fixtures, named so no literal repeats. */
const OURS_LONG = "ours-long";
const OURS_LINES = "ours-lines";
const OURS_FINE = "ours-fine";
const THEIRS_LONG = "theirs-long";
const THEIRS_LINES = "theirs-lines";
const THEIRS_FINE = "theirs-fine";
const BASE_FINE = "base-fine";
const BASE_LONG = "base-long";

/** Ours: two invalid rows, one of each cap, plus a valid one. */
const OURS = documentWith(
  [entry(OURS_LONG), entry(OURS_LINES), entry(OURS_FINE)],
  { [OURS_LONG]: TOO_LONG, [OURS_LINES]: TOO_MANY_LINES }
);

/** Theirs: two invalid rows, one of each cap, plus a valid one. */
const THEIRS = documentWith(
  [entry(THEIRS_LONG), entry(THEIRS_LINES), entry(THEIRS_FINE)],
  { [THEIRS_LONG]: TOO_LONG, [THEIRS_LINES]: TOO_MANY_LINES }
);

/** A base with nothing wrong in it. */
const CLEAN_BASE = renderLearningsFile([entry(BASE_FINE)]);

describe("every invalid entry is named, from every side, in one run", () => {
  it("names all four invalid entries across both sides", () => {
    // AC 1 and AC 4. Before the fix this named exactly one.
    const result = mergeLearningsDocuments(CLEAN_BASE, OURS, THEIRS);

    expect(result.kind).toBe("conflict");
    const reason = result.kind === "conflict" ? result.reason : "";
    for (const id of [OURS_LONG, OURS_LINES, THEIRS_LONG, THEIRS_LINES]) {
      expect(reason).toContain(id);
    }
  });

  it("names both cap kinds, not just the one a shorter fixture would find", () => {
    const result = mergeLearningsDocuments(CLEAN_BASE, OURS, THEIRS);
    const reason = result.kind === "conflict" ? result.reason : "";

    expect(reason).toContain(
      `maxRuleCharacters ${LEARNINGS_CONTRACT.maxRuleCharacters}`
    );
    expect(reason).toContain(`maxRuleLines ${LEARNINGS_CONTRACT.maxRuleLines}`);
  });

  it("says which side each invalid entry came from", () => {
    // AC 2. Without the side label a reader cannot tell an entry they wrote
    // from one arriving on the incoming branch, which is the difference between
    // "fix my row" and "talk to whoever wrote it".
    const result = mergeLearningsDocuments(CLEAN_BASE, OURS, THEIRS);
    const reason = result.kind === "conflict" ? result.reason : "";

    expect(reason).toContain("ours");
    expect(reason).toContain("theirs");
  });

  it("still reports the other sides when the BASE is the invalid one", () => {
    // The measured "one side, not both" case, at its sharpest: base was parsed
    // first, so a failure there meant ours and theirs were never parsed at all.
    const badBase = documentWith([entry(BASE_LONG)], {
      [BASE_LONG]: TOO_LONG,
    });

    const result = mergeLearningsDocuments(badBase, OURS, THEIRS);
    const reason = result.kind === "conflict" ? result.reason : "";

    expect(reason).toContain(BASE_LONG);
    expect(reason).toContain(OURS_LONG);
    expect(reason).toContain(THEIRS_LONG);
  });

  it("reports every invalid entry on a single side too", () => {
    const result = mergeLearningsDocuments(
      CLEAN_BASE,
      OURS,
      renderLearningsFile([entry(THEIRS_FINE)])
    );
    const reason = result.kind === "conflict" ? result.reason : "";

    expect(reason).toContain(OURS_LONG);
    expect(reason).toContain(OURS_LINES);
  });
});

describe("rejection controls: a clean run must mean clean", () => {
  it("merges cleanly when every side is valid", () => {
    // AC 3, and the control without which every assertion above is satisfied by
    // a merge that refuses everything.
    const result = mergeLearningsDocuments(
      CLEAN_BASE,
      renderLearningsFile([entry(BASE_FINE), entry(OURS_FINE)]),
      renderLearningsFile([entry(BASE_FINE), entry(THEIRS_FINE)])
    );

    expect(result.kind).toBe("merged");
  });

  it("names no side that had nothing wrong with it", () => {
    const result = mergeLearningsDocuments(
      CLEAN_BASE,
      OURS,
      renderLearningsFile([entry(THEIRS_FINE)])
    );
    const reason = result.kind === "conflict" ? result.reason : "";

    expect(reason).not.toContain(THEIRS_FINE);
  });

  it("still reports a document-level failure that is not about one entry", () => {
    // Collecting per-entry problems must not swallow the failures that are
    // properties of the document rather than of a row — the conflict-marker
    // diagnosis in particular, which exists to stop an operator being sent to
    // delete good learnings when the real fix is recompaction.
    const conflicted = `${renderLearningsFile([entry(BASE_FINE)])}\n<<<<<<< HEAD\n`;

    const result = mergeLearningsDocuments(CLEAN_BASE, conflicted, CLEAN_BASE);

    expect(result.kind).toBe("conflict");
  });
});
