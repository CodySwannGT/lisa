/**
 * The two static note checks must agree.
 *
 * The contract names both `verify` and `doctor` as enforcers of Rule A. They
 * had two different notions of a valid note — doctor tested `note.trim()` and
 * warned; verify tested `Boolean(note)` and failed. A note of one stray
 * character satisfied both while telling a reader nothing, and an operator who
 * cleared doctor could still be failed by verify for a reason doctor never
 * mentioned.
 *
 * These tests pin the property that fixes that: one validator, two consumers,
 * same verdict.
 * @module tests/unit/secrets/note-enforcement-parity
 */
import { describe, expect, it, vi } from "vitest";

import {
  checkNotes,
  collector,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/doctor-secrets.mjs";
import { verify } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/resolve-secret.mjs";

const CFG = {
  provider: "bitwarden",
  surface: "local",
  require: ["A_KEY"],
  rotating: [],
  bootstrap: { key: "BOOT" },
  capabilities: { materialized: false },
};

/**
 * Run `verify` against fixed views, swallowing its table output.
 * @param note The note the provider holds for A_KEY.
 * @returns The count of secrets verify considered failed.
 */
const verifyWithNote = (note: string): number => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    return verify(
      CFG,
      new Map([["A_KEY", { value: "v", note, id: "id" }]]),
      new Map()
    );
  } finally {
    log.mockRestore();
  }
};

/**
 * Run doctor's note check against the same note.
 * @param note The note the provider holds for A_KEY.
 * @returns Whether doctor raised a blocking finding.
 */
const doctorBlocks = (note: string): boolean => {
  const { findings, report } = collector();
  checkNotes(new Map([["A_KEY", { value: "v", note, id: "id" }]]), report);
  return findings.some(f => f.level === "error");
};

const CASES: [label: string, note: string, blocked: boolean][] = [
  ["a note in the documented shape", "Attio CRM.\nowner: someone", false],
  ["a note that is prose alone", "Attio CRM key for the sales funnel.", false],
  ["an empty note", "", true],
  ["a whitespace-only note", "   \n  ", true],
  ["a note with no prose line", "owner: someone\nscope: read", true],
  ["a note with an empty field", "Attio CRM.\nscope:", true],
  ["a note with a malformed tool line", "Attio CRM.\ntool: sonar (CI)", true],
  ["a note with only a stray comma", "Attio CRM.\ntools: sonar,", false],
];

describe("doctor and verify reach the same verdict", () => {
  it.each(CASES)("agrees on %s", (_label, note, blocked) => {
    expect(doctorBlocks(note)).toBe(blocked);
    expect(verifyWithNote(note) > 0).toBe(blocked);
  });
});

describe("verify no longer accepts presence as well-formedness", () => {
  it("fails a note whose shape is wrong even though a note is present", () => {
    // The old check was `Boolean(note)`, which passed anything non-empty.
    expect(verifyWithNote("owner: someone")).toBeGreaterThan(0);
  });

  it("judges shape, not how informative the prose is", () => {
    // A deliberate limit, recorded so it does not read as an oversight. The
    // contract documents a *format*; it sets no bar for how much a sentence
    // must say. Inventing a minimum length here would make enforcement exceed
    // the prose it is meant to match — the same defect, pointing the other way.
    expect(verifyWithNote("x")).toBe(0);
    expect(doctorBlocks("x")).toBe(false);
  });

  it("reports the specific fault rather than a bare NO NOTE", () => {
    // An operator told "NO NOTE" about a note they can see goes looking for
    // the wrong problem.
    const lines: string[] = [];
    const log = vi
      .spyOn(console, "log")
      .mockImplementation((...args: unknown[]) => {
        lines.push(args.join(" "));
      });
    try {
      verify(
        CFG,
        new Map([["A_KEY", { value: "v", note: "Attio.\nscope:", id: "i" }]]),
        new Map()
      );
    } finally {
      log.mockRestore();
    }
    expect(lines.join("\n")).toContain("NOTE empty-field");
    expect(lines.join("\n")).not.toContain("NO NOTE");
  });

  it("still says NO NOTE when there genuinely is none", () => {
    const lines: string[] = [];
    const log = vi
      .spyOn(console, "log")
      .mockImplementation((...args: unknown[]) => {
        lines.push(args.join(" "));
      });
    try {
      verify(
        CFG,
        new Map([["A_KEY", { value: "v", note: "", id: "i" }]]),
        new Map()
      );
    } finally {
      log.mockRestore();
    }
    expect(lines.join("\n")).toContain("NO NOTE");
  });
});
