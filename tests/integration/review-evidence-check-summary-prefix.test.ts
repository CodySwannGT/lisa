/** Long first-line prefixes retain strict result and legacy-title policy. */
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import {
  installReviewEvidenceProver,
  writeReviewDeclaration,
} from "../helpers/review-evidence-registration-fixture.js";
import {
  installRawSummaryReviewGh,
  rawSummaryCheckRun,
} from "../helpers/review-evidence-summary-fixture.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const HEAD = "a".repeat(40);
const REVIEWER = "CodeRabbit";
const REVIEWED = "Review completed";
const PREFIX = " \t>#| ".repeat(1024);
const DECLARATION = ".github/required-checks.json";

describe("long raw check-run summary prefixes", () => {
  let workdir = "";
  let bindir = "";
  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "review-prefix-"));
    bindir = await fs.mkdtemp(path.join(os.tmpdir(), "review-prefix-bin-"));
    await installReviewEvidenceProver(ROOT, workdir);
    await writeReviewDeclaration(workdir, [REVIEWER]);
    const file = path.join(workdir, DECLARATION);
    const declaration = await fs.readJson(file);
    await fs.writeJson(file, {
      ...declaration,
      ruleset: { ...declaration.ruleset, repo: "acme/code" },
      evidence_bearing_checks: { [REVIEWER]: { proof: [REVIEWED] } },
    });
  });
  afterEach(async () => {
    await fs.remove(workdir);
    await fs.remove(bindir);
  });

  it.each([
    [
      "preserves independent legacy-title proof with a long mixed prefix and ordinary metadata",
      "Synthetic run metadata",
      0,
      "satisfied",
    ],
    [
      "denies positive-title fallback with a long mixed prefix and malformed Result without a colon",
      "Result Review completed",
      1,
      "unsatisfied",
    ],
  ] as const)("%s", async (_name, suffix, status, state) => {
    const summary = PREFIX + suffix;
    await installRawSummaryReviewGh(bindir, HEAD, {
      checkRuns: [
        rawSummaryCheckRun(HEAD, { output: { title: REVIEWED, summary } }),
      ],
    });
    const run = boundedSpawnSync({
      label: "the installed long-prefix review-evidence CLI",
      command: process.execPath,
      args: [
        "scripts/check-skipped-required-checks.mjs",
        "--vacuity",
        "--require-review-evidence",
        "--repo=acme/code",
        "--pr=1234",
        "--settle-timeout=0",
        "--json",
      ],
      cwd: workdir,
      env: {
        ...process.env,
        PATH: `${bindir}${path.delimiter}${process.env.PATH ?? ""}`,
        GITHUB_REPOSITORY: "acme/code",
        GITHUB_BASE_REF: "main",
        GITHUB_EVENT_PATH: "",
        GITHUB_REF: "",
        GITHUB_STEP_SUMMARY: "",
      },
    });
    const report = JSON.parse(run.stdout);
    expect(run.status).toBe(status);
    expect(report.vacuity.headSha).toBe(HEAD);
    expect(report.vacuity.gateStates[REVIEWER]).toBe(state);
    expect(report.verdict.verdict).toBe(state);
    expect(report.vacuity.carried.violations).toEqual([]);
    expect(report.vacuity.objection.violations).toEqual([]);
    const trace = (
      await fs.readFile(path.join(bindir, "api-trace.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map(line => JSON.parse(line));
    const reads = trace.filter(row => row.query?.includes(".check_runs[]"));
    expect(reads.length).toBeGreaterThan(0);
    for (const row of reads) {
      expect(row.status).toBe(0);
      expect(row.raw.check_runs[0].output.summary).toBe(summary);
    }
  });
});
