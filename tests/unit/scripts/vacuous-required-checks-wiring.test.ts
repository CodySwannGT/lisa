/**
 * Tests for what makes the VACUITY arm a gate rather than a flag nobody passes.
 *
 * Sibling of `vacuous-required-checks.test.ts`, which covers the detection.
 * The detection was never the problem: pointed at a real rate-limited pull
 * request it produces exactly the right finding, and has since #2497.
 *
 * MEASURED (CodySwannGT/lisa#2928): **nothing invoked it.** `quality.yml` ran
 * the guard's OFFLINE arm with no `--pr`, a then-shipped scheduled drift
 * workflow ran its own arm, and the package script named `check:vacuous-required-checks`
 * was a bare invocation — so the command named for the vacuous check reported on
 * SKIPS and said nothing about vacuity unless a caller happened to remember
 * `-- --pr=1234`. `declared-but-uncallable`: the family the guard exists to
 * describe, reproduced one level up inside its own shipping.
 *
 * On the repository that owns it, of the last 25 merged pull requests:
 *
 * ```
 *   9  CodeRabbit  success  "Review rate limited"
 *  14  CodeRabbit  success  "Review skipped: manual review required for this OSS repository"
 *   2  CodeRabbit  success  "Review completed"
 * ```
 *
 * `CodeRabbit` is a REQUIRED context there, so 23 of 25 merges recorded a
 * satisfied review gate for a review that did not happen.
 *
 * Three properties are asserted here, and each one fails against the unwired
 * state rather than merely describing the fixed one:
 *
 *  - the package script and a shipped pull-request workflow really invoke it;
 *  - it resolves the pull request itself, so nothing depends on a flag;
 *  - it REFUSES rather than reporting all-clear from an inspection that never
 *    happened — an empty inspection and a clean pull request are otherwise the
 *    same sentence.
 *
 * @module tests/unit/scripts/vacuous-required-checks-wiring
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { loadWorkflow } from "../../helpers/workflow-test-utils.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_REL =
  "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs";
const CI_WORKFLOW = ".github/workflows/ci.yml";

/** The measured CodeRabbit context name. */
const CODERABBIT = "CodeRabbit";

/** The measured hollow description — `success` while reviewing nothing. */
const RATE_LIMITED = "Review rate limited";

/** The measured description of a review that really happened. */
const REVIEWED = "Review completed";

/** A review check that has not settled yet. */
const REVIEW_IN_PROGRESS = "Review in progress";

/** Fixed check-run creation times used by newest-run ordering controls. */
const OLDER_CREATED_AT = "2026-08-26T10:00:00Z";
const NEWER_CREATED_AT = "2026-08-26T11:00:00Z";

/** The refusal heading printed when no review evidence was inspected. */
const NOT_INSPECTED = "NOT INSPECTED";

/** Two successive pull-request heads used to prove roster provenance. */
const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

/** The flag that wires the arm, rather than leaving it for a caller to recall. */
const VACUITY = "--vacuity";

/** Turns vacuity findings into build failures. */
const FAIL_ON_VACUOUS = "--fail-on-vacuous";

/** Turns an unsatisfied review-evidence finding into a build failure. */
const REQUIRE_REVIEW_EVIDENCE = "--require-review-evidence";

/**
 * The two copies of the review-evidence workflow, and why there are two.
 *
 * `typescript/create-only/...` is the seed a consumer receives once and then
 * owns; `.github/workflows/...` is the same workflow pointed at Lisa itself,
 * because Lisa is the repository the defect was measured on. Every wiring
 * assertion runs against BOTH — a fix that reached only the seed would leave
 * the repository that found the defect still carrying it.
 */
const REVIEW_EVIDENCE_WORKFLOWS: readonly (readonly [string, string])[] = [
  ["typescript/create-only/.github/workflows/review-evidence.yml", "seed"],
  [".github/workflows/review-evidence.yml", "Lisa's own"],
];

/** Disables the settle wait, so a unit test never sleeps. */
const NO_WAIT = "--settle-timeout=0";

/** The throwaway repository slug the stubbed `gh` answers for. */
const STUB_REPO = "--repo=owner/name";

/** One check row, as both fetch routes normalise them. */
interface CheckRow {
  readonly name: string;
  readonly state: string;
  readonly bucket?: string;
  readonly description?: string;
}

interface RawCheckRun {
  readonly created_at: string;
  readonly id: number;
  readonly name: string;
  readonly started_at: string | null;
  readonly completed_at: string | null;
}

/** One violation. */
interface Violation {
  readonly kind: string;
}

/** The refusal a run carries when it inspected nothing. */
interface Refusal {
  readonly kind: string;
  readonly reason: string;
}

/** The vacuity inspection `runGuard` returns. */
interface Inspection {
  readonly pr: string | undefined;
  readonly prSource: string | null;
  readonly headSha: string | undefined;
  readonly checked: number;
  readonly violations: readonly Violation[];
  readonly gateStates?: Record<string, string>;
  readonly settled: boolean;
  readonly refusal: Refusal | null;
}

