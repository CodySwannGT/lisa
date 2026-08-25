/**
 * Tests for what makes the VACUITY arm a gate rather than a flag nobody passes.
 *
 * Sibling of `vacuous-required-checks.test.ts`, which covers the detection.
 * The detection was never the problem: pointed at a real rate-limited pull
 * request it produces exactly the right finding, and has since #2497.
 *
 * MEASURED (CodySwannGT/lisa#2928): **nothing invoked it.** `quality.yml` ran
 * the guard's OFFLINE arm with no `--pr`, the shipped `required-checks-drift.yml`
 * ran `--remote`, and the package script named `check:vacuous-required-checks`
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

/** Two successive pull-request heads used to prove roster provenance. */
const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

/** The flag that wires the arm, rather than leaving it for a caller to recall. */
const VACUITY = "--vacuity";

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

    it.each([
      ["typescript/create-only/.github/workflows/review-evidence.yml", "seed"],
      [".github/workflows/review-evidence.yml", "Lisa's own"],
    ])("%s runs the arm on every pull request", relative => {
      const workflow = loadWorkflow(path.join(REPO_ROOT, relative));
      // `on: pull_request` is the whole point: a schedule would reproduce
      // `required-checks-drift.yml`, which is what the arm was NOT.
      expect(workflow.on?.pull_request).toBeDefined();
      const steps = workflow.jobs?.vacuity?.steps ?? [];
      const step = steps.find(candidate =>
        candidate.run?.includes("--vacuity")
      );
      expect(
        step,
        `${relative} must run the guard with --vacuity`
      ).toBeTruthy();
    });

    it.each([
      ["typescript/create-only/.github/workflows/review-evidence.yml", "seed"],
      [".github/workflows/review-evidence.yml", "Lisa's own"],
    ])("%s grants the scopes reading checks needs", relative => {
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
      expect(workflow.permissions?.checks).toBe("read");
      expect(workflow.permissions?.statuses).toBe("read");
    });
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
    it("uses the check run when a status reports the same context name", () => {
      const pendingRun: CheckRow = {
        name: CODERABBIT,
        state: "PENDING",
        bucket: "pending",
        description: "Review in progress",
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
            description: "Review in progress",
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

    it("BLOCKS on ABSENT, which is not the same as waived", () => {
      // Measured on CodySwannGT/lisa#3221: 40 of 40 MERGE COMMITS carry no
      // CodeRabbit status at all. A gate keyed on the wrong commit reads absent
      // every single time, so absent-means-waived would pass forever while
      // reporting nothing — inert, and green.
      //
      // Driven here rather than through the workflow step because `checksSettled`
      // treats a declared check that has not reported as UNSETTLED and re-reads
      // until the window expires. That is right in production and unreachable in
      // a test budget, so this arm passes `--settle-timeout=0`.
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
      expect(gate?.message).toContain("ABSENT is not the same as waived");
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
      expect(output).toContain("NOT INSPECTED");
      expect(output).toContain(mod.VACUITY_REFUSALS.unreadableChecks);
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
      expect(output).toContain("NOT INSPECTED");
    });

    it("stays report-only by default, and blocks only when asked", () => {
      const bin = stubGh([coderabbit(RATE_LIMITED)]);
      const root = repoDeclaring(declarationWith());
      const args = [VACUITY, "--pr=3123", STUB_REPO];
      expect(runCli(root, args, bin).status).toBe(0);
      const asked = runCli(root, [...args, "--fail-on-vacuous"], bin);
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
          "--fail-on-vacuous",
          "--require-review-evidence",
        ],
        bin
      );

      expect(run.status).toBe(0);
      expect(run.output).toContain("review_evidence_waived");
      expect(run.output).not.toContain("vacuous_required_check");
      expect(run.output).toContain("REPORT-ONLY under every enforcement mode");
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
  });
});
