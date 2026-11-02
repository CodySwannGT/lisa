/**
 * Both review provers decode a check run the same way.
 *
 * The registration prover (`check-skipped-required-checks.mjs`, #4547) and the
 * third-party evidence prover ship from different template trees, so each
 * carries its own copy of the structured-result decoding. Two copies are only
 * safe while they agree, so this runs the SAME raw check run through BOTH real
 * CLIs and requires the same answer to "was a completed review credited?" —
 * and requires that answer to be the expected one, so two provers that agreed
 * on being wrong would still fail (CodySwannGT/lisa#4553).
 *
 * The table keeps to runs whose credit both provers decide from the run alone.
 * The two allowlists differ on purpose elsewhere — `Changes requested` is
 * review WORK to the evidence prover and an objection to the merge gate — and
 * that difference is not decoding.
 * @module tests/integration/third-party-review-check-run-parity
 */
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import {
  installReviewEvidenceProver,
  writeReviewDeclaration,
} from "../helpers/review-evidence-registration-fixture.js";
import { installRawSummaryReviewGh } from "../helpers/review-evidence-summary-fixture.js";
import {
  COMPLETED_RESULT,
  COMPLETED_SUMMARY,
  FINISHED,
  onlyReading,
  PAUSED_SUMMARY,
  RATE_LIMITED,
  RATE_LIMITED_RUN,
  rawCheckRun,
  REVIEW_COMPLETED,
  REVIEWER,
  runThirdPartyReviewCli,
} from "../helpers/third-party-review-cli-fixture.js";

useIoLatencyBudget();

const ROOT = path.resolve(import.meta.dirname, "../..");

/** The head the registration prover's raw fixture serves. */
const SUMMARY_HEAD = "a".repeat(40);

/**
 * Whether the merge path's registration prover credits this run.
 * @param run - One raw check run
 * @returns True when its review gate reads the run as satisfied
 */
async function registrationCredits(
  run: Record<string, unknown>
): Promise<boolean> {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "parity-work-"));
  const bindir = await fs.mkdtemp(path.join(os.tmpdir(), "parity-bin-"));
  try {
    await installReviewEvidenceProver(ROOT, workdir);
    await writeReviewDeclaration(workdir, [REVIEWER]);
    const file = path.join(workdir, ".github/required-checks.json");
    const declaration = await fs.readJson(file);
    await fs.writeJson(file, {
      ...declaration,
      ruleset: { ...declaration.ruleset, repo: "acme/code" },
    });
    await installRawSummaryReviewGh(bindir, SUMMARY_HEAD, {
      checkRuns: [{ ...run, head_sha: SUMMARY_HEAD }],
    });
    const result = boundedSpawnSync({
      label: "the registration prover, for decoding parity",
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
      baseMs: 30000,
    });
    const report = JSON.parse(String(result.stdout));
    return report.vacuity?.gateStates?.[REVIEWER] === "satisfied";
  } finally {
    await fs.remove(workdir);
    await fs.remove(bindir);
  }
}

/** Name, raw run, and whether a completed review must be credited. */
const PARITY: ReadonlyArray<
  readonly [string, Record<string, unknown>, boolean]
> = [
  ["the completed multiline result", rawCheckRun(), true],
  [
    "the completed result with CRLF endings",
    rawCheckRun({
      output: {
        title: FINISHED,
        summary: COMPLETED_SUMMARY.replaceAll("\n", "\r\n"),
      },
    }),
    true,
  ],
  [
    "a declared-proof title with no summary",
    rawCheckRun({ output: { title: REVIEW_COMPLETED, summary: null } }),
    true,
  ],
  [
    "a declared-proof title beside a plain summary",
    rawCheckRun({
      output: {
        title: REVIEW_COMPLETED,
        summary: "Legacy reviewer details\nFiles inspected: 3",
      },
    }),
    true,
  ],
  [
    "Finished alone",
    rawCheckRun({ output: { title: FINISHED, summary: null } }),
    false,
  ],
  ["the measured rate limit", RATE_LIMITED_RUN, false],
  [
    "the measured pause",
    rawCheckRun({
      conclusion: "skipped",
      output: { title: "Review paused", summary: PAUSED_SUMMARY },
    }),
    false,
  ],
  [
    "the completed result on a neutral run",
    rawCheckRun({ conclusion: "neutral" }),
    false,
  ],
  [
    "the completed result on a queued run",
    rawCheckRun({ status: "queued", conclusion: null }),
    false,
  ],
  [
    "an unknown result under a positive title",
    rawCheckRun({
      output: {
        title: REVIEW_COMPLETED,
        summary: "Result: Unknown - Review completed",
      },
    }),
    false,
  ],
  [
    "the completed result on a later line",
    rawCheckRun({
      output: { title: FINISHED, summary: `Metadata\n${COMPLETED_RESULT}` },
    }),
    false,
  ],
  [
    "a rate-limit title over a completed summary",
    rawCheckRun({
      output: { title: RATE_LIMITED, summary: COMPLETED_SUMMARY },
    }),
    false,
  ],
];

describe("the decoding agrees with the registration prover's (#4547)", () => {
  it.each(PARITY)(
    "%s — both provers answer the same",
    async (_name, run, credited) => {
      const mine = onlyReading(
        runThirdPartyReviewCli({ checkRuns: [run] }, process.env)
      );

      expect(mine.reviewed).toBe(credited);
      expect(await registrationCredits(run)).toBe(credited);
    }
  );
});
