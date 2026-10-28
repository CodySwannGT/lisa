/** Replays the original raw-response CLI regression three times. */
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import {
  installReviewEvidenceProver,
  writeReviewDeclaration,
} from "../helpers/review-evidence-registration-fixture.js";
import {
  COMPLETED_REVIEW_SUMMARY,
  installRawSummaryReviewGh,
} from "../helpers/review-evidence-summary-fixture.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const HEAD = "a".repeat(40);
const DECLARATION = ".github/required-checks.json";

describe("raw check-run summary regression", () => {
  let workdir = "";
  let bindir = "";
  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "review-summary-red-"));
    bindir = await fs.mkdtemp(
      path.join(os.tmpdir(), "review-summary-red-bin-")
    );
  });
  afterEach(async () => {
    await fs.remove(workdir);
    await fs.remove(bindir);
  });

  it("recognizes a successful first result line in a multiline raw check-run summary", async () => {
    await installReviewEvidenceProver(ROOT, workdir);
    await writeReviewDeclaration(workdir, ["CodeRabbit"]);
    const declaration = await fs.readJson(path.join(workdir, DECLARATION));
    await fs.writeJson(path.join(workdir, DECLARATION), {
      ...declaration,
      ruleset: { ...declaration.ruleset, repo: "acme/code" },
    });
    await installRawSummaryReviewGh(bindir, HEAD);
    const runs = Array.from({ length: 3 }, () =>
      boundedSpawnSync({
        label: "the installed raw-summary review-evidence CLI",
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
      })
    );
    const trace = (
      await fs.readFile(path.join(bindir, "api-trace.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map(line => JSON.parse(line));
    const checkReads = trace.filter(entry =>
      entry.args[1]?.includes(`/commits/${HEAD}/check-runs`)
    );
    expect(checkReads.length).toBeGreaterThanOrEqual(3);
    for (const entry of checkReads) {
      expect(entry.query).toContain(".check_runs[]");
      expect(entry.status).toBe(0);
      expect(entry.raw.check_runs[0].output.summary).toBe(
        COMPLETED_REVIEW_SUMMARY
      );
    }
    for (const run of runs) {
      const report = JSON.parse(run.stdout);
      expect(report.vacuity.carried.violations).toEqual([]);
      expect(report.vacuity.objection.violations).toEqual([]);
      expect(run.status).toBe(0);
      expect(report.vacuity.gateStates.CodeRabbit).toBe("satisfied");
      expect(run.stdout).not.toContain("vacuous_required_check");
    }
  });
});
