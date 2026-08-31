/**
 * §10.4 — the REPORTING half publishes best effort, and its exit code answers
 * "is the suite green".
 *
 * The defect these cases pin is one a repository actually ran into: GitHub
 * Issues were switched off, so the reporter took HTTP 410 on
 * `POST /repos/{o}/{r}/issues` after three attempts and exited 1 — every night
 * the suite was red, which is every night the reporter exists for. A dead
 * PUBLISHER was reported as a dead REPORTER, and because the verdict was only
 * ever written after publishing, no verdict was written at all.
 *
 * The fix has two directions and they must both hold, because either one alone
 * is worse than the bug:
 *
 *   * A failed publish must NOT fail the job — otherwise an outage in an
 *     optional notification channel takes the report channel down with it.
 *   * A genuinely red SUITE MUST fail the job — otherwise absorbing publish
 *     failures leaves this entry point with no failing path at all, and a job
 *     that cannot go red is a job whose green means nothing.
 *
 * Specification: `docs/nightly-e2e-gate.md` §10.4.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  BRANCH,
  fakeResponse,
  loadGateModule,
} from "../../helpers/nightly-e2e-gate-harness";

/** The verdict heading, which must appear whatever publishing did. */
const VERDICT_HEADING = "Nightly E2E verdict";

/** The annotation a genuinely red suite earns. */
const RED_ANNOTATION = "::error title=Nightly E2E is not green::";

/** The suite every case speaks about. */
const LABEL = "Maestro native e2e";

/** The guard, plus the entry point only this file exercises. */
interface ReportCli {
  reportIssues(asJson: boolean): Promise<void>;
  suiteMarker(label: string): string;
}

let mod: ReportCli;

beforeAll(async () => {
  mod = (await loadGateModule()) as unknown as ReportCli;
});

/** Scratch directories to remove once the file is done with them. */
const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
  process.exitCode = undefined;
});

/**
 * A run created an hour ago, so it is fresh against the real clock.
 *
 * `planReport` stamps `now` from `new Date()` rather than from an injectable
 * clock, so a fixed fixture timestamp would age out of the freshness window and
 * make every case here read `no_run` a few days after it was written.
 *
 * @param conclusion - The run's conclusion
 * @returns One workflow run
 */
function freshRun(conclusion: string): Record<string, unknown> {
  return {
    id: 42,
    conclusion,
    status: "completed",
    created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    html_url: "https://example.test/run/42",
    event: "schedule",
    head_branch: BRANCH,
    head_sha: "a".repeat(40),
  };
}

/** What one run of `reportIssues` produced. */
interface Reported {
  readonly exitCode: number | string | undefined;
  readonly stdout: string;
  readonly stderr: string;
  readonly summary: string;
  readonly writes: readonly string[];
  /**
   * The summary file as it stood the instant the FIRST write was attempted.
   *
   * The ordering guarantee in prose form — "the verdict exists regardless of
   * what happens next" — is not observable from the finished file, because a
   * verdict written after a publish that merely failed still lands. This reads
   * the sink mid-flight instead, which is the only way to tell "written first"
   * from "written eventually".
   */
  readonly summaryAtFirstWrite: string | null;
}

/**
 * Runs the reporting CLI against a stubbed Issues API and a real summary file.
 *
 * @param options - `conclusion` of the nightly run, and how the POST answers
 * @returns Everything the run surfaced
 */
