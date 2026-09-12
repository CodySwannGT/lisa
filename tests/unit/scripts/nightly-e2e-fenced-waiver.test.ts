/**
 * Documentation of a waiver is not a waiver (#3486).
 *
 * `REQUIRED_BYPASS_REASON_PATTERN` is `^`-anchored and matched multiline
 * against the raw pull request body, so a `Nightly-E2E-Bypass:` line inside a
 * fenced code block matched exactly as readily as one an author wrote to assert
 * something. A pull request DOCUMENTING the waiver format — the natural way to
 * document it — waived its own gate, and one quoting another pull request's
 * waiver waived it under that other pull request's ticket.
 *
 * ## What was and was not broken
 *
 * The bypass was still AUTHORISED: `evaluateBypass` requires the label to be
 * present, the actor who applied it to hold `admin` or `maintain`, and the
 * label to sit inside a bounded expiry window, all before the pattern is
 * consulted. The string is not the credential. What the pattern supplies is the
 * AUDIT RECORD — who waived it, under which ticket, why — and that is what
 * fenced prose fabricated. The quoted-example case is the worse one: the record
 * is not merely empty, it names a ticket the pull request has nothing to do
 * with.
 *
 * ## Why fences and not something more general
 *
 * The `^` anchor does more work than it looks. An indented block's line starts
 * with spaces, a blockquote's with `>`, an inline span at column zero with a
 * backtick — none can match an anchored pattern. Fences are the only shape
 * whose content sits at column zero, which is why they are the hole and the
 * others are not. Inline spans are stripped anyway, and asserted below, because
 * the anchor is not a property anyone should have to remember.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/unit/scripts/nightly-e2e-fenced-waiver
 */
import { describe, expect, it } from "vitest";

import {
  REQUIRED_BYPASS_REASON_PATTERN,
  stripMarkdownCode,
} from "../../../typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs";

/** The waiver line an author writes to assert something. */
const REAL_WAIVER =
  "Nightly-E2E-Bypass: ABC-1234 the harness is red, not the app.";

/** The same line as it appears when a pull request DOCUMENTS the format. */
const DOCUMENTED = "Nightly-E2E-Bypass: ABC-1234 <why this is not the app>";

/** The prose line that introduces a documented example. */
const INTRO = "Document the format:";

/** The line that opens and closes a backtick fence. */
const FENCE = "```";

/** A waiver quoted from a different pull request, naming a foreign ticket. */
const QUOTED_FOREIGN =
  "Nightly-E2E-Bypass: ABC-7748 this IS the PR that fixes the red nightly.";

/**
 * Match a body the way `evaluateBypass` does, after the strip.
 * @param body - Raw pull request body
 * @returns The captured ticket, or null when nothing asserted a waiver
 */
function ticketFrom(body: string): string | null {
  const found = new RegExp(REQUIRED_BYPASS_REASON_PATTERN, "m").exec(
    stripMarkdownCode(body)
  );
  return found?.groups?.["ticket"] ?? null;
}

describe("a fenced example is not an assertion", () => {
  it("refuses a waiver line inside a backtick fence", () => {
    // Case C from the ticket's measured probe: ACCEPTED before this change.
    const body = [INTRO, FENCE, DOCUMENTED, FENCE].join("\n");

    expect(ticketFrom(body)).toBeNull();
  });

  it("refuses a waiver line inside a tilde fence", () => {
    const body = [INTRO, "~~~", DOCUMENTED, "~~~"].join("\n");

    expect(ticketFrom(body)).toBeNull();
  });

  it("refuses a quoted waiver naming another pull request's ticket", () => {
    // Case D, and the worse one: the audit record was not empty but WRONG.
    const body = [
      "The waiver on the earlier pull request read:",
      "```text",
      QUOTED_FOREIGN,
      "```",
      "",
      "Work-Item: CodySwannGT/lisa#3486",
    ].join("\n");

    expect(ticketFrom(body)).toBeNull();
  });

  it("refuses a fence closed by a longer run than it opened with", () => {
    // A closing fence may be longer than its opener. Treating the run length as
    // fixed would end the fence early and expose the lines after it.
    const body = ["````", DOCUMENTED, "`````"].join("\n");

    expect(ticketFrom(body)).toBeNull();
  });

  it("refuses an indented fence, which is still a fence", () => {
    const body = ["Example:", "   ```", DOCUMENTED, "   ```"].join("\n");

    expect(ticketFrom(body)).toBeNull();
  });
});

describe("the defect, stated as a differential", () => {
  it("the raw pattern accepts fenced prose that the strip refuses", () => {
    // The control that carries real weight. Every other refusal case fails on
    // unfixed code merely because `stripMarkdownCode` is not exported, which
    // proves an absent function rather than a changed verdict. This holds the
    // body constant and varies only whether the strip runs, so it shows the
    // pattern itself accepting documentation as a waiver.
    const body = [INTRO, FENCE, DOCUMENTED, FENCE].join("\n");
    const raw = new RegExp(REQUIRED_BYPASS_REASON_PATTERN, "m").exec(body);

    expect(raw?.groups?.["ticket"]).toBe("ABC-1234");
    expect(ticketFrom(body)).toBeNull();
  });
});

describe("a real waiver is still honoured", () => {
  it("accepts a plain asserted line", () => {
    // Without this, blanking the entire body would satisfy every case above.
    expect(ticketFrom(REAL_WAIVER)).toBe("ABC-1234");
  });

  it("accepts a waiver that appears after a documentation fence", () => {
    // The realistic body: a pull request that both explains the format AND
    // waives. Only the assertion outside the fence may count.
    const body = [
      "For reference the format is:",
      FENCE,
      DOCUMENTED,
      FENCE,
      "",
      REAL_WAIVER,
    ].join("\n");

    expect(ticketFrom(body)).toBe("ABC-1234");
  });

  it("accepts a hash-numbered ticket", () => {
    expect(
      ticketFrom("Nightly-E2E-Bypass: #3486 harness red, not the app.")
    ).toBe("#3486");
  });
});

describe("the stripper blanks rather than deletes", () => {
  it("keeps the line count, so no new line can be manufactured", () => {
    // Deleting fenced lines would slide unrelated lines together and could
    // produce a match the body never contained — the same class of defect one
    // step along.
    const body = ["a", FENCE, "b", FENCE, "c"].join("\n");

    expect(stripMarkdownCode(body).split("\n")).toHaveLength(5);
  });

  it("blanks an inline code span even though the anchor already refuses it", () => {
    expect(stripMarkdownCode("see `Nightly-E2E-Bypass: ABC-1 x` above")).toBe(
      "see   above"
    );
  });

  it("leaves ordinary prose untouched", () => {
    expect(stripMarkdownCode("a plain sentence")).toBe("a plain sentence");
  });
});
