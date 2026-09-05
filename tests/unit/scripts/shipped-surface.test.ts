/**
 * Unit tests for scripts/lib/shipped-surface.mjs (issue #3849).
 *
 * These are the pure half of the shipped-surface removal gate: the parsers and
 * the one classification that decides whether a removal may be propagated to a
 * host at all. They carry more weight than their size suggests, because the
 * gate's whole proportionality argument rests on them - a parser that reads a
 * healthy `export *` indirection as a miss would flag legitimate code, and a
 * check that flags legitimate code is disabled inside a week.
 *
 * `isConsumerBindable` is the load-bearing one. It is the rule the ticket
 * arrived at only after its first remedy was shown to be harmful: the question
 * is not "does upstream still need this" but "could a host have wired it".
 *
 * Per the Test Isolation house rule, expected values are HARDCODED rather than
 * computed by calling the functions under test.
 *
 * @module tests/unit/scripts/shipped-surface
 */
import { describe, expect, it } from "vitest";

import {
  clauseExportedName,
  clauseImportedName,
  hasUsableNote,
  indexRemovals,
  isConsumerBindable,
  parseNamedExports,
  parseRelativeNamedImports,
  removalKey,
  resolveRelative,
} from "../../../scripts/lib/shipped-surface.mjs";

/** Lexicographic comparator: a bare `Array#sort` is a lint failure here. */
const byName = (left: string, right: string): number =>
  left.localeCompare(right);

/** A shipped module path, repeated across the ledger-key expectations. */
const SHIPPED_MODULE = "all/copy-overwrite/scripts/x.mjs";

/** The subject of the two-key-space indexing test. */
const LEDGER_SUBJECT = "a/copy-overwrite/x.mjs";

describe("isConsumerBindable", () => {
  it("accepts an executable directly under scripts/", () => {
    expect(isConsumerBindable("scripts/check-thing.mjs")).toBe(true);
  });

  it("accepts an executable nested under scripts/", () => {
    expect(isConsumerBindable("scripts/lib/helper.sh")).toBe(true);
  });

  it("accepts every extension a package.json script can name", () => {
    const accepted = [".cjs", ".js", ".mjs", ".py", ".sh", ".ts"].map(ext =>
      isConsumerBindable(`scripts/x${ext}`)
    );
    expect(accepted).toEqual([true, true, true, true, true, true]);
  });

  it("rejects a non-executable under scripts/", () => {
    expect(isConsumerBindable("scripts/README.md")).toBe(false);
  });

  it("rejects an extensionless file under scripts/", () => {
    expect(isConsumerBindable("scripts/run")).toBe(false);
  });

  it("rejects an executable outside scripts/", () => {
    expect(isConsumerBindable("tools/check-thing.mjs")).toBe(false);
  });

  it("does not treat a scripts-prefixed sibling directory as scripts/", () => {
    expect(isConsumerBindable("scriptsy/check-thing.mjs")).toBe(false);
  });
});

describe("clause member names", () => {
  it("an export clause introduces the alias, not the original", () => {
    expect(clauseExportedName("internalName as publicName")).toBe("publicName");
  });

  it("an import clause requests the original, not the local alias", () => {
    expect(clauseImportedName("publicName as localName")).toBe("publicName");
  });

  it("a plain member is its own name on both sides", () => {
    expect([
      clauseExportedName(" plain "),
      clauseImportedName(" plain "),
    ]).toEqual(["plain", "plain"]);
  });

  it("drops default members, which are not named exports", () => {
    expect([
      clauseExportedName("default as x"),
      clauseImportedName("default"),
    ]).toEqual(["x", null]);
  });

  it("drops an empty member left by a trailing comma", () => {
    expect([clauseExportedName("  "), clauseImportedName("")]).toEqual([
      null,
      null,
    ]);
  });
});

