/** Configured no-work vocabulary remains authoritative at the raw API boundary. */
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
const NO_WORK = "Provider capacity exhausted";

describe("configured no-work check-run vocabulary", () => {
  let workdir = "";
  let bindir = "";
  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "review-vocabulary-"));
    bindir = await fs.mkdtemp(path.join(os.tmpdir(), "review-vocabulary-bin-"));
    await installReviewEvidenceProver(ROOT, workdir);
    await writeReviewDeclaration(workdir, ["CodeRabbit"]);
  });
  afterEach(async () => {
    await fs.remove(workdir);
    await fs.remove(bindir);
  });

  /**
   * Sets the configured no-work phrase and its separate optional waiver.
   * @param waive Whether the operator explicitly permits the no-work path.
   * @returns Completion after writing the controlled declaration.
   */
  async function configure(waive: boolean): Promise<void> {
    const file = path.join(workdir, ".github/required-checks.json");
    const declaration = await fs.readJson(file);
    declaration.ruleset.repo = "acme/code";
    declaration.evidence_bearing_checks.CodeRabbit = {
      no_work: [NO_WORK],
      ...(waive ? { waive: [NO_WORK] } : {}),
    };
    await fs.writeJson(file, declaration);
  }

  /**
   * Runs the installed command and returns its actual observable verdict.
   * @returns The child result and parsed CLI report.
   */
  function inspect() {
    const run = boundedSpawnSync({
      label: "the installed configured-vocabulary review CLI",
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
    return { run, report: JSON.parse(run.stdout) };
  }

  it.each([
    ["title", false],
    ["title", true],
    ["first line", false],
    ["first line", true],
  ])("honors configured %s no-work with waiver=%s", async (source, waive) => {
    await configure(Boolean(waive));
    await installRawSummaryReviewGh(bindir, HEAD, {
      checkRuns: [
        rawSummaryCheckRun(HEAD, {
          output: {
            title: source === "title" ? NO_WORK : "Review completed",
            summary:
              source === "title"
                ? COMPLETED_REVIEW_SUMMARY
                : `${NO_WORK}\nReview completed`,
          },
        }),
      ],
    });
    const { run, report } = inspect();
    expect(report.inspected).toBe(true);
    expect(report.vacuity.carried.violations).toEqual([]);
    expect(report.vacuity.objection.violations).toEqual([]);
    expect(report.vacuity.gateDescriptions.CodeRabbit).toBe(NO_WORK);
    expect(report.vacuity.gateStates.CodeRabbit).toBe(
      waive ? "waived" : "unsatisfied"
    );
    expect(report.verdict.conclusion).toBe(waive ? "neutral" : "failure");
    expect(run.status).toBe(waive ? 0 : 1);
    expect(report.verdict.title).not.toMatch(/^REVIEWED —/u);
  });

  it.each([false, true])(
    "prioritizes configured no-work over the exact structured positive line with waiver=%s",
    async waive => {
      const firstLine = "Result: Success - Review completed";
      const file = path.join(workdir, ".github/required-checks.json");
      const declaration = await fs.readJson(file);
      declaration.ruleset.repo = "acme/code";
      declaration.evidence_bearing_checks.CodeRabbit = {
        no_work: [firstLine],
        ...(waive ? { waive: [firstLine] } : {}),
      };
      await fs.writeJson(file, declaration);
      await installRawSummaryReviewGh(bindir, HEAD);
      const { run, report } = inspect();
      expect(report.vacuity.gateDescriptions.CodeRabbit).toBe(firstLine);
      expect(report.vacuity.gateStates.CodeRabbit).toBe(
        waive ? "waived" : "unsatisfied"
      );
      expect(report.verdict.conclusion).toBe(waive ? "neutral" : "failure");
      expect(run.status).toBe(waive ? 0 : 1);
      expect(report.verdict.title).not.toMatch(/^REVIEWED —/u);
    }
  );

  it.each([false, true])(
    "does not count configured carried no-work as reviewed with waiver=%s",
    async waive => {
      await configure(waive);
      const carriedHead = "b".repeat(40);
      await installRawSummaryReviewGh(bindir, HEAD, {
        responses: {
          "repos/acme/code/pulls/1234/commits": [
            {
              sha: HEAD,
              parents: [{ sha: carriedHead }, { sha: "c".repeat(40) }],
            },
          ],
          [`repos/acme/code/commits/${HEAD}/pulls`]: [
            { number: 1235, head: { sha: carriedHead } },
          ],
          [`repos/acme/code/commits/${carriedHead}/status`]: {
            sha: carriedHead,
            state: "success",
            statuses: [],
          },
          [`repos/acme/code/commits/${carriedHead}/check-runs`]: {
            total_count: 1,
            check_runs: [
              rawSummaryCheckRun(carriedHead, {
                output: { title: NO_WORK, summary: COMPLETED_REVIEW_SUMMARY },
              }),
            ],
          },
        },
      });
      const { report } = inspect();
      expect(report.vacuity.gateStates.CodeRabbit).toBe("satisfied");
      expect(report.vacuity.carried.unread).toBeUndefined();
      expect(report.vacuity.carried.unreviewed).toEqual(["#1235"]);
      expect(report.vacuity.carried.reviewed).toBe(0);
      expect(report.vacuity.carried.violations[0].message).toContain(NO_WORK);
    }
  );
});
