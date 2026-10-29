/** Explicit waivers retain their exact matching independently of no-work lists. */
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
const WAIVER = "Provider capacity exhausted";
const PROOF = "Review completed";
const RESULT = "Result: Success - Review completed";

const CASES = [
  {
    name: "custom title",
    title: WAIVER,
    summary: COMPLETED_REVIEW_SUMMARY,
    phrase: WAIVER,
    state: "waived",
  },
  {
    name: "custom first line",
    title: PROOF,
    summary: `${WAIVER}\n${PROOF}`,
    phrase: WAIVER,
    state: "waived",
  },
  {
    name: "exact positive first line",
    title: "Finished",
    summary: COMPLETED_REVIEW_SUMMARY,
    phrase: RESULT,
    state: "waived",
  },
  {
    name: "normalized custom title",
    title: `  ${WAIVER.toUpperCase()}  `,
    summary: COMPLETED_REVIEW_SUMMARY,
    phrase: WAIVER,
    state: "waived",
  },
  {
    name: "normalized custom first line",
    title: PROOF,
    summary: `  ${WAIVER.toUpperCase()}  \n${PROOF}`,
    phrase: WAIVER,
    state: "waived",
  },
  {
    name: "normalized structured waiver",
    title: PROOF,
    summary: `  ${RESULT.toLowerCase()}  `,
    phrase: RESULT,
    state: "waived",
  },
  {
    name: "non-exact title with independent proof",
    title: `${WAIVER} details`,
    summary: COMPLETED_REVIEW_SUMMARY,
    phrase: WAIVER,
    state: "satisfied",
  },
  {
    name: "non-exact first line with legacy proof",
    title: PROOF,
    summary: `${WAIVER} details`,
    phrase: WAIVER,
    state: "satisfied",
  },
  {
    name: "non-exact title without proof",
    title: `${WAIVER} details`,
    summary: null,
    phrase: WAIVER,
    state: "unsatisfied",
  },
  {
    name: "incidental later waiver text",
    title: PROOF,
    summary: `Legacy metadata\n${WAIVER}`,
    phrase: WAIVER,
    state: "satisfied",
  },
];

describe("waive-only vocabulary through the installed raw review CLI", () => {
  let workdir = "";
  let bindir = "";
  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "review-waive-only-"));
    bindir = await fs.mkdtemp(path.join(os.tmpdir(), "review-waive-only-bin-"));
    await installReviewEvidenceProver(ROOT, workdir);
    await writeReviewDeclaration(workdir, ["CodeRabbit"]);
  });
  afterEach(async () => {
    await fs.remove(workdir);
    await fs.remove(bindir);
  });

  it.each(CASES)(
    "preserves exact waiver semantics for $name",
    async ({ title, summary, phrase, state }) => {
      const file = path.join(workdir, ".github/required-checks.json");
      const declaration = await fs.readJson(file);
      declaration.ruleset.repo = "acme/code";
      declaration.evidence_bearing_checks.CodeRabbit = { waive: [phrase] };
      await fs.writeJson(file, declaration);
      expect(declaration.evidence_bearing_checks.CodeRabbit).not.toHaveProperty(
        "no_work"
      );
      await installRawSummaryReviewGh(bindir, HEAD, {
        checkRuns: [rawSummaryCheckRun(HEAD, { output: { title, summary } })],
      });
      const run = boundedSpawnSync({
        label: "the installed waive-only vocabulary review CLI",
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
      expect(report.vacuity.carried.violations).toEqual([]);
      expect(report.vacuity.objection.violations).toEqual([]);
      expect(report.vacuity.gateStates.CodeRabbit).toBe(state);
      expect(report.verdict.conclusion).toBe(
        state === "waived"
          ? "neutral"
          : state === "satisfied"
            ? "success"
            : "failure"
      );
      expect(run.status).toBe(state === "unsatisfied" ? 1 : 0);
      expect(report.verdict.title.startsWith("REVIEWED —")).toBe(
        state === "satisfied"
      );
    }
  );
});
