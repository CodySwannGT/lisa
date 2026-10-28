/** Exercises structured review results through the installed CLI and real jq. */
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
  rawSummaryCheckRun,
} from "../helpers/review-evidence-summary-fixture.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const HEAD = "a".repeat(40);
const REVIEWER = "CodeRabbit";
const REVIEWED = "Review completed";
const DECLARATION = ".github/required-checks.json";
const LEGACY = {
  context: REVIEWER,
  state: "success",
  description: REVIEWED,
};

describe("structured check-run review evidence through the installed CLI", () => {
  let workdir = "";
  let bindir = "";

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "review-summary-"));
    bindir = await fs.mkdtemp(path.join(os.tmpdir(), "review-summary-bin-"));
    await installReviewEvidenceProver(ROOT, workdir);
    await writeReviewDeclaration(workdir, [REVIEWER]);
    const file = path.join(workdir, DECLARATION);
    const declaration = await fs.readJson(file);
    await fs.writeJson(file, {
      ...declaration,
      ruleset: { ...declaration.ruleset, repo: "acme/code" },
    });
  });

  afterEach(async () => {
    await fs.remove(workdir);
    await fs.remove(bindir);
  });

  /**
   * Uses the existing declared semantic proof without changing gate policy.
   * @returns Completion after explicit proof is configured.
   */
  async function useExplicitProof(): Promise<void> {
    const file = path.join(workdir, DECLARATION);
    const declaration = await fs.readJson(file);
    declaration.evidence_bearing_checks.CodeRabbit = { proof: [REVIEWED] };
    await fs.writeJson(file, declaration);
  }

  /**
   * Runs the installed command across the real external-read adapter.
   * @returns The actual CLI's output and parsed verdict.
   */
  function inspect() {
    const run = boundedSpawnSync({
      label: "the installed structured-summary review CLI",
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
    expect(report.inspected).toBe(true);
    expect(report.vacuity.headSha).toBe(HEAD);
    expect(report.vacuity.carried.violations).toEqual([]);
    expect(report.vacuity.objection.violations).toEqual([]);
    return { run, report };
  }

  it.each(["default", "explicit"])(
    "accepts completed multiline proof with %s configuration",
    async configuration => {
      if (configuration === "explicit") {
        await useExplicitProof();
      }
      await installRawSummaryReviewGh(bindir, HEAD);
      const { run, report } = inspect();
      expect(run.status).toBe(0);
      expect(report.verdict.verdict).toBe("satisfied");
      expect(report.vacuity.gateStates[REVIEWER]).toBe("satisfied");
      expect(report.violations).toEqual([]);
    }
  );

  it("accepts CRLF metadata after the exact first result line", async () => {
    await installRawSummaryReviewGh(bindir, HEAD, {
      checkRuns: [
        rawSummaryCheckRun(HEAD, {
          output: {
            title: "Finished",
            summary: COMPLETED_REVIEW_SUMMARY.replaceAll("\n", "\r\n"),
          },
        }),
      ],
    });
    expect(inspect().run.status).toBe(0);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["non-string", 42],
    ["unknown", "Result: Unknown - Review completed"],
    ["failure result", "Result: Failure - Review completed"],
    ["skipped", "Result: Success - Review skipped\nReview completed"],
    ["rate limited", "Result: Success - Review rate limited\nReview completed"],
    ["later metadata", "Metadata\nResult: Success - Review completed"],
    ["quoted", "> Result: Success - Review completed"],
    ["heading", "# Result: Success - Review completed"],
    ["table", "| Result: Success - Review completed |"],
    ["blank first line", "\nResult: Success - Review completed"],
    ["extra suffix", "Result: Success - Review completed, review skipped"],
    ["malformed separator", "Result: Success: Review completed"],
  ])(
    "rejects %s summary without inheriting unrelated positive words",
    async (name, summary) => {
      const title = [
        "missing",
        "null",
        "empty",
        "later metadata",
        "blank first line",
      ].includes(String(name))
        ? "Finished"
        : REVIEWED;
      await installRawSummaryReviewGh(bindir, HEAD, {
        checkRuns: [rawSummaryCheckRun(HEAD, { output: { title, summary } })],
      });
      const { run, report } = inspect();
      expect(run.status).toBe(1);
      expect(report.vacuity.gateStates[REVIEWER]).toBe("unsatisfied");
      expect(report.verdict.verdict).toBe("unsatisfied");
    }
  );

  it("gives Finished alone no completed-review credit", async () => {
    await installRawSummaryReviewGh(bindir, HEAD, {
      checkRuns: [rawSummaryCheckRun(HEAD, { output: { title: "Finished" } })],
    });
    expect(inspect().report.vacuity.gateStates[REVIEWER]).toBe("unsatisfied");
  });

  it("preserves a legacy semantic check-run title with no summary", async () => {
    await useExplicitProof();
    await installRawSummaryReviewGh(bindir, HEAD, {
      checkRuns: [rawSummaryCheckRun(HEAD, { output: { title: REVIEWED } })],
    });
    const result = inspect();
    expect(result.run.status).toBe(0);
    expect(result.report.vacuity.gateStates[REVIEWER]).toBe("satisfied");
  });

  it("preserves a legacy semantic title beside ordinary non-structured metadata", async () => {
    await useExplicitProof();
    await installRawSummaryReviewGh(bindir, HEAD, {
      checkRuns: [
        rawSummaryCheckRun(HEAD, {
          output: {
            title: REVIEWED,
            summary:
              "Legacy reviewer details\nFiles inspected: 3\nRun metadata: synthetic",
          },
        }),
      ],
    });
    const result = inspect();
    expect(result.run.status).toBe(0);
    expect(result.report.vacuity.gateStates[REVIEWER]).toBe("satisfied");
  });

  it.each([
    null,
    "",
    "Legacy metadata\nResult: Unknown - later quoted metadata",
  ])(
    "preserves independent semantic-title proof with legacy summary %s",
    async summary => {
      await installRawSummaryReviewGh(bindir, HEAD, {
        checkRuns: [
          rawSummaryCheckRun(HEAD, {
            output: { title: REVIEWED, summary },
          }),
        ],
      });
      const result = inspect();
      expect(result.run.status).toBe(0);
      expect(result.report.vacuity.gateStates[REVIEWER]).toBe("satisfied");
    }
  );

  it("lets an explicit first-line no-work notice override a positive title without claiming a review", async () => {
    await installRawSummaryReviewGh(bindir, HEAD, {
      checkRuns: [
        rawSummaryCheckRun(HEAD, {
          output: {
            title: REVIEWED,
            summary: "Review rate limited\nReview completed",
          },
        }),
      ],
    });
    const result = inspect();
    expect(result.run.status).toBe(0);
    expect(result.report.vacuity.gateStates[REVIEWER]).toBe("waived");
    expect(result.report.verdict.conclusion).toBe("neutral");
  });

  it.each([
    ["queued", null],
    ["in_progress", "success"],
    ["completed", null],
    ["completed", "failure"],
    ["completed", "cancelled"],
    ["completed", "neutral"],
  ])(
    "does not credit positive summary for %s / %s outcome",
    async (status, conclusion) => {
      await installRawSummaryReviewGh(bindir, HEAD, {
        checkRuns: [rawSummaryCheckRun(HEAD, { status, conclusion })],
      });
      const result = inspect();
      expect(result.run.status).toBe(1);
      expect(result.report.vacuity.gateStates[REVIEWER]).toBe("unsatisfied");
    }
  );

  it.each(["unknown", "pending", "failed", "id tie"])(
    "keeps newest %s check ahead of older proof and duplicate legacy success",
    async kind => {
      const older = rawSummaryCheckRun(HEAD, {
        completed_at: "2026-10-28T13:00:00Z",
      });
      const newer = rawSummaryCheckRun(HEAD, {
        id: 102,
        created_at:
          kind === "id tie" ? "2026-10-28T10:00:00Z" : "2026-10-28T11:00:00Z",
        ...(kind === "pending"
          ? { status: "queued", conclusion: null }
          : kind === "failed"
            ? { conclusion: "failure" }
            : {
                output: {
                  title: REVIEWED,
                  summary: "Result: Unknown - Review completed",
                },
              }),
      });
      await installRawSummaryReviewGh(bindir, HEAD, {
        checkRuns: [newer, older],
        statuses: [LEGACY],
      });
      const result = inspect();
      expect(result.run.status).toBe(1);
      expect(result.report.vacuity.gateStates[REVIEWER]).toBe("unsatisfied");
    }
  );

  it.each(["default", "explicit"])(
    "preserves legacy commit-status proof with %s configuration",
    async configuration => {
      if (configuration === "explicit") {
        await useExplicitProof();
      }
      await installRawSummaryReviewGh(bindir, HEAD, {
        checkRuns: [],
        statuses: [LEGACY],
      });
      const result = inspect();
      expect(result.run.status).toBe(0);
      expect(result.report.vacuity.gateStates[REVIEWER]).toBe("satisfied");
    }
  );

  it("preserves an explicit no-work title as a waiver, never a vendor review", async () => {
    await installRawSummaryReviewGh(bindir, HEAD, {
      checkRuns: [
        rawSummaryCheckRun(HEAD, { output: { title: "Review rate limited" } }),
      ],
    });
    const result = inspect();
    expect(result.run.status).toBe(0);
    expect(result.report.vacuity.gateStates[REVIEWER]).toBe("waived");
    expect(result.report.verdict.conclusion).toBe("neutral");
  });
});