async function report(options: {
  conclusion: string;
  publish?: (url: string) => unknown;
  openIssues?: readonly unknown[];
  issuesReadable?: boolean;
  /** Point `$GITHUB_STEP_SUMMARY` at a path no `appendFileSync` can open. */
  summaryWritable?: boolean;
}): Promise<Reported> {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-nightly-report-"));
  scratch.push(dir);
  const summaryPath =
    options.summaryWritable === false
      ? path.join(dir, "no-such-directory", "summary.md")
      : path.join(dir, "summary.md");

  const writes: string[] = [];
  let summaryAtFirstWrite: string | null = null;
  (globalThis as { fetch: unknown }).fetch = async (
    url: string,
    init?: { method?: string }
  ): Promise<unknown> => {
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      // `appendFileSync` creates the file, so "not there yet" is a real state
      // and it is exactly the state a verdict written too late leaves behind.
      summaryAtFirstWrite ??= existsSync(summaryPath)
        ? readFileSync(summaryPath, "utf8")
        : "";
      writes.push(`${method} ${url}`);
      return (
        options.publish?.(url) ??
        fakeResponse(201, {}, { number: 7, node_id: "n" })
      );
    }
    if (url.includes("/actions/workflows/")) {
      return fakeResponse(
        200,
        {},
        {
          workflow_runs: url.includes("event=schedule")
            ? [freshRun(options.conclusion)]
            : [],
        }
      );
    }
    if (url.includes("/jobs"))
      return fakeResponse(
        200,
        {},
        { jobs: [{ name: "🤖 Android", conclusion: options.conclusion }] }
      );
    if (url.includes("/artifacts"))
      return fakeResponse(200, {}, { artifacts: [] });
    // No branch rules: the gate is `not_required`, which keeps the label probe
    // out of these cases. Requiredness is §10.7's subject, not this file's.
    if (url.includes("/rules/branches/")) return fakeResponse(200, {}, []);
    if (url.includes("/issues"))
      return options.issuesReadable === false
        ? fakeResponse(410, {}, {})
        : fakeResponse(200, {}, options.openIssues ?? []);
    throw new Error(`unexpected GET ${url}`);
  };

  const stdout: string[] = [];
  const stderr: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  const realEnv = process.env;

  process.stdout.write = ((chunk: string) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  process.env = {
    ...realEnv,
    GITHUB_TOKEN: "t",
    GITHUB_REPOSITORY: "o/r",
    GITHUB_API_URL: "https://api.test",
    GITHUB_STEP_SUMMARY: summaryPath,
    NIGHTLY_BRANCH: BRANCH,
    NIGHTLY_SUITES: JSON.stringify([
      { label: LABEL, workflow: "maestro-e2e.yml", match: { mode: "run" } },
    ]),
    // One attempt, so a refused write costs no wall-clock backoff. `reportIssues`
    // takes the real `sleep`; the retry ceiling is the only lever a test has.
    NIGHTLY_API_MAX_ATTEMPTS: "1",
  };
  process.exitCode = undefined;

  try {
    await mod.reportIssues(false);
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    process.env = realEnv;
  }

  const exitCode = process.exitCode;
  process.exitCode = undefined;
  return {
    exitCode,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    summary: existsSync(summaryPath) ? readFileSync(summaryPath, "utf8") : "",
    writes,
    summaryAtFirstWrite,
  };
}

