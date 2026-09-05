/**
 * The corpus validator must refuse a corpus that cannot bite.
 *
 * `scripts/check-cwd-resolution-corpus.mjs` exists because rows decay in one
 * direction: a `holds` row is easy to write and always passes, so a corpus left
 * alone drifts towards proving the resolver RAN rather than that it BITES. A
 * validator that only ever reports success on the corpus as shipped would be
 * one more control that is green and inert — it would prove it executed, not
 * that it refuses anything.
 *
 * So every rule it claims to enforce is exercised here by MUTATING the real
 * corpus and requiring a non-zero exit with the reason named. A rule with no
 * mutation case below is a rule nobody has shown to work.
 * @module tests/unit/scripts/cwd-resolution-corpus-adversarial
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const CHECKER = path.resolve("scripts/check-cwd-resolution-corpus.mjs");
const CORPUS = path.resolve(
  "tests/unit/hooks/support/cwd-resolution-corpus.json"
);
const REFUSED = 1;
const ACCEPTED = 0;

interface Row {
  id: string;
  control: string;
  applies: string[];
  contract: number[];
  expect: unknown;
  why_not_node?: string;
}

interface Corpus {
  contract: Record<string, string>;
  rows: Row[];
}

/**
 * Run the validator against a corpus written into a scratch checkout.
 *
 * The checker resolves its input relative to the working directory, so a
 * mutated copy is fed by running it from a directory holding that copy at the
 * same relative path.
 * @param corpus - The corpus document to validate
 * @returns Exit status and everything the checker printed
 */
function check(corpus: Corpus): { status: number | null; output: string } {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-corpus-check-"));
  const target = path.join(root, "tests/unit/hooks/support");
  boundedSpawnSync({
    label: "mkdir",
    command: "mkdir",
    args: ["-p", target],
    cwd: root,
  });
  writeFileSync(
    path.join(target, "cwd-resolution-corpus.json"),
    JSON.stringify(corpus, null, 2)
  );
  const result = boundedSpawnSync({
    label: "check-cwd-resolution-corpus",
    command: process.execPath,
    args: [CHECKER],
    cwd: root,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * A fresh, unmutated copy of the shipped corpus.
 * @returns The parsed corpus
 */
function shipped(): Corpus {
  return JSON.parse(readFileSync(CORPUS, "utf8")) as Corpus;
}

describe("the cwd-resolution corpus validator refuses a corpus that cannot bite", () => {
  it("accepts the corpus as shipped", () => {
    const { status, output } = check(shipped());
    expect(status, output).toBe(ACCEPTED);
  });

  it("refuses a corpus with no `bites` row, which leaves the silent direction unguarded", () => {
    const corpus = shipped();
    for (const row of corpus.rows) {
      if (row.control === "bites") row.control = "holds";
    }
    const { status, output } = check(corpus);
    expect(status).toBe(REFUSED);
    expect(output).toContain('no row has control "bites"');
  });

  it("refuses a corpus with no `wall` row, which is how a floor becomes a wall", () => {
    const corpus = shipped();
    for (const row of corpus.rows) {
      if (row.control === "wall") row.control = "holds";
    }
    const { status, output } = check(corpus);
    expect(status).toBe(REFUSED);
    expect(output).toContain('no row has control "wall"');
  });

  it("refuses a contract point carried only by `holds` rows", () => {
    const corpus = shipped();
    for (const row of corpus.rows) {
      if (row.contract.includes(1)) row.control = "holds";
    }
    const { status, output } = check(corpus);
    expect(status).toBe(REFUSED);
    expect(output).toContain("contract point 1 is carried only by");
  });

  it("refuses a contract point with no row at all — add a row when you add a branch", () => {
    const corpus = shipped();
    corpus.contract["7"] = "A behaviour somebody added without a row.";
    const { status, output } = check(corpus);
    expect(status).toBe(REFUSED);
    expect(output).toContain("contract point 7 has no row");
  });

  it("refuses a corpus with no `unknown` expectation, which is the floor nobody writes voluntarily", () => {
    const corpus = shipped();
    corpus.rows = corpus.rows.filter(row => row.expect !== "unknown");
    const { status, output } = check(corpus);
    expect(status).toBe(REFUSED);
    expect(output).toContain('no row expects "unknown"');
  });

  it("refuses a row that skips the Node guard without saying why", () => {
    const corpus = shipped();
    const row = corpus.rows.find(candidate =>
      candidate.applies.includes("node")
    );
    if (!row) throw new Error("no row applies to the Node guard");
    row.applies = ["shell"];
    delete row.why_not_node;
    const { status, output } = check(corpus);
    expect(status).toBe(REFUSED);
    expect(output).toContain("skips the Node guard without saying why");
  });

  it("refuses a duplicated row id, so a row cannot be silently replaced by a copy", () => {
    const corpus = shipped();
    const first = corpus.rows[0];
    if (!first) throw new Error("corpus has no rows");
    corpus.rows.push({ ...first });
    const { status, output } = check(corpus);
    expect(status).toBe(REFUSED);
    expect(output).toContain(`duplicate row id: ${first.id}`);
  });

  it("refuses an unknown control class rather than ignoring it", () => {
    const corpus = shipped();
    const first = corpus.rows[0];
    if (!first) throw new Error("corpus has no rows");
    first.control = "probably-fine";
    const { status, output } = check(corpus);
    expect(status).toBe(REFUSED);
    expect(output).toContain("control must be one of");
  });
});