/** The guard's wiring exports, as this suite consumes them. */
interface GuardModule {
  readonly VACUITY_REFUSALS: Record<string, string>;
  readonly SETTLE_TIMEOUT_SECONDS: number;
  readonly SETTLE_INTERVAL_SECONDS: number;
  resolvePullRequestNumber(
    argv: readonly string[],
    env?: Record<string, string | undefined>,
    options?: { probeBranch?: (repo?: string) => string | undefined }
  ): { pr: string | undefined; source: string | null };
  declaredEvidenceChecks(declaration: Record<string, unknown>): string[];
  checksSettled(
    declaration: Record<string, unknown>,
    checks: readonly CheckRow[]
  ): boolean;
  mergeCheckRows(
    statuses: readonly CheckRow[],
    runs: readonly CheckRow[]
  ): CheckRow[];
  newestCheckRuns(runs: readonly RawCheckRun[]): RawCheckRun[];
  fetchSettledChecks(
    declaration: Record<string, unknown>,
    pr: string,
    repo: string | undefined,
    options?: Record<string, unknown>
  ): { checks: CheckRow[]; settled: boolean; headSha: string | undefined };
  vacuityRefusal(input: {
    declaration: Record<string, unknown>;
    pr?: string;
    checks?: readonly CheckRow[];
    error?: unknown;
  }): Refusal | null;
  inspectVacuity(
    argv: readonly string[],
    declaration: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Inspection | undefined;
}

/**
 * A declaration that treats CodeRabbit as evidence-bearing.
 *
 * @param overrides - Keys merged over the base declaration
 * @returns A declaration object
 */
function declarationWith(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    required_contexts: [CODERABBIT],
    workflows: [CI_WORKFLOW],
    skip_job_declarations: {},
    evidence_bearing_checks: { [CODERABBIT]: {} },
    ...overrides,
  };
}

/**
 * One settled CodeRabbit row.
 *
 * @param description - The description the check reported
 * @returns A check row
 */
function coderabbit(description: string): CheckRow {
  return {
    name: CODERABBIT,
    state: "SUCCESS",
    bucket: "pass",
    description,
  };
}

/**
 * Reads a JSON file from the repository.
 *
 * @param relative - Repo-relative path
 * @returns The parsed contents
 */
function readRepoJson(relative: string): Record<string, never> {
  return JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, relative), "utf-8")
  ) as Record<string, never>;
}

/**
 * Builds a throwaway repository the CLI can run against.
 *
 * @param declaration - The declaration to write
 * @returns The repository root
 */
function repoDeclaring(declaration: Record<string, unknown>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vacuity-wiring-"));
  fs.mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(
    path.join(root, CI_WORKFLOW.replace(/\//gu, path.sep)),
    "      skip_jobs: ''"
  );
  fs.writeFileSync(
    path.join(root, ".github", "required-checks.json"),
    JSON.stringify({
      ruleset: { baseline_fetched_at: new Date().toISOString().slice(0, 10) },
      ...declaration,
    })
  );
  return root;
}

/**
 * Installs a `gh` on PATH that resolves one head and serves its check evidence.
 *
 * A stub rather than a mock, because the property under test is what the
 * SHIPPED CLI does end to end — exit code included — and a mocked module import
 * cannot observe an exit code.
 *
 * @param rows - The rows `gh pr checks --json` should print, or null to fail
 * @param laterPage - Put the rows on a second simulated status page
 * @returns A directory to prepend to PATH
 */
function stubGh(rows: readonly CheckRow[] | null, laterPage = false): string {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "vacuity-bin-"));
  const payload = path.join(bin, "checks.json");
  fs.writeFileSync(
    payload,
    `${laterPage ? "[]\n" : ""}${JSON.stringify(rows ?? [])}\n`
  );
  const apiAnswer = rows === null ? "exit 1" : `cat ${JSON.stringify(payload)}`;
  fs.writeFileSync(
    path.join(bin, "gh"),
    `#!/bin/sh
case "$1:$2" in
  pr:view) printf '%s\n' ${JSON.stringify(HEAD_A)} ;;
  pr:checks) ${rows === null ? "exit 1" : `cat ${JSON.stringify(payload)}`} ;;
  api:*/pulls/*/commits*) printf '%s\n' '[]' ;;
  api:*/commits/*/pulls*) printf '%s\n' '[]' ;;
  api:*/pulls/*) printf '%s\n' '0' ;;
  api:*status*) ${apiAnswer} ;;
  api:*check-runs*) ${rows === null ? "exit 1" : "printf '%s\\n' '[]'"} ;;
  *) exit 1 ;;
esac
`,
    { mode: 0o755 }
  );
  return bin;
}

/**
 * Runs the shipped CLI against a throwaway repository.
 *
 * @param root - Repository root
 * @param argv - Extra CLI arguments
 * @param bin - Directory holding the `gh` stub
 * @returns Exit status and combined output
 */
function runCli(
  root: string,
  argv: readonly string[],
  bin: string
): { status: number; output: string } {
  const run = boundedSpawnSync({
    label: "check-skipped-required-checks.mjs --vacuity",
    command: process.execPath,
    args: [path.join(REPO_ROOT, SCRIPT_REL), root, ...argv],
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
      GITHUB_EVENT_PATH: "",
      GITHUB_REF: "",
      GITHUB_STEP_SUMMARY: "",
    },
  });
  return {
    status: run.status ?? -1,
    output: `${run.stdout ?? ""}${run.stderr ?? ""}`,
  };
}