describe("§10.4 — publishing is best effort", () => {
  it("a red suite whose publish is REFUSED still reports, and does not fail on the publish", async () => {
    const outcome = await report({
      conclusion: "failure",
      // Exactly what a repository with Issues switched off returns.
      publish: () => fakeResponse(410, {}, {}),
    });

    // The verdict exists regardless of what happened next — and it was written
    // BEFORE the write was attempted, which is the ordering that makes it true.
    expect(outcome.summary).toContain(VERDICT_HEADING);
    expect(outcome.summary).toContain(LABEL);
    expect(outcome.summary.indexOf(VERDICT_HEADING)).toBeLessThan(
      outcome.summary.indexOf("Nightly E2E tracking issues")
    );
    // …and it was already there at the moment the write went out, which is the
    // guarantee. A verdict written afterwards would survive a publish that
    // merely FAILED, and be lost to a job the runner killed mid-publish.
    expect(outcome.summaryAtFirstWrite).toContain(VERDICT_HEADING);
    // The publish was genuinely attempted and genuinely refused.
    expect(outcome.writes.some(write => write.startsWith("POST"))).toBe(true);
    // And it surfaced as a WARNING naming the cause, never as an error.
    expect(outcome.stderr).toContain(
      "::warning title=Nightly E2E tracking issue not updated::"
    );
    expect(outcome.stderr).toContain("410");
    expect(outcome.stderr).not.toContain(
      "::error title=Nightly E2E tracking issue"
    );
  });

  it("a GREEN suite whose publish is refused passes, and never attempts a write", async () => {
    const outcome = await report({
      conclusion: "success",
      publish: () => fakeResponse(410, {}, {}),
    });

    // Row 30 / `green_untracked`: nothing to track, so nothing is written. This
    // is why the 410 was invisible for weeks — the failure is CONDITIONAL.
    expect(outcome.writes).toEqual([]);
    expect(outcome.exitCode).toBeUndefined();
    expect(outcome.summary).toContain(VERDICT_HEADING);
  });

  it("a green suite whose publish would succeed still passes", async () => {
    const outcome = await report({ conclusion: "success" });
    expect(outcome.exitCode).toBeUndefined();
    expect(outcome.stderr).not.toContain("::error");
  });

  it("a GREEN suite whose close is REFUSED passes — the publish cannot redden it", async () => {
    // The bite that separates this fix from the bug it replaces, because it is
    // the one case where the two exit-code contracts disagree: the suite is
    // green, so nothing is wrong with the software, and the only thing that
    // failed is the optional publisher. The old contract exited 1 here.
    const outcome = await report({
      conclusion: "success",
      openIssues: [{ number: 983, node_id: "n", body: mod.suiteMarker(LABEL) }],
      publish: () => fakeResponse(410, {}, {}),
    });

    // The close comment goes first and is what the refusal lands on, so the
    // `PATCH state=closed` behind it is never reached. Either way a write was
    // attempted and refused, which is the condition under test.
    expect(outcome.writes.length).toBeGreaterThan(0);
    expect(outcome.exitCode).toBeUndefined();
    expect(outcome.stderr).toContain(
      "::warning title=Nightly E2E tracking issue not updated::"
    );
    expect(outcome.summary).toContain(VERDICT_HEADING);
  });

  it("an Issues API that cannot even be LISTED still produces the verdict", async () => {
    // Listing open issues is the same API the writes use, so a verdict that
    // depended on it would still die with its publisher. Everything the verdict
    // needs comes from Actions run history instead.
    const outcome = await report({
      conclusion: "success",
      issuesReadable: false,
    });

    expect(outcome.exitCode).toBeUndefined();
    expect(outcome.summary).toContain(VERDICT_HEADING);
    expect(outcome.summary).toContain("Nothing was published");
    expect(outcome.stderr).toContain(
      "::warning title=Nightly E2E tracking issues not published::"
    );
  });

  it("an UNWRITABLE job summary takes down neither the publish nor the job", async () => {
    // The summary is a rendering surface, not the verdict — the same report is
    // on stdout. Left to propagate, an unopenable `$GITHUB_STEP_SUMMARY` would
    // reach top-level `main` and fail the job *and* skip publishing, which is
    // this section's defect wearing different clothes.
    const outcome = await report({
      conclusion: "success",
      openIssues: [{ number: 983, node_id: "n", body: mod.suiteMarker(LABEL) }],
      summaryWritable: false,
    });

    expect(outcome.summary).toBe("");
    expect(outcome.stderr).toContain(
      "::warning title=Nightly E2E job summary unwritable::"
    );
    // Publishing still happened, and the green suite still closed its issue.
    expect(outcome.writes.length).toBeGreaterThan(0);
    expect(outcome.exitCode).toBeUndefined();
    // The report itself is not lost — it went to the log.
    expect(outcome.stdout).toContain(VERDICT_HEADING);
  });

  it("an unlistable Issues API does not hide a red suite either", async () => {
    const outcome = await report({
      conclusion: "failure",
      issuesReadable: false,
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.summary).toContain(VERDICT_HEADING);
    expect(outcome.stderr).toContain(RED_ANNOTATION);
  });
});

describe("§10.4 — the exit code answers 'is the suite green'", () => {
  it("a genuinely RED suite fails the job, with the publish working", async () => {
    const outcome = await report({ conclusion: "failure" });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(RED_ANNOTATION);
    expect(outcome.stderr).toContain(LABEL);
    expect(outcome.writes.some(write => write.startsWith("POST"))).toBe(true);
  });

  it("a genuinely RED suite fails the job even when the publish is refused", async () => {
    // The two directions crossed: this is the case the old code got backwards
    // for the right-looking reason. It failed — but on the publish, so the same
    // exit code would have appeared over a GREEN suite too.
    const outcome = await report({
      conclusion: "failure",
      publish: () => fakeResponse(410, {}, {}),
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(RED_ANNOTATION);
  });

  it("a verdict that cannot be resolved at all still fails the job", async () => {
    // Configuration is the one reporting failure that still exits non-zero:
    // nothing was reported, and "we could not check" must never render as "it
    // is fine".
    const realEnv = process.env;
    const stderr: string[] = [];
    const realErr = process.stderr.write.bind(process.stderr);
    const realOut = process.stdout.write.bind(process.stdout);
    process.stderr.write = ((chunk: string) => {
      stderr.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    process.stdout.write = (() => true) as typeof process.stdout.write;
    process.env = { ...realEnv, GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "o/r" };
    process.exitCode = undefined;
    try {
      await mod.reportIssues(false);
    } finally {
      process.stderr.write = realErr;
      process.stdout.write = realOut;
      process.env = realEnv;
    }
    const exitCode = process.exitCode;
    process.exitCode = undefined;

    expect(exitCode).toBe(1);
    expect(stderr).toContainEqual(
      expect.stringContaining("::error title=Nightly E2E reporting failed::")
    );
  });
});
