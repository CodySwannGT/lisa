/**
 * Tests for the shared Markdown table-cell escaper.
 *
 * The escaper protects generated tables that nobody re-reads line by line. A
 * live `|` shifts every column to its right, so the Ticket and Expires cells
 * silently misreport; a surviving line ending is worse, because it ends the ROW
 * and one record becomes two read against the wrong header.
 *
 * The property is SWEPT rather than sampled, deliberately. The first fix on
 * this defect named two instances, fixed exactly those two, shipped a fully
 * green suite, and still leaked a live column separator at every EVEN backslash
 * run — with `hasUnescapedPipe` sitting right there, correct and never pointed
 * at the subject. Enumerate the property; the named instances are documentation.
 * @module tests/unit/scripts/bdd-markdown-cell
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  cell,
  hasLineEnding,
  hasUnescapedPipe,
} from "../../../expo/copy-overwrite/scripts/bdd/markdown-cell.mjs";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const EXPO_SCRIPTS = "expo/copy-overwrite/scripts";
const MODULE_REL = `${EXPO_SCRIPTS}/bdd/markdown-cell.mjs`;

/**
 * An inline escaper, matched by what it DOES rather than by what it is called.
 *
 * The duplication this module ends was two functions with different names —
 * `cell` in the renderer and `escapeCell` in the classifier — that had already
 * drifted from each other. Matching on a name would have caught neither of the
 * next two.
 */
const INLINE_ESCAPER = /\.replace\(\s*\/(?:\\\\\??)?\\\|\/[a-z]*\s*,/u;

/** How deep the backslash-run sweep goes. Even runs are where it leaked. */
const MAX_BACKSLASH_RUN = 16;

/** Every line ending CommonMark recognizes, including the lone CR. */
const LINE_ENDINGS = ["\n", "\r\n", "\r"] as const;

describe("cell — named instances", () => {
  it("escapes a bare pipe", () => {
    expect(cell("stdout | stderr")).toBe("stdout \\| stderr");
  });

  it("escapes the pipe after an escaped backslash", () => {
    // `\\|` is an escaped backslash followed by a LIVE pipe. The obvious
    // `/\\?\|/` reads it as an escape already present and passes it through.
    expect(cell("a\\\\|b")).toBe("a\\\\\\|b");
  });

  it("leaves an already-escaped pipe alone", () => {
    // Idempotency counterweight: an escaper that grows the run on every pass
    // would satisfy the universal negative below and still be wrong.
    expect(cell("a\\|b")).toBe("a\\|b");
  });

  it("replaces a lone CR, which /\\r?\\n/ silently misses", () => {
    expect(cell("one\rtwo")).toBe("one two");
  });

  it("replaces CRLF as one break, not two", () => {
    expect(cell("one\r\ntwo")).toBe("one two");
  });

  it("renders nullish input as empty, never as the text 'null'", () => {
    // Without the `?? ""` guard a missing waiver field prints the literal word
    // into the ledger, where it reads as data.
    expect(cell(null)).toBe("");
    expect(cell(undefined)).toBe("");
  });
});

describe("cell — the escaping property, swept rather than sampled", () => {
  for (let run = 0; run <= MAX_BACKSLASH_RUN; run += 1) {
    it(`leaves no live column separator after a run of ${run} backslashes`, () => {
      const subject = `before${"\\".repeat(run)}|after`;
      expect(hasUnescapedPipe(cell(subject))).toBe(false);
    });
  }

  it("holds for a pipe at the very start of a cell", () => {
    for (let run = 0; run <= MAX_BACKSLASH_RUN; run += 1) {
      const subject = `${"\\".repeat(run)}|tail`;
      expect(hasUnescapedPipe(cell(subject)), `run ${run}`).toBe(false);
    }
  });

  it("holds for several runs in one cell", () => {
    const subject = Array.from(
      { length: MAX_BACKSLASH_RUN + 1 },
      (_unused, run) => `${"\\".repeat(run)}|`
    ).join("x");
    expect(hasUnescapedPipe(cell(subject))).toBe(false);
  });

  it("holds for every line ending, in any position", () => {
    for (const ending of LINE_ENDINGS) {
      for (const subject of [
        `${ending}lead`,
        `mid${ending}dle`,
        `trail${ending}`,
      ]) {
        expect(hasLineEnding(cell(subject)), JSON.stringify(subject)).toBe(
          false
        );
      }
    }
  });

  it("is idempotent — a second pass changes nothing", () => {
    for (let run = 0; run <= MAX_BACKSLASH_RUN; run += 1) {
      const once = cell(`before${"\\".repeat(run)}|after`);
      expect(cell(once), `run ${run}`).toBe(once);
    }
  });

  it("is minimal — text with nothing to escape comes back untouched", () => {
    // Counterweight to the universal negative: an escaper that escaped
    // everything unconditionally would satisfy every assertion above.
    const plain = "a plain reason with no separators at all";
    expect(cell(plain)).toBe(plain);
    expect(cell("a\\b")).toBe("a\\b");
  });
});

describe("hasUnescapedPipe — the yardstick itself", () => {
  it("counts an even backslash run as leaving the pipe live", () => {
    expect(hasUnescapedPipe("|")).toBe(true);
    expect(hasUnescapedPipe("\\\\|")).toBe(true);
    expect(hasUnescapedPipe("\\\\\\\\|")).toBe(true);
  });

  it("counts an odd backslash run as an escape", () => {
    expect(hasUnescapedPipe("\\|")).toBe(false);
    expect(hasUnescapedPipe("\\\\\\|")).toBe(false);
  });

  it("does not let a backslash run carry across an intervening character", () => {
    expect(hasUnescapedPipe("\\x|")).toBe(true);
  });
});

describe("drift guard — one escaper under the expo scripts tree", () => {
  it("finds no inline pipe-escaper outside the shared module", () => {
    const entries = fs.readdirSync(path.join(REPO_ROOT, EXPO_SCRIPTS), {
      recursive: true,
      withFileTypes: true,
    });
    const offenders: string[] = [];
    let swept = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".mjs")) continue;
      const relativePath = path.relative(
        REPO_ROOT,
        path.join(entry.parentPath, entry.name)
      );
      if (relativePath === MODULE_REL) continue;
      swept += 1;
      if (
        INLINE_ESCAPER.test(
          fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8")
        )
      ) {
        offenders.push(relativePath);
      }
    }
    // A moved tree would empty the sweep and pass by testing nothing.
    expect(swept).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });

  it("bites: it matches both copies this module replaced", () => {
    // The negative above is worth its runtime only if it can fail, so feed it
    // the exact text of the two escapers that were deleted.
    expect(INLINE_ESCAPER.test('.replace(/\\|/g, "\\\\|")')).toBe(true);
    expect(INLINE_ESCAPER.test('.replace(/\\\\?\\|/g, "\\\\|")')).toBe(true);
    // Minimality: the shared module's own call site must not match, or the
    // guard would only be satisfiable by deleting the escaping entirely.
    expect(INLINE_ESCAPER.test(".replace(/(\\\\*)\\|/g, escapePipeRun)")).toBe(
      false
    );
  });
});

describe("hasLineEnding", () => {
  it("sees every line ending CommonMark does", () => {
    for (const ending of LINE_ENDINGS) {
      expect(hasLineEnding(`a${ending}b`), JSON.stringify(ending)).toBe(true);
    }
    expect(hasLineEnding("no breaks here")).toBe(false);
  });
});
