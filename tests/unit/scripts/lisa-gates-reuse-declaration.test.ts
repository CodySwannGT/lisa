/**
 * Declaration-time and file-reading behaviour of the reuse verifier (#3013).
 *
 * Two properties that are not about a single envelope:
 *
 * - a half-written `reuse` declaration is refused where it is WRITTEN, not
 *   quietly downgraded at runtime. A `time-sensitive` class with no window
 *   would otherwise leave an author believing they bounded freshness when
 *   nothing did — the exact half-built state #3022 named as the risk;
 * - an absent record and a corrupt one carry DIFFERENT refusal tokens, because
 *   both run everything but they send an operator to different places.
 *
 * The schema-token test is a drift pin. The token is deliberately spelled in
 * two files — `.github/workflows/gates.yml` greps the runner for the literal,
 * so it cannot move — and this is what stops the two copies diverging.
 * @module tests/unit/scripts/lisa-gates-reuse-declaration
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  EVIDENCE_BYTE_BUDGET,
  EVIDENCE_SCHEMA_TOKEN,
  readEvidenceFile,
  validateGates,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { EVIDENCE_SCHEMA } from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { goldenEnvelope } from "./lisa-gates-reuse-fixtures";

/** The class every window test declares. */
const TIME_SENSITIVE = "time-sensitive";

const directory = mkdtempSync(join(tmpdir(), "lisa-reuse-"));

afterAll(() => {
  rmSync(directory, { force: true, recursive: true });
});

/**
 * The problems `validateGates` reports for one reuse block.
 * @param {unknown} reuse The block to declare.
 * @returns {string[]} Problems.
 */
function problemsFor(reuse: unknown): string[] {
  return validateGates({
    "code-style": { "pull-request": "required", reuse },
  });
}

/**
 * Write bytes to a scratch file and hand back the path.
 * @param {string} name File name.
 * @param {string} body Contents.
 * @returns {string} The path.
 */
function scratch(name: string, body: string): string {
  const path = join(directory, name);
  writeFileSync(path, body);
  return path;
}

describe("the schema token is pinned across its two addresses", () => {
  it("matches the producer's literal exactly", () => {
    expect(EVIDENCE_SCHEMA_TOKEN).toBe(EVIDENCE_SCHEMA);
  });
});

describe("validateGates — a half-written reuse block is refused", () => {
  it("accepts a well-formed deterministic declaration", () => {
    expect(problemsFor({ class: "deterministic" })).toEqual([]);
  });

  it("accepts a well-formed time-sensitive declaration", () => {
    expect(problemsFor({ class: TIME_SENSITIVE, max_age_minutes: 30 })).toEqual(
      []
    );
  });

  it("refuses a time-sensitive class with no window", () => {
    const problems = problemsFor({ class: TIME_SENSITIVE });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("max_age_minutes");
    expect(problems[0]).toContain("unmeasured claim");
  });

  it("refuses a time-sensitive class with a zero window", () => {
    expect(
      problemsFor({ class: TIME_SENSITIVE, max_age_minutes: 0 })
    ).toHaveLength(1);
  });

  it("refuses a window on a class that never reads one", () => {
    const problems = problemsFor({
      class: "deterministic",
      max_age_minutes: 30,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("nothing reads it");
  });

  it("refuses an unrecognised class", () => {
    const problems = problemsFor({ class: "sometimes" });
    expect(problems[0]).toContain("expected one of");
  });

  it("refuses a missing class", () => {
    expect(problemsFor({})).toHaveLength(1);
  });

  it("refuses a non-object reuse block", () => {
    expect(problemsFor("deterministic")).toEqual([
      'gates."code-style"."reuse" must be an object',
    ]);
  });

  it("refuses a non-boolean diff flag", () => {
    const problems = problemsFor({ class: "deterministic", diff: "yes" });
    expect(problems).toContain(
      'gates."code-style"."reuse".diff must be true or false'
    );
  });

  it("reports nothing when no reuse block is declared at all", () => {
    expect(
      validateGates({ "code-style": { "pull-request": "required" } })
    ).toEqual([]);
  });
});

describe("readEvidenceFile — absent and corrupt are different facts", () => {
  it("reads a well-formed envelope", () => {
    const path = scratch("good.json", JSON.stringify(goldenEnvelope()));
    const read = readEvidenceFile(path);
    expect(read.refusal).toBeNull();
    expect(read.envelope?.schema).toBe(EVIDENCE_SCHEMA_TOKEN);
  });

  it("reports a missing file as unavailable, not malformed", () => {
    const read = readEvidenceFile(join(directory, "nope.json"));
    expect(read.envelope).toBeNull();
    expect(read.refusal).toBe("unavailable");
    expect(read.reason).toContain("could not be opened");
  });

  it("reports bytes that do not parse as malformed, not unavailable", () => {
    const path = scratch("broken.json", '{"schema": "lisa.gate-ev');
    const read = readEvidenceFile(path);
    expect(read.envelope).toBeNull();
    expect(read.refusal).toBe("malformed");
    expect(read.reason).toContain("not JSON");
  });

  it("refuses a file past the byte budget without parsing it", () => {
    const read = readEvidenceFile("oversize.json", {
      readFile: () => {
        throw new Error("the budget check must run before any read");
      },
      statFile: () => ({ size: EVIDENCE_BYTE_BUDGET + 1 }),
    });
    expect(read.envelope).toBeNull();
    expect(read.refusal).toBe("unavailable");
    expect(read.reason).toContain("budget");
  });
});
