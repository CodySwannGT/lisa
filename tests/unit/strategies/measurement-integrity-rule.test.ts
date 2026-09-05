/**
 * Contract coverage for the measurement-integrity method rule (#3739).
 *
 * The rule exists because every failure it catalogues produces output that
 * looks exactly like an answer — no throw, no warning, no partial flag — so
 * the wrong number survives review and gets cited. Five instances were
 * measured across three tickets in one day.
 *
 * ## Why these assertions and not a word count
 *
 * Three properties are pinned because each one is what turns the document from
 * a list into a method, and each is the thing most likely to be lost in an edit
 * that "tidies" it:
 *
 * - **The membership test**, which lets a reader ADD a mode rather than only
 *   consult the ones present. Its third condition — that a mechanical step
 *   would have caught it — is what keeps the catalogue from accumulating
 *   hazards it cannot act on.
 * - **The open-list statement.** A taxonomy is the artifact most likely to be
 *   believed complete; an earlier four-item version of a related list felt
 *   complete at four and was not.
 * - **Performed-or-not phrasing.** A remedy that requires the auditor to
 *   *notice* something has already failed, because the unifying property is
 *   that there is nothing to notice.
 *
 * The composition table is pinned separately: it is the payload, and a reader
 * who takes only the cheapest check ("read every candidate") is blind to the
 * whole under-reporting half.
 * @module tests/unit/strategies/measurement-integrity-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Roots that ship the paired rule as `rules/{eager,reference}/<slug>.md`. */
const ROOTS = [
  "plugins/src/base",
  "plugins/lisa",
  "plugins/lisa-copilot",
] as const;

/** The slug both halves ship under. */
const SLUG = "measurement-integrity";

/**
 * The sentence naming the unifying property.
 *
 * Hardcoded rather than imported: drift in this phrase is the thing under
 * test, because it is what tells a reader the modes are one shape rather than
 * unrelated bugs.
 */
const UNIFYING_PROPERTY = "looks exactly like an answer";

/**
 * Read one shipped half of the rule.
 * @param root Plugin root.
 * @param half Either `eager` or `reference`.
 * @returns File contents.
 */
const read = (root: string, half: "eager" | "reference"): string =>
  readFileSync(path.resolve(root, "rules", half, `${SLUG}.md`), "utf8");

describe("measurement-integrity rule contract (#3739)", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "eager");
    const reference = read(root, "reference");

    it("ships as a paired rule with a non-trivial body on both sides", () => {
      expect(eager.length).toBeGreaterThan(500);
      expect(reference.length).toBeGreaterThan(3000);
    });

    it("eager head breadcrumbs to the reference body", () => {
      expect(eager).toContain(
        "[reference/measurement-integrity.md](../reference/measurement-integrity.md)"
      );
    });

    it("states the unifying property that makes the class invisible", () => {
      // Without this, a reader treats the modes as unrelated bugs rather than
      // one shape, and applies the checks selectively.
      expect(eager.toLowerCase()).toContain(UNIFYING_PROPERTY);
      expect(reference.toLowerCase()).toContain(UNIFYING_PROPERTY);
    });

    it("phrases its remedies as performed-or-not, not as noticing", () => {
      expect(reference.toLowerCase()).toContain("performed or not");
      // The negative half: the rule must say why an awareness-shaped remedy
      // fails, or someone will add one.
      expect(reference.toLowerCase()).toContain("has already failed");
    });

    it("carries the membership test, including the mechanical-step condition", () => {
      expect(reference).toContain("## The membership test");
      expect(reference.toLowerCase()).toContain("a mechanical step would have");
    });

    it("says the list is open", () => {
      // The failure mode of a taxonomy is being believed complete.
      expect(reference.toLowerCase()).toContain("the list is open");
    });

    it("carries a second domain for a mode, and says why that matters", () => {
      // A mode observed through one tool could be a fact about that tool. The
      // same shape on a different substrate is what makes it a category, and
      // this assertion exists so the example is not tidied away as a
      // redundant second illustration — its redundancy is the point.
      expect(reference).toContain("#### A second domain");
      expect(reference.toLowerCase()).toContain(
        "just a description of one tool's behaviour"
      );
    });

    it("keeps the composition table, which is the payload", () => {
      // A reader who takes only the cheapest check must be told what it cannot
      // see. Both blind spots are named because they point opposite ways.
      expect(reference.toLowerCase()).toContain("blind to");
      expect(reference.toLowerCase()).toContain(
        "complements, not alternatives"
      );
    });

    it("distinguishes the fabricating mode from the merely over-reporting one", () => {
      // A direct read kills a wrong-reason match and cannot touch an invented
      // referent — the distinction that decides which check to reach for.
      expect(reference.toLowerCase()).toContain("artifact that does not exist");
    });
  });

  it("is discoverable from the eager channel in every shipped copy", () => {
    // The rule is worthless if it is only reachable by someone who already
    // knows to look for it; the eager half is what puts it in front of the
    // moment it applies.
    const missing = ROOTS.filter(
      root => !read(root, "eager").includes("Measurement Integrity")
    );

    expect(missing).toEqual([]);
  });

  it("reaches the Cursor surface too, which ships a different path shape", () => {
    // Cursor takes the same rule as front-mattered `.mdc` at a flat path, so a
    // roots-only assertion above would pass while that runtime shipped
    // nothing. Asserted separately rather than folded in, because the path
    // shape differs and a generic loop would have to guess it.
    const cursor = readFileSync(
      path.resolve("plugins/lisa-cursor/rules/measurement-integrity.mdc"),
      "utf8"
    );

    expect(cursor).toContain("Measurement Integrity");
    expect(cursor.toLowerCase()).toContain(UNIFYING_PROPERTY);
  });
});