describe("the vacuity arm, as something that actually runs", () => {
  let mod: GuardModule;

  beforeAll(async () => {
    mod = (await import(
      pathToFileURL(path.join(REPO_ROOT, SCRIPT_REL)).href
    )) as unknown as GuardModule;
  });

  describe("something invokes it (#2928)", () => {
    it("`check:vacuous-required-checks` passes `--vacuity`, not a bare run", () => {
      // THE MEASURED DEFECT. The command named for the vacuous check ran the
      // OFFLINE skip arm and said nothing whatsoever about vacuity.
      const template = readRepoJson(
        "typescript/package-lisa/package.lisa.json"
      ) as unknown as {
        force: { scripts: Record<string, string> };
      };
      expect(template.force.scripts["check:vacuous-required-checks"]).toContain(
        "--vacuity"
      );
    });

    it("is a `force` script, so a bump cannot leave a consumer on the bare form", () => {
      // `defaults` would let the broken command survive upstream forever in
      // every repository that already has one — which is every repository.
      const template = readRepoJson(
        "typescript/package-lisa/package.lisa.json"
      ) as unknown as {
        force?: { scripts?: Record<string, string> };
        defaults?: { scripts?: Record<string, string> };
      };
      expect(
        template.force?.scripts?.["check:vacuous-required-checks"]
      ).toBeDefined();
      expect(
        template.defaults?.scripts?.["check:vacuous-required-checks"]
      ).toBeUndefined();
    });

    it("Lisa runs the arm on ITSELF, from the in-repo template path", () => {
      // Lisa mirrors only two of its eleven copy-overwrite scripts under
      // `scripts/`, so a script pointing at `scripts/` here would be a command
      // nobody can run — the same defect in a new place.
      const own = readRepoJson("package.json") as unknown as {
        scripts: Record<string, string>;
      };
      const command = own.scripts["check:vacuous-required-checks"];
      expect(command).toBeDefined();
      expect(command).toContain("--vacuity");
      expect(fs.existsSync(path.join(REPO_ROOT, SCRIPT_REL))).toBe(true);
      expect(command).toContain(SCRIPT_REL);
    });

    it.each(REVIEW_EVIDENCE_WORKFLOWS)(
      "%s runs the arm on every pull request",
      relative => {
        const workflow = loadWorkflow(path.join(REPO_ROOT, relative));
        // `on: pull_request` is the whole point: a schedule would reproduce
        // a scheduled workflow, which is what the arm was NOT.
        expect(workflow.on?.pull_request).toBeDefined();
        const steps = workflow.jobs?.vacuity?.steps ?? [];
        const step = steps.find(candidate =>
          candidate.run?.includes("--vacuity")
        );
        expect(
          step,
          `${relative} must run the guard with --vacuity`
        ).toBeTruthy();
      }
    );

    it.each(REVIEW_EVIDENCE_WORKFLOWS)(
      "%s grants the scopes reading checks needs",
      relative => {
        // `gh pr checks` resolves the rollup via `checkSuite.workflowRun`, so
        // without `actions: read` it exits non-zero with EMPTY stdout — a failure
        // that reads as a content bug and never says "permission". The fallback
        // route needs the other two.
        const workflow = loadWorkflow(
          path.join(REPO_ROOT, relative)
        ) as unknown as {
          permissions?: Record<string, string>;
        };
        expect(workflow.permissions?.actions).toBe("read");
        // `write` since #3639 — the verdict-publishing step creates a check run,
        // and `checks: write` subsumes the read this arm needs. Asserted as a
        // membership rather than an equality so a repository that has not taken
        // the publishing step is still held to the read.
        expect(["read", "write"]).toContain(workflow.permissions?.checks);
        expect(workflow.permissions?.statuses).toBe("read");
      }
    );

    it.each(REVIEW_EVIDENCE_WORKFLOWS)(
      "%s publishes the verdict as its own check run (#3639)",
      relative => {
        // The defect this pins: the job exits 0 for a SATISFIED gate and 0 for a
        // WAIVED one, so `gh pr checks` printed `pass` for a pull request nothing
        // read. Measured on this repository, 39 of the last 40 merged pull
        // requests took the waived path — the disguise was the DEFAULT rendering.
        // A step that republishes the guard's chosen conclusion is the only thing
        // that reaches the layer a merge decision consults.
        const full = path.join(REPO_ROOT, relative);
        const workflow = loadWorkflow(full) as unknown as {
          permissions?: Record<string, string>;
          jobs?: {
            vacuity?: {
              steps?: {
                name?: string;
                id?: string;
                run?: string;
                if?: string;
                env?: Record<string, string>;
              }[];
            };
          };
        };
        const steps = workflow.jobs?.vacuity?.steps ?? [];
        const guard = steps.find(step => step.run?.includes("--vacuity"));
        const publish = steps.find(step => step.run?.includes("check-runs"));
        // The whole step, `if` + `env` + `run`, because the wiring is spread
        // across all three: the expression is read in `env`, the shell reads the
        // variable in `run`, and `if` gates on the same output.
        const wiring = JSON.stringify(publish ?? {});

        expect(
          guard?.id,
          `${relative}: the guard step needs an id for the publisher to read its outputs`
        ).toBe("review_evidence");
        expect(
          publish,
          `${relative}: nothing republishes the verdict as a check run`
        ).toBeTruthy();
        // `always()` because the guard step exits non-zero on an unsatisfied
        // gate, which is exactly the run whose verdict most needs publishing.
        expect(publish?.if).toContain("always()");
        // The conclusion comes from the GUARD, never from a literal in YAML. A
        // hardcoded `success` here would be the defect rewritten one layer out.
        expect(wiring).toContain(
          "steps.review_evidence.outputs.review_evidence_conclusion"
        );
        expect(publish?.run).toContain('conclusion="$VERDICT_CONCLUSION"');
        expect(publish?.run).not.toMatch(
          /conclusion=(success|neutral|failure)\b/u
        );
        expect(workflow.permissions?.checks).toBe("write");
      }
    );

    it.each(REVIEW_EVIDENCE_WORKFLOWS)(
      "%s asks for the waive rate it used to keep in a comment",
      relative => {
        const workflow = loadWorkflow(path.join(REPO_ROOT, relative));
        const steps = workflow.jobs?.vacuity?.steps ?? [];
        const guard = steps.find(step => step.run?.includes("--vacuity"));

        expect(guard?.run).toContain("--waive-rate-sample=");
      }
    );
  });

  describe("it resolves the pull request itself", () => {
    /** A probe that asserts it is never consulted. */
    const noProbe = (): string | undefined => {
      throw new Error(
        "the branch probe must not run when an earlier source answered"
      );
    };

    it("prefers an explicit `--pr`", () => {
      expect(
        mod.resolvePullRequestNumber(
          ["--pr=1234"],
          {},
          { probeBranch: noProbe }
        )
      ).toEqual({ pr: "1234", source: "--pr" });
    });

    it("reads the `pull_request` payload Actions wrote for THIS run", () => {
      const event = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), "vacuity-event-")),
        "event.json"
      );
      fs.writeFileSync(event, JSON.stringify({ pull_request: { number: 42 } }));
      expect(
        mod.resolvePullRequestNumber(
          [],
          { GITHUB_EVENT_PATH: event },
          { probeBranch: noProbe }
        )
      ).toEqual({ pr: "42", source: "GITHUB_EVENT_PATH" });
    });

    it("falls back to `refs/pull/N/merge` in GITHUB_REF", () => {
      expect(
        mod.resolvePullRequestNumber(
          [],
          { GITHUB_REF: "refs/pull/77/merge" },
          { probeBranch: noProbe }
        )
      ).toEqual({ pr: "77", source: "GITHUB_REF" });
    });

    it("ignores a branch ref, which names no pull request", () => {
      expect(
        mod.resolvePullRequestNumber(
          [],
          { GITHUB_REF: "refs/heads/main" },
          { probeBranch: () => undefined }
        ).pr
      ).toBeUndefined();
    });

    it("finally asks about the checked-out branch", () => {
      expect(
        mod.resolvePullRequestNumber([], {}, { probeBranch: () => "9" })
      ).toEqual({ pr: "9", source: "gh pr view" });
    });

    it("returns undefined rather than picking a pull request", () => {
      // A guard that examined SOMETHING when it could not tell what would be
      // worse than one that refuses: it would render a verdict about the wrong
      // pull request and look exactly like a real one.
      expect(
        mod.resolvePullRequestNumber([], {}, { probeBranch: () => undefined })
      ).toEqual({ pr: undefined, source: null });
    });
  });

  describe("it waits for the declared checks to SETTLE", () => {
    it("selects the newest same-name run before settlement", () => {
      const older = {
        created_at: OLDER_CREATED_AT,
        id: 10,
        name: CODERABBIT,
        started_at: OLDER_CREATED_AT,
        completed_at: "2026-08-26T10:01:00Z",
      };
      const newer = {
        created_at: NEWER_CREATED_AT,
        id: 11,
        name: CODERABBIT,
        started_at: NEWER_CREATED_AT,
        completed_at: null,
      };
      expect(mod.newestCheckRuns([newer, older])).toEqual([newer]);
    });
    it("does not let an older run's late completion outrank a newer start", () => {
      const older = {
        created_at: OLDER_CREATED_AT,
        id: 10,
        name: CODERABBIT,
        started_at: OLDER_CREATED_AT,
        completed_at: "2026-08-26T11:30:00Z",
      };
      const newer = {
        created_at: NEWER_CREATED_AT,
        id: 11,
        name: CODERABBIT,
        started_at: NEWER_CREATED_AT,
        completed_at: null,
      };
      expect(mod.newestCheckRuns([older, newer])).toEqual([newer]);
    });
    it("keeps a newer queued run ahead of an older completed run", () => {
      const older = {
        completed_at: "2026-08-26T10:01:00Z",
        created_at: OLDER_CREATED_AT,
        id: 10,
        name: CODERABBIT,
        started_at: "2026-08-26T10:00:05Z",
      };
      const queued = {
        completed_at: null,
        created_at: NEWER_CREATED_AT,
        id: 11,
        name: CODERABBIT,
        started_at: null,
      };

      expect(mod.newestCheckRuns([older, queued])).toEqual([queued]);
    });
    it("uses the check run when a status reports the same context name", () => {
      const pendingRun: CheckRow = {
        name: CODERABBIT,
        state: "PENDING",
        bucket: "pending",
        description: REVIEW_IN_PROGRESS,
      };
      const rows = mod.mergeCheckRows(
        [coderabbit("status reporter finished")],
        [pendingRun]
      );

      expect(rows).toEqual([pendingRun]);
      expect(mod.checksSettled(declarationWith(), rows)).toBe(false);
    });

    it("keeps the check-run evidence after a same-name collision settles", () => {
      const rows = mod.mergeCheckRows(
        [coderabbit(REVIEWED)],
        [coderabbit(RATE_LIMITED)]
      );

      expect(rows).toEqual([coderabbit(RATE_LIMITED)]);
      expect(mod.checksSettled(declarationWith(), rows)).toBe(true);
    });

    it("treats a pending bucket, a PENDING state, and an absent row as unsettled", () => {
      // A review bot posts `pending — "Review queued"` and then
      // `pending — "Review in progress"` before it settles, in about nine
      // seconds, and identically on a pull request it reviews and one it rate
      // limits. Both strings are in the no_work vocabulary, so judging on
      // arrival manufactures a finding on EVERY pull request.
      const declaration = declarationWith();
      expect(
        mod.checksSettled(declaration, [
          {
            name: CODERABBIT,
            state: "PENDING",
            bucket: "pending",
            description: "Review queued",
          },
        ])
      ).toBe(false);
      expect(
        mod.checksSettled(declaration, [
          {
            name: CODERABBIT,
            state: "PENDING",
            description: REVIEW_IN_PROGRESS,
          },
        ])
      ).toBe(false);
      expect(mod.checksSettled(declaration, [])).toBe(false);
      expect(mod.checksSettled(declaration, [coderabbit(RATE_LIMITED)])).toBe(
        true
      );
    });

    it("re-reads until the declared check settles, then stops", () => {
      const pages: readonly CheckRow[][] = [
        [],
        [
          {
            name: CODERABBIT,
            state: "PENDING",
            bucket: "pending",
            description: "Review queued",
          },
        ],
        [coderabbit(RATE_LIMITED)],
      ];
      const reads: number[] = [];
      const result = mod.fetchSettledChecks(declarationWith(), "1", undefined, {
        timeoutSeconds: 300,
        intervalSeconds: 15,
        // Injected clock and sleep: the property is the loop, not the wall time.
        now: () => reads.length * 1000,
        sleep: () => undefined,
        fetch: () => {
          const page = pages[Math.min(reads.length, pages.length - 1)];
          reads.push(1);
          return page;
        },
        headSha: () => HEAD_A,
      });
      expect(result.settled).toBe(true);
      expect(result.checks).toEqual([coderabbit(RATE_LIMITED)]);
      expect(result.headSha).toBe(HEAD_A);
      expect(reads.length).toBe(3);
    });

    it("discards a roster when the PR head changes during the read", () => {
      let clock = 0;
      const heads = [HEAD_A, HEAD_B, HEAD_B, HEAD_B];
      const fetched: string[] = [];
      const result = mod.fetchSettledChecks(declarationWith(), "1", undefined, {
        timeoutSeconds: 30,
        intervalSeconds: 15,
        now: () => clock,
        sleep: (ms: number) => {
          clock += ms;
        },
        headSha: () => heads.shift() ?? HEAD_B,
        fetch: () => {
          fetched.push(heads.length >= 2 ? HEAD_A : HEAD_B);
          return [coderabbit(REVIEWED)];
        },
      });

      expect(fetched).toEqual([HEAD_A, HEAD_B]);
      expect(result.headSha).toBe(HEAD_B);
      expect(result.checks).toEqual([coderabbit(REVIEWED)]);
      expect(result.settled).toBe(true);
    });

    it("refuses a roster whose head never stays stable before the deadline", () => {
      let clock = 0;
      let head = HEAD_A;
      expect(() =>
        mod.fetchSettledChecks(declarationWith(), "1", undefined, {
          timeoutSeconds: 15,
          intervalSeconds: 15,
          now: () => clock,
          sleep: (ms: number) => {
            clock += ms;
          },
          headSha: () => {
            head = head === HEAD_A ? HEAD_B : HEAD_A;
            return head;
          },
          fetch: () => [coderabbit(REVIEWED)],
        })
      ).toThrow(/head changed|Refusing/u);
    });

    it("never evaluates rows when no concrete head can be resolved", () => {
      let reads = 0;
      const inspection = mod.inspectVacuity(
        [VACUITY, "--pr=1", NO_WAIT],
        declarationWith(),
        {
          headSha: () => undefined,
          fetch: () => {
            reads += 1;
            return [coderabbit(REVIEWED)];
          },
        }
      );

      expect(reads).toBe(0);
      expect(inspection?.refusal?.kind).toBe(
        mod.VACUITY_REFUSALS.unreadableChecks
      );
      expect(inspection?.violations).toEqual([]);
      expect(inspection?.headSha).toBeUndefined();
    });

    it("gives up at the deadline and SAYS it did not settle", () => {
      let clock = 0;
      const result = mod.fetchSettledChecks(declarationWith(), "1", undefined, {
        timeoutSeconds: 30,
        intervalSeconds: 15,
        now: () => clock,
        sleep: (ms: number) => {
          clock += ms;
        },
        fetch: () => [],
        headSha: () => HEAD_A,
      });
      // Never claimed settled. The caller reports what was true at that moment
      // rather than pretending the wait proved anything.
      expect(result.settled).toBe(false);
    });

    it("does not wait at all when the timeout is zero", () => {
      let reads = 0;
      const result = mod.fetchSettledChecks(declarationWith(), "1", undefined, {
        timeoutSeconds: 0,
        sleep: () => {
          throw new Error("a zero timeout must never sleep");
        },
        fetch: () => {
          reads += 1;
          return [];
        },
        headSha: () => HEAD_A,
      });
      expect(reads).toBe(1);
      expect(result.settled).toBe(false);
    });

    it("waits when strict review evidence selects a pull request directly", () => {
      let clock = 0;
      let reads = 0;
      const inspection = mod.inspectVacuity(
        [REQUIRE_REVIEW_EVIDENCE, "--pr=1"],
        declarationWith(),
        {
          now: () => clock,
          sleep: (ms: number) => {
            clock += ms;
          },
          fetch: () => {
            reads += 1;
            return reads === 1
              ? [
                  {
                    name: CODERABBIT,
                    state: "PENDING",
                    bucket: "pending",
                    description: REVIEW_IN_PROGRESS,
                  },
                ]
              : [coderabbit(REVIEWED)];
          },
          headSha: () => HEAD_A,
          // `--require-review-evidence` also enumerates what this pull request
          // CARRIES (#3658), which reads GitHub. This case is about the SETTLE
          // loop and installs no `gh`, so without a seam the carried arm
          // resolves whatever repository the working directory points at and
          // reports "I could not read the batch" — a finding that is correct
          // behaviour and has nothing to do with what is being asserted here.
          // MEASURED: it passed locally, where `gh` is authenticated, and
          // failed in CI, where it is not. An empty batch is what a settle test
          // means.
          fetchCarried: () => [],
        }
      );

      expect(reads).toBe(2);
      expect(inspection?.settled).toBe(true);
      expect(inspection?.violations).toEqual([]);
    });
  });

  describe("it REFUSES rather than reporting an empty inspection", () => {
    it("names an unresolvable pull request", () => {
      const refusal = mod.vacuityRefusal({ declaration: declarationWith() });
      expect(refusal?.kind).toBe(mod.VACUITY_REFUSALS.unresolvedPr);
      expect(refusal?.reason).toMatch(/examined NOTHING/u);
    });

    it("names an unreadable `gh`, and says NOBODY LOOKED", () => {
      // The distinction the ticket asks for: a red job for want of a token
      // permission means nobody looked, NOT that the review was hollow. One
      // message for both is how the first gets misreported as the second.
      const refusal = mod.vacuityRefusal({
        declaration: declarationWith(),
        pr: "1",
        error: new Error("gh exited 1"),
      });
      expect(refusal?.kind).toBe(mod.VACUITY_REFUSALS.unreadableChecks);
      expect(refusal?.reason).toContain("NOBODY LOOKED");
    });

    it("names a pull request that reported zero checks of any kind", () => {
      const refusal = mod.vacuityRefusal({
        declaration: declarationWith(),
        pr: "1",
        checks: [],
      });
      expect(refusal?.kind).toBe(mod.VACUITY_REFUSALS.emptyRoster);
    });

    it("names a declaration that claims no check carries evidence", () => {
      const refusal = mod.vacuityRefusal({
        declaration: declarationWith({ evidence_bearing_checks: {} }),
        pr: "1",
        checks: [coderabbit(REVIEWED)],
      });
      expect(refusal?.kind).toBe(mod.VACUITY_REFUSALS.noneDeclared);
    });

    it("returns null when it really did inspect something", () => {
      expect(
        mod.vacuityRefusal({
          declaration: declarationWith(),
          pr: "1",
          checks: [coderabbit(RATE_LIMITED)],
        })
      ).toBeNull();
    });

    it("keeps the four causes distinct, so a red job says which one it hit", () => {
      const kinds = Object.values(mod.VACUITY_REFUSALS);
      expect(new Set(kinds).size).toBe(kinds.length);
      expect(kinds.length).toBe(4);
    });
  });

  describe("inspectVacuity, the arm as one call", () => {
    it("stays silent only when the arm was not asked for", () => {
      expect(mod.inspectVacuity([], declarationWith())).toBeUndefined();
    });

    it("reports the measured hollow review", () => {
      const inspection = mod.inspectVacuity(
        [VACUITY, "--pr=3123", NO_WAIT],
        declarationWith(),
        {
          fetch: () => [coderabbit(RATE_LIMITED)],
          headSha: () => HEAD_A,
        }
      );
      expect(inspection?.refusal).toBeNull();
      // TWO findings from one reading, and they answer different questions.
      // `vacuous_required_check` is the REPORT — "this check did no work".
      // `review_evidence_waived` is the GATE — "the check said it could not
      // review, so the merge is permitted on that basis". The owner's ruling on
      // CodySwannGT/lisa#3221 is precisely that those two answers diverge on
      // this string, so one finding could not carry both.
      expect(inspection?.violations.map(v => v.kind)).toEqual([
        "vacuous_required_check",
        "review_evidence_waived",
      ]);
      expect(inspection?.gateStates?.[CODERABBIT]).toBe("waived");
      expect(inspection?.headSha).toBe(HEAD_A);
      expect(inspection?.violations[0]?.message).toContain(HEAD_A);
    });

    it("BLOCKS when a declared check never reported, and never waives it", () => {
      // Measured on CodySwannGT/lisa#3221: 40 of 40 MERGE COMMITS carry no
      // CodeRabbit status at all. A gate keyed on the wrong commit reads absent
      // every single time, so absent-means-waived would pass forever while
      // reporting nothing — inert, and green. THAT is what this pins, and it is
      // unchanged: the state is still `unsatisfied` and the finding is still
      // raised.
      //
      // Driven here rather than through the workflow step because `checksSettled`
      // treats a declared check that has not reported as UNSETTLED and re-reads
      // until the window expires. That is right in production and unreachable in
      // a test budget, so this arm passes `--settle-timeout=0`.
      //
      // WHICH IS ALSO WHY THE WORDING MOVED (#3716). A zero-second window is an
      // expired window, so this path now reports `undetermined` — the gate
      // stopped waiting — rather than asserting that nobody reviewed. The
      // distinction is the whole of #3716: a wait that ended is not an
      // observation. `absent` as a settled reading is still pinned directly, in
      // vacuous-required-checks.test.ts, where `reviewGateState` is called
      // without an expired wait.
      const inspection = mod.inspectVacuity(
        [VACUITY, "--pr=4003", NO_WAIT],
        declarationWith(),
        {
          fetch: () => [
            { name: "Some Other Check", state: "SUCCESS", description: "" },
          ],
          headSha: () => HEAD_A,
        }
      );

      expect(inspection?.gateStates?.[CODERABBIT]).toBe("unsatisfied");
      const gate = inspection?.violations.find(
        v => v.kind === "review_evidence_unsatisfied"
      );
      expect(gate?.message).toContain("EXPIRED");
      // The load-bearing half of the original assertion: whatever it is called,
      // it is NOT a waiver and it does not read as one.
      expect(inspection?.gateStates?.[CODERABBIT]).not.toBe("waived");
      expect(gate?.message).not.toContain("could not review");
      expect(gate?.message).toContain(HEAD_A);
    });

    it("NEGATIVE CONTROL — a genuinely reviewed check is not reported", () => {
      // Without this, a rule that flagged every check would satisfy every
      // other assertion in this file, and the guard would be pure noise.
      const inspection = mod.inspectVacuity(
        [VACUITY, "--pr=3091", NO_WAIT],
        declarationWith(),
        { fetch: () => [coderabbit(REVIEWED)], headSha: () => HEAD_A }
      );
      expect(inspection?.refusal).toBeNull();
      expect(inspection?.violations).toEqual([]);
      expect(inspection?.checked).toBe(1);
    });

    it("turns a fetch failure into a refusal, not a clean report", () => {
      const inspection = mod.inspectVacuity(
        [VACUITY, "--pr=1", NO_WAIT],
        declarationWith(),
        {
          fetch: () => {
            throw new Error("gh: unreadable");
          },
          headSha: () => HEAD_A,
        }
      );
      expect(inspection?.refusal?.kind).toBe(
        mod.VACUITY_REFUSALS.unreadableChecks
      );
      expect(inspection?.violations).toEqual([]);
    });

    it("keeps the verified head SHA when an empty roster is refused", () => {
      const inspection = mod.inspectVacuity(
        [VACUITY, "--pr=1", NO_WAIT],
        declarationWith(),
        { fetch: () => [], headSha: () => HEAD_A }
      );

      expect(inspection?.refusal?.kind).toBe(mod.VACUITY_REFUSALS.emptyRoster);
      expect(inspection?.headSha).toBe(HEAD_A);
    });
  });

  describe("the shipped CLI, end to end", () => {
    it("reads a declared status from a later API page", () => {
      const bin = stubGh([coderabbit(RATE_LIMITED)], true);
      const { output } = runCli(
        repoDeclaring(declarationWith()),
        [VACUITY, "--pr=3123", STUB_REPO],
        bin
      );
      expect(output).toContain("vacuous_required_check");
      expect(output).toContain(RATE_LIMITED);
      expect(output).toContain(HEAD_A);
    });

    it("BITES a rate-limited required check", () => {
      const bin = stubGh([coderabbit(RATE_LIMITED)]);
      const { output } = runCli(
        repoDeclaring(declarationWith()),
        [VACUITY, "--pr=3123", STUB_REPO],
        bin
      );
      expect(output).toContain("vacuous_required_check");
      expect(output).toContain(RATE_LIMITED);
      expect(output).toContain("Treat this PR as UNREVIEWED");
    });

    it("NEGATIVE CONTROL — reports a real review as proof, and exits 0", () => {
      const bin = stubGh([coderabbit(REVIEWED)]);
      const { status, output } = runCli(
        repoDeclaring(declarationWith()),
        [VACUITY, "--pr=3091", STUB_REPO],
        bin
      );
      expect(status).toBe(0);
      expect(output).not.toContain("vacuous_required_check");
      expect(output).toContain("evidence-bearing check(s) examined");
    });

    it("EXITS NON-ZERO when it inspected nothing, and never prints a ✅ about it", () => {
      const bin = stubGh(null);
      const { status, output } = runCli(
        repoDeclaring(declarationWith()),
        [VACUITY, "--pr=1", STUB_REPO],
        bin
      );
      expect(status).toBe(1);
      expect(output).toContain(NOT_INSPECTED);
      expect(output).toContain(mod.VACUITY_REFUSALS.unreadableChecks);
      expect(output).not.toContain(
        "none silences a ruleset-required status check"
      );
      expect(output).not.toContain("evidence-bearing check(s) examined");
    });

    it("keeps a refusal loud but exits 0 under `enforcement: warn`", () => {
      // The same adoption ramp the untranscribed-snapshot refusal already uses:
      // reddening a whole fleet the day a seed arrives is how a gate gets
      // deleted rather than configured.
      const bin = stubGh(null);
      const { status, output } = runCli(
        repoDeclaring(declarationWith({ enforcement: "warn" })),
        [VACUITY, "--pr=1", STUB_REPO],
        bin
      );
      expect(status).toBe(0);
      expect(output).toContain(NOT_INSPECTED);
    });

    it("keeps independent skip diagnostics when evidence inspection refuses", () => {
      const bin = stubGh(null);
      const root = repoDeclaring(declarationWith({ enforcement: "warn" }));
      fs.writeFileSync(
        path.join(root, CI_WORKFLOW.replace(/\//gu, path.sep)),
        "      skip_jobs: 'undeclared'"
      );

      const { status, output } = runCli(
        root,
        [VACUITY, "--pr=1", STUB_REPO],
        bin
      );

      expect(status).toBe(0);
      expect(output).toContain(NOT_INSPECTED);
      expect(output).toContain("undeclared_skip_token");
      expect(output).toContain("1 violation(s) across 1 `skip_jobs` token(s)");
    });

    it("blocks an inspection refusal when review evidence is required", () => {
      const bin = stubGh(null);
      const { status, output } = runCli(
        repoDeclaring(declarationWith({ enforcement: "warn" })),
        [VACUITY, "--pr=1", STUB_REPO, REQUIRE_REVIEW_EVIDENCE],
        bin
      );

      expect(status).toBe(1);
      expect(output).toContain(NOT_INSPECTED);
      expect(output).toContain(
        `::error title=${mod.VACUITY_REFUSALS.unreadableChecks}`
      );
      expect(output).not.toContain(
        `::warning title=${mod.VACUITY_REFUSALS.unreadableChecks}`
      );
      expect(output).not.toContain(
        "none silences a ruleset-required status check"
      );
    });

    it("stays report-only by default, and blocks only when asked", () => {
      const bin = stubGh([coderabbit(RATE_LIMITED)]);
      const root = repoDeclaring(declarationWith());
      const args = [VACUITY, "--pr=3123", STUB_REPO];
      expect(runCli(root, args, bin).status).toBe(0);
      const asked = runCli(root, [...args, FAIL_ON_VACUOUS], bin);
      expect(asked.status).toBe(1);
      expect(asked.output).toContain("vacuous_required_check");
    });

    it("keeps a named review waiver nonblocking under both gate flags", () => {
      const entitlement = "Vendor allowance exhausted";
      const bin = stubGh([coderabbit(entitlement)]);
      const root = repoDeclaring(
        declarationWith({
          evidence_bearing_checks: {
            [CODERABBIT]: {
              // The vacuity arm has evidence of work; only the review gate's
              // deliberately named waiver remains in the result.
              proof: [entitlement],
              waive: [entitlement],
            },
          },
        })
      );
      const run = runCli(
        root,
        [
          VACUITY,
          "--pr=3123",
          STUB_REPO,
          FAIL_ON_VACUOUS,
          REQUIRE_REVIEW_EVIDENCE,
        ],
        bin
      );

      expect(run.status).toBe(0);
      expect(run.output).toContain("review_evidence_waived");
      expect(run.output).not.toContain("vacuous_required_check");
      expect(run.output).toContain("REPORT-ONLY under every enforcement mode");
    });

    it("keeps waiver-only JSON successful under both gate flags", () => {
      const entitlement = "Vendor allowance exhausted";
      const bin = stubGh([coderabbit(entitlement)]);
      const root = repoDeclaring(
        declarationWith({
          evidence_bearing_checks: {
            [CODERABBIT]: {
              proof: [entitlement],
              waive: [entitlement],
            },
          },
        })
      );
      const run = runCli(
        root,
        [
          VACUITY,
          "--pr=3123",
          STUB_REPO,
          FAIL_ON_VACUOUS,
          REQUIRE_REVIEW_EVIDENCE,
          "--json",
        ],
        bin
      );
      const parsed = JSON.parse(run.output) as {
        ok: boolean;
        violations: readonly Violation[];
      };

      expect(run.status).toBe(0);
      expect(parsed.ok).toBe(true);
      expect(parsed.violations.map(v => v.kind)).toEqual([
        "review_evidence_waived",
      ]);
    });

    it("enforces unsatisfied review evidence in JSON mode", () => {
      const bin = stubGh([coderabbit("Review deferred")]);
      const run = runCli(
        repoDeclaring(declarationWith()),
        [VACUITY, "--pr=4002", STUB_REPO, REQUIRE_REVIEW_EVIDENCE, "--json"],
        bin
      );
      const parsed = JSON.parse(run.output) as {
        ok: boolean;
        violations: readonly Violation[];
      };

      expect(run.status).toBe(1);
      expect(parsed.ok).toBe(false);
      expect(parsed.violations.map(v => v.kind)).toContain(
        "review_evidence_unsatisfied"
      );
    });

    it("refuses a review-evidence policy without a pull request selector", () => {
      const run = runCli(
        repoDeclaring(declarationWith()),
        [STUB_REPO, REQUIRE_REVIEW_EVIDENCE, "--json"],
        stubGh([])
      );
      const parsed = JSON.parse(run.output) as {
        ok: boolean;
        error: string;
      };

      expect(run.status).toBe(1);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain(
        "`--require-review-evidence` needs `--vacuity` or `--pr=<number>`"
      );
    });

    it("reports the refusal through `--json` as not ok and not inspected", () => {
      const bin = stubGh(null);
      const { output } = runCli(
        repoDeclaring(declarationWith()),
        [VACUITY, "--pr=1", STUB_REPO, "--json"],
        bin
      );
      const parsed = JSON.parse(output) as {
        ok: boolean;
        inspected: boolean;
      };
      expect(parsed.ok).toBe(false);
      expect(parsed.inspected).toBe(false);
    });

    it("reports an offline JSON result as not inspected", () => {
      const run = runCli(
        repoDeclaring(declarationWith()),
        [STUB_REPO, "--json"],
        stubGh([])
      );
      const parsed = JSON.parse(run.output) as {
        ok: boolean;
        inspected: boolean;
      };

      expect(run.status).toBe(0);
      expect(parsed.ok).toBe(true);
      expect(parsed.inspected).toBe(false);
    });

    it("reports a completed JSON evidence inspection as inspected", () => {
      const run = runCli(
        repoDeclaring(declarationWith()),
        [VACUITY, "--pr=4003", STUB_REPO, "--json"],
        stubGh([coderabbit(REVIEWED)])
      );
      const parsed = JSON.parse(run.output) as {
        ok: boolean;
        inspected: boolean;
      };

      expect(run.status).toBe(0);
      expect(parsed.ok).toBe(true);
      expect(parsed.inspected).toBe(true);
    });
  });
});
