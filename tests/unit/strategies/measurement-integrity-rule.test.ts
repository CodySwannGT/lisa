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

/** Roots that ship the rule as `rules/reference/<slug>.md`. */
const ROOTS = [
  "plugins/src/base",
  "plugins/lisa",
  "plugins/lisa-copilot",
] as const;

/** The slug both halves ship under. */
const SLUG = "measurement-integrity";

/**
 * Read one shipped half of the rule.
 * @param root Plugin root.
 * @param half Which tier to read.
 * @returns File contents.
 */
const read = (root: string, half: "eager" | "reference"): string =>
  readFileSync(path.resolve(root, "rules", half, `${SLUG}.md`), "utf8");

/**
 * The always-loaded head that points at this rule. The full contract left the
 * eager tier in the 2026-11 trim; `empirical-inquiry` carries the one-line
 * trigger and names the slug so the reference is found when it applies.
 * @param root Plugin root.
 * @returns File contents.
 */
const pointer = (root: string): string =>
  readFileSync(
    path.resolve(root, "rules", "eager", "empirical-inquiry.md"),
    "utf8"
  );

describe("measurement-integrity rule contract (#3739)", () => {
  describe.each(ROOTS)("%s", root => {
    const reference = read(root, "reference");

    it("ships a non-trivial reference body", () => {
      expect(reference.length).toBeGreaterThan(3000);
    });

    it("is named from the always-loaded empirical-inquiry head", () => {
      expect(pointer(root)).toContain("`measurement-integrity`");
    });

    it("phrases its remedies as performed-or-not, not as noticing", () => {
      // The negative half: the rule must say why an awareness-shaped remedy
      // fails, or someone will add one.
      expect(reference.toLowerCase()).toContain("has already failed");
    });
  });

  it("is discoverable from the eager channel in every shipped copy", () => {
    // The rule is worthless if it is only reachable by someone who already
    // knows to look for it; the eager pointer is what puts it in front of the
    // moment it applies.
    const missing = ROOTS.filter(
      root => !pointer(root).includes("`measurement-integrity`")
    );

    expect(missing).toEqual([]);
  });
});