describe("parseNamedExports", () => {
  it("reads every declaration form", () => {
    const source = [
      "export const A = 1;",
      "export let B = 2;",
      "export var C = 3;",
      "export function D() {}",
      "export async function E() {}",
      "export function* F() {}",
      "export class G {}",
    ].join("\n");
    expect([...parseNamedExports(source).names].sort(byName)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
    ]);
  });

  it("reads an export clause and honours its aliases", () => {
    const parsed = parseNamedExports("export { one, two as three };\n");
    expect([...parsed.names].sort(byName)).toEqual(["one", "three"]);
  });

  it("reports relative star re-exports without resolving them", () => {
    const parsed = parseNamedExports('export * from "./other.mjs";\n');
    expect({ names: [...parsed.names], starFrom: parsed.starFrom }).toEqual({
      names: [],
      starFrom: ["./other.mjs"],
    });
  });

  it("ignores a bare-specifier star re-export", () => {
    expect(parseNamedExports('export * from "node:fs";\n').starFrom).toEqual(
      []
    );
  });

  it("ignores a name that merely appears in a comment", () => {
    expect([...parseNamedExports("// export const Nope = 1;\n").names]).toEqual(
      []
    );
  });
});

describe("parseRelativeNamedImports", () => {
  it("reads a relative named import", () => {
    const requests = parseRelativeNamedImports(
      'import { alpha, beta } from "./lib/x.mjs";\n'
    );
    expect(requests).toEqual([
      { names: ["alpha", "beta"], specifier: "./lib/x.mjs" },
    ]);
  });

  it("requests the exported name, not the local alias", () => {
    const requests = parseRelativeNamedImports(
      'import { exported as local } from "./x.mjs";\n'
    );
    expect(requests).toEqual([{ names: ["exported"], specifier: "./x.mjs" }]);
  });

  it("skips bare specifiers, which resolve through node_modules", () => {
    expect(parseRelativeNamedImports('import { z } from "zod";\n')).toEqual([]);
  });

  it("skips a default-only import, which asks for no named export", () => {
    expect(parseRelativeNamedImports('import fs from "./x.mjs";\n')).toEqual(
      []
    );
  });
});

describe("resolveRelative", () => {
  it("resolves a sibling specifier against the importer's directory", () => {
    expect(resolveRelative("scripts/a.mjs", "./lib/b.mjs")).toBe(
      "scripts/lib/b.mjs"
    );
  });

  it("resolves a parent specifier", () => {
    expect(resolveRelative("scripts/lib/a.mjs", "../b.mjs")).toBe(
      "scripts/b.mjs"
    );
  });
});

describe("ledger indexing", () => {
  it("keys a whole-file removal by path alone", () => {
    expect(removalKey(SHIPPED_MODULE)).toBe(SHIPPED_MODULE);
  });

  it("keys an export removal by path and symbol", () => {
    expect(removalKey(SHIPPED_MODULE, "SYM")).toBe(`${SHIPPED_MODULE} SYM`);
  });

  it("indexes both key spaces without collision", () => {
    const index = indexRemovals([
      { note: "file gone", path: LEDGER_SUBJECT },
      { export: "SYM", note: "symbol gone", path: LEDGER_SUBJECT },
    ]);
    expect([...index.keys()].sort(byName)).toEqual([
      LEDGER_SUBJECT,
      `${LEDGER_SUBJECT} SYM`,
    ]);
  });
});

describe("hasUsableNote", () => {
  it("accepts an entry carrying a note", () => {
    expect(hasUsableNote({ note: "do this instead" })).toBe(true);
  });

  it("rejects a missing entry", () => {
    expect(hasUsableNote(undefined)).toBe(false);
  });

  it("rejects a blank note, which records nothing an operator can act on", () => {
    expect(hasUsableNote({ note: "   \n  " })).toBe(false);
  });

  it("rejects a non-string note", () => {
    expect(hasUsableNote({ note: 42 })).toBe(false);
  });
});
