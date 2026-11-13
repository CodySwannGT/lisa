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
  const result = boundedSpawnSync({
    args: [SCRIPT, flag],
    command: process.execPath,
    label: `classify-phrase-tests.mjs ${flag}`,
    maxBuffer: 256 * 1024 * 1024,
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
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

describe("classify-phrase-tests.mjs --classify-assertions", () => {
  const report = classify("--classify-assertions");

  it("counts only the assertions made on Markdown text", () => {
    const markdown = report.verdicts.filter(
      verdict => verdict.source === "markdown"
    );
    expect(report.markdownSites).toBe(markdown.length);
    expect(sum(report.counts)).toBe(markdown.length);
    expect(markdown.length).toBeGreaterThan(0);
  });
});
