/**
 * The classifier's phrase-class modes (CodySwannGT/lisa#4867), run as the
 * operator runs them: `--classify-manifest` and `--classify-assertions`
 * print JSON whose counts cover every entry they report, and the committed
 * manifest classifies as MACHINE-TOKEN and STRUCTURAL only.
 * @module tests/unit/scripts/phrase-tests-classify-cli
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MANIFEST_PATH,
  manifestEntries,
  type Manifest,
} from "../../../scripts/lib/phrase-tests/manifest.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const SCRIPT = path.resolve("scripts/classify-phrase-tests.mjs");

/**
 * Run the classifier with some flags and return what it printed.
 * @param flags - The mode flags
 * @returns Its stdout
 */
function run(...flags: string[]): string {
  const result = boundedSpawnSync({
    args: [SCRIPT, ...flags],
    command: process.execPath,
    label: `classify-phrase-tests.mjs ${flags.join(" ")}`,
    maxBuffer: 256 * 1024 * 1024,
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

/**
 * Run the classifier with one flag and parse its JSON.
 * @param flag - The mode flag
 * @returns The parsed report
 */
function classify(flag: string): {
  readonly counts: Record<string, number>;
  readonly verdicts: readonly {
    readonly cls: string;
    readonly source?: string;
  }[];
  readonly entries?: number;
  readonly markdownSites?: number;
} {
  return JSON.parse(run(flag));
}

const sum = (counts: Record<string, number>): number =>
  Object.values(counts).reduce((total, count) => total + count, 0);

describe("classify-phrase-tests.mjs --classify-manifest", () => {
  const report = classify("--classify-manifest");

  it("classifies every manifest entry exactly once", () => {
    const manifest = JSON.parse(
      readFileSync(path.resolve(MANIFEST_PATH), "utf8")
    ) as Manifest;
    expect(report.entries).toBe(manifestEntries(manifest).length);
    expect(report.verdicts).toHaveLength(report.entries ?? -1);
    expect(sum(report.counts)).toBe(report.entries);
  });

  it("finds only load-bearing classes in the committed manifest", () => {
    expect(report.counts["MACHINE-TOKEN"]).toBeGreaterThan(0);
    expect(
      (report.counts["MACHINE-TOKEN"] ?? 0) + (report.counts.STRUCTURAL ?? 0)
    ).toBe(report.entries);
  });
});

/**
 * A fake key a test in this repository uses as a fixture, assembled at run
 * time so this file does not itself carry a credential-shaped literal.
 */
const FIXTURE_SECRET = ["sk", "test", "abcdefghijklmnopqrstuvwxyz"].join("_");
const FIXTURE_TEST = path.resolve(
  "tests/unit/strategies/wiki-connector-source-sanitization.test.ts"
);

describe("classify-phrase-tests.mjs --classify-assertions", () => {
  const output = run("--classify-assertions", "--json");
  const report = JSON.parse(output) as ReturnType<typeof classify>;

  it("never prints a fixture secret, only its placeholder", () => {
    // The control: the secret really is an assertion argument it reports on.
    expect(readFileSync(FIXTURE_TEST, "utf8")).toContain(FIXTURE_SECRET);
    expect(output).not.toContain(FIXTURE_SECRET);
    expect(output).toContain("[REDACTED:API_KEY]");
  });

  it("counts only the assertions made on Markdown text", () => {
    const markdown = report.verdicts.filter(
      verdict => verdict.source === "markdown"
    );
    expect(report.markdownSites).toBe(markdown.length);
    expect(sum(report.counts)).toBe(markdown.length);
    expect(markdown.length).toBeGreaterThan(0);
  });
});
