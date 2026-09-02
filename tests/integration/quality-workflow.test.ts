/* eslint-disable max-lines -- workflow contract coverage intentionally exercises several reusable templates in one parse pass */
import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { RETIRED_SKIP_JOB_TOKENS } from "../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { RETAINED_RELEASES } from "../../scripts/generate-nightly-e2e-guard-certificate.mjs";

// Derive the repo root from this test file's location so the test is
// portable across worktrees and CI working directories.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GITHUB_WORKFLOWS_PARTS = [".github", "workflows"] as const;
const CREATE_ONLY_DIR = "create-only";
const WORKFLOWS_DIR = path.join(REPO_ROOT, ...GITHUB_WORKFLOWS_PARTS);
const DEPLOY_WORKFLOW_FILE = "deploy.yml";
const QUALITY_WORKFLOW_FILE = "quality.yml";
const QUALITY_RAILS_WORKFLOW_FILE = "quality-rails.yml";
const QUALITY_YML = path.join(WORKFLOWS_DIR, QUALITY_WORKFLOW_FILE);
const QUALITY_RAILS_YML = path.join(WORKFLOWS_DIR, QUALITY_RAILS_WORKFLOW_FILE);
const RELEASE_YML = path.join(WORKFLOWS_DIR, "release.yml");
const DEPLOY_YML = path.join(WORKFLOWS_DIR, DEPLOY_WORKFLOW_FILE);
const NESTJS_DEPLOY_YML = path.join(
  REPO_ROOT,
  "nestjs",
  CREATE_ONLY_DIR,
  ...GITHUB_WORKFLOWS_PARTS,
  DEPLOY_WORKFLOW_FILE
);
const NESTJS_CI_YML = path.join(
  REPO_ROOT,
  "nestjs",
  CREATE_ONLY_DIR,
  ...GITHUB_WORKFLOWS_PARTS,
  "ci.yml"
);
const EXPO_DEPLOY_YML = path.join(
  REPO_ROOT,
  "expo",
  CREATE_ONLY_DIR,
  ...GITHUB_WORKFLOWS_PARTS,
  DEPLOY_WORKFLOW_FILE
);
const EXPO_CI_YML = path.join(
  REPO_ROOT,
  "expo",
  CREATE_ONLY_DIR,
  ...GITHUB_WORKFLOWS_PARTS,
  "ci.yml"
);
const EAS_BUILD_YML = path.join(WORKFLOWS_DIR, "build.yml");
const CREATE_ISSUE_ON_FAILURE_YML = path.join(
  WORKFLOWS_DIR,
  "create-issue-on-failure.yml"
);
const CREATE_GITHUB_ISSUE_ON_FAILURE_YML = path.join(
  WORKFLOWS_DIR,
  "create-github-issue-on-failure.yml"
);

/** Shape of a single `workflow_call` input declaration. */
interface WorkflowInput {
  description?: string;
  required?: boolean;
  default?: unknown;
  type?: string;
}

/** Shape of a single step inside a workflow job's `steps:` list. */
interface WorkflowStep {
  id?: string;
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  "working-directory"?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}

/** Shape of a single job inside a workflow's `jobs:` map. */
interface WorkflowJob {
  name?: string;
  "runs-on"?: string;
  "timeout-minutes"?: number;
  needs?: string | string[];
  if?: string;
  environment?: unknown;
  outputs?: Record<string, string>;
  permissions?: Record<string, unknown>;
  strategy?: { matrix?: Record<string, unknown>; "fail-fast"?: boolean };
  steps?: WorkflowStep[];
  with?: Record<string, unknown>;
}

/** Root shape of the parsed `quality.yml` reusable workflow. */
interface QualityWorkflow {
  on: {
    workflow_call?: {
      inputs?: Record<string, WorkflowInput>;
    };
  };
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  permissions?: Record<string, unknown>;
  jobs: Record<string, WorkflowJob>;
}

/** Root shape of the parsed `release.yml` reusable workflow. */
interface ReleaseWorkflow {
  jobs: Record<string, WorkflowJob>;
}

/** Root shape of the parsed `deploy.yml` workflow. */
interface DeployWorkflow {
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  jobs?: Record<string, WorkflowJob>;
}

/** Root shape for lightweight reusable workflow contract checks. */
interface ReusableWorkflow {
  on?: {
    workflow_call?: {
      secrets?: Record<string, { required?: boolean }>;
    };
  };
  jobs?: Record<string, WorkflowJob>;
}

/**
 * Normalize GitHub Actions' scalar-or-list `needs` value for assertions.
 *
 * @param job Parsed workflow job.
 * @returns Job dependency names.
 */
function needsList(job: WorkflowJob | undefined): string[] {
  if (!job?.needs) {
    return [];
  }

  return Array.isArray(job.needs) ? job.needs : [job.needs];
}

describe("quality.yml reusable workflow", () => {
  let workflow: QualityWorkflow;
  let railsWorkflow: QualityWorkflow;
  let qualityRaw: string;
  let qualityRailsRaw: string;

  beforeAll(() => {
    qualityRaw = fs.readFileSync(QUALITY_YML, "utf8");
    qualityRailsRaw = fs.readFileSync(QUALITY_RAILS_YML, "utf8");
    workflow = yaml.load(qualityRaw) as QualityWorkflow;
    railsWorkflow = yaml.load(qualityRailsRaw) as QualityWorkflow;
  });

  describe("dependency installation ownership", () => {
    it("does not create a dependency job or artifact that no proving job consumes", () => {
      expect(workflow.jobs.install_dependencies).toBeUndefined();
      expect(qualityRaw).not.toContain("node-modules-${{ github.run_id }}");
      expect(qualityRaw).not.toContain("needs.install_dependencies");
      expect(
        Object.values(workflow.jobs).flatMap(job => needsList(job))
      ).not.toContain("install_dependencies");
    });
  });

  describe("skip_jobs token matching", () => {
    // Test hardened to kill mutant M001 (Risk Factor: CI gate correctness / exact skip token matching).
    it("matches every skipped job as an exact comma-delimited token", () => {
      expect(qualityRaw).not.toContain("contains(inputs.skip_jobs");
      expect(qualityRailsRaw).not.toContain("contains(inputs.skip_jobs");
      for (const [workflowName, parsedWorkflow] of [
        [QUALITY_WORKFLOW_FILE, workflow],
        [QUALITY_RAILS_WORKFLOW_FILE, railsWorkflow],
      ] as const) {
        for (const [jobName, job] of Object.entries(parsedWorkflow.jobs)) {
          if (!job.if?.includes("skip_jobs")) {
            continue;
          }
          expect(
            job.if,
            `${workflowName} ${jobName} should use token matching`
          ).toContain("contains(format(',{0},', inputs.skip_jobs), ',");
        }
      }
    });

    // Test hardened to kill mutant M002 (Risk Factor: CI gate correctness / substring skip collision).
    // `lint` is a strict prefix of `lint_slow`, so this pair exercises the same
    // collision the deleted `test` / `test:e2e` pair used to (#2485).
    it("does not let lint_slow skip the plain lint job", () => {
      const lint = workflow.jobs.lint?.if ?? "";
      const lintSlow = workflow.jobs.lint_slow?.if ?? "";

      expect(lint).toContain(
        "!contains(format(',{0},', inputs.skip_jobs), ',lint,')"
      );
      expect(lint).not.toContain("inputs.skip_jobs), ',lint_slow,')");
      expect(lintSlow).toContain(
        "!contains(format(',{0},', inputs.skip_jobs), ',lint_slow,')"
      );
      expect(lintSlow).not.toContain("inputs.skip_jobs), ',lint,')");
    });

    // #2485: the bare `test` job (`🧪 Run Tests`, plain `npm test`) is gone. It
    // duplicated the required `🧪 Run Unit Tests` / `🧪 Run Integration Tests`
    // contexts and, because it was not required, its alarming-looking red
    // merged unnoticed on #2456 and #2461. Reintroducing a third near-identical
    // test context recreates that confusable pair, so this pins its absence.
    // CodySwannGT/lisa#2841: the browser suite moved to `playwright-e2e.yml`,
    // whose `playwright_e2e_aggregate` resolves the `e2e-browser` gate. The
    // `quality.yml` job that ran the same `test:e2e` script did not move with it
    // and resolved no gate at all, so a project could declare `e2e-browser` off
    // and still have its browser suite run — and a project with no `test:e2e`
    // script got a full dependency install and a green check for a suite that
    // never ran. Pinned as an absence because the failure was invisible: the job
    // reported success either way.
    it("ships no job that runs the project's test:e2e script", () => {
      expect(workflow.jobs.test_e2e).toBeUndefined();
      expect(Object.values(workflow.jobs).map(job => job.name)).not.toContain(
        "🧪 Run E2E Tests"
      );
      // The RUN, not the word: `test:e2e` still appears in the `skip_jobs` input
      // description (the token is still accepted) and in two comments.
      expect(qualityRaw).not.toMatch(/run test:e2e/u);
    });

    it("keeps accepting the test:e2e token it no longer honours", () => {
      // Every project built from the Expo and NestJS templates passes it. A token
      // a caller sends that the callee does not advertise is how an operator
      // learns, from a violation, that their configuration stopped meaning
      // anything — so it stays advertised, and inert (CodySwannGT/lisa#2841).
      expect(
        workflow.on.workflow_call?.inputs?.skip_jobs?.description
      ).toContain("test:e2e");
    });

    it("ships no bare `test` job and no `🧪 Run Tests` context", () => {
      expect(workflow.jobs.test).toBeUndefined();
      expect(Object.values(workflow.jobs).map(job => job.name)).not.toContain(
        "🧪 Run Tests"
      );
      expect(
        workflow.on.workflow_call?.inputs?.skip_jobs?.description
      ).not.toMatch(/[(,]test,/u);
    });

    // #2485 postmortem. Deleting the `test` job left three `needs: [.., test, ..]`
    // edges and FIVE `needs.test.result` interpolations behind. GitHub rejects
    // the whole workflow at parse time for a dangling `needs`, so the run
    // reported `conclusion=failure, jobs=0` — a startup_failure. None of the 8
    // required contexts could report, because nothing started. In a reusable
    // workflow every host project calls, that takes fleet CI down.
    //
    // It passed lint, typecheck, the full unit suite, and a `grep -n "needs:"`
    // — the grep showed the multi-line `needs:` keys with their list items on
    // FOLLOWING lines, so the dependency names were never in the output being
    // read. A parser sees what a line-oriented grep structurally cannot.
    describe("job graph integrity (#2485)", () => {
      for (const [file, getWorkflow, getRaw] of [
        [QUALITY_WORKFLOW_FILE, () => workflow, () => qualityRaw],
        [
          QUALITY_RAILS_WORKFLOW_FILE,
          () => railsWorkflow,
          () => qualityRailsRaw,
        ],
      ] as const) {
        it(`${file} has no needs: edge pointing at a missing job`, () => {
          const jobs = getWorkflow().jobs;
          const declared = new Set(Object.keys(jobs));
          const dangling = Object.entries(jobs).flatMap(([job, definition]) =>
            needsList(definition)
              .filter(dependency => !declared.has(dependency))
              .map(dependency => `${job} -> ${dependency}`)
          );

          expect(dangling).toEqual([]);
        });

        // The stronger arm: an interpolation does not stop the workflow
        // parsing, so it fails silently as an empty string rather than loudly.
        it(`${file} has no needs.<job> interpolation for a missing job`, () => {
          const declared = new Set(Object.keys(getWorkflow().jobs));
          const referenced = [
            ...getRaw().matchAll(/needs\.(?<job>[A-Za-z0-9_-]+)/gu),
          ].map(match => match.groups?.job ?? "");
          const unknown = [...new Set(referenced)].filter(
            job => !declared.has(job)
          );

          expect(unknown).toEqual([]);
        });
      }
    });

    // #2427: the sentinel-comma idiom matches EXACT bytes, and GitHub Actions
    // expression syntax has no string-replace function to trim with — the
    // available string functions are contains/startsWith/endsWith/format/join/
    // toJSON/fromJSON/hashFiles. So a spaced list cannot be normalized in the
    // workflow, and the constraint is documented at the input instead. These
    // cases pin which way the resulting mistake falls: CLOSED, meaning the job
    // runs and nothing unverified ships. If a future change makes a spaced
    // token skip MORE than an unspaced one, that is a hole and this fails.
    describe("whitespace in the skip list (#2427)", () => {
      const SENTINEL =
        /!contains\(format\(',\{0\},', inputs\.skip_jobs\), '(?<needle>[^']*)'\)/u;

      /**
       * Evaluates a job's shipped `if:` the way GitHub Actions would.
       *
       * Derived from the workflow's own expression rather than re-implemented,
       * so the test cannot drift away from what actually ships.
       *
       * @param job Parsed workflow job.
       * @param skipJobs The `skip_jobs` input value a caller passed.
       * @returns True when the job would RUN.
       */
      function jobRuns(
        job: WorkflowJob | undefined,
        skipJobs: string
      ): boolean {
        const needle = SENTINEL.exec(job?.if ?? "")?.groups?.needle;
        if (needle === undefined) {
          throw new Error(`no sentinel-comma guard in: ${String(job?.if)}`);
        }
        return !`,${skipJobs},`.includes(needle);
      }

      it("'lint,lint_slow' — written correctly, skips both", () => {
        expect(jobRuns(workflow.jobs.lint, "lint,lint_slow")).toBe(false);
        expect(jobRuns(workflow.jobs.lint_slow, "lint,lint_slow")).toBe(false);
      });

      it("'lint, lint_slow' — the space makes lint_slow RUN anyway (fails closed)", () => {
        expect(jobRuns(workflow.jobs.lint, "lint, lint_slow")).toBe(false);
        expect(jobRuns(workflow.jobs.lint_slow, "lint, lint_slow")).toBe(true);
      });

      it("' lint ' — padded on both sides, skips nothing at all", () => {
        expect(jobRuns(workflow.jobs.lint, " lint ")).toBe(true);
        expect(jobRuns(workflow.jobs.lint_slow, " lint ")).toBe(true);
      });

      it("documents the constraint at the input, in both workflows", () => {
        // The fix that cannot be written in expression syntax has to be
        // written where the operator types the value.
        for (const parsed of [workflow, railsWorkflow]) {
          expect(
            parsed.on.workflow_call?.inputs?.skip_jobs?.description
          ).toMatch(/NO SPACES/u);
        }
      });
    });
  });

  // #2426: Lisa shipped the guard, the npm scripts and a seeded declaration,
  // but no workflow ran it — so adopters had to wire it by hand and none did.
  describe("the skipped-required-check guard is actually invoked", () => {
    it("runs the OFFLINE arm as a job on every pull request", () => {
      const job = workflow.jobs.skipped_required_checks;
      expect(job).toBeDefined();
      // NO `if:` AT ALL, as of #2933. The job carried a
      // `skipped_required_checks` skip token, so the guard against silencing a
      // required check had an off-switch of exactly the kind it exists to
      // refuse. The owner's ruling was to remove it rather than relocate it
      // into the gate registry. `quality-non-declarable-jobs.test.ts` holds the
      // general rule; this case pins the job's own condition.
      expect(job?.if).toBeUndefined();
      const run = job?.steps?.map(step => step.run ?? "").join("\n") ?? "";
      expect(run).toContain("check-skipped-required-checks.mjs");
      expect(run).toContain('if [ -z "${SKIP_JOBS:-}" ]');
      const guardStep = job?.steps?.find(step =>
        step.run?.includes("check-skipped-required-checks.mjs")
      );
      expect(guardStep?.env?.SKIP_JOBS).toBe("${{ inputs.skip_jobs }}");
      // The enforced pull-request path may not depend on network or `gh` auth:
      // a flaky gate gets skipped, and a skipped gate is the false-green class
      // this guard exists to refuse. The remote arm runs on a schedule instead.
      expect(run).not.toContain("--remote");
    });

    it("FAILS rather than skipping when the script or the snapshot is absent", () => {
      // Was "passes rather than reddens". It did: both branches `exit 0`, and
      // on this repository — which has neither file under `scripts/` — the job
      // reported success having compared nothing, for its entire life (#2933).
      // Behaviour for a non-empty skip list is proved by executing the step, in
      // tests/integration/skipped-required-checks-gate-fail-closed.test.ts;
      // this case is the cheap guard against a literal revert.
      const run =
        workflow.jobs.skipped_required_checks?.steps
          ?.map(step => step.run ?? "")
          .join("\n") ?? "";
      expect(run).toContain("[ ! -f .github/required-checks.json ]");
      expect(run).not.toContain("project not yet on this template");
      expect(run).toContain("Skipped-required-check prover missing");
      expect(run).toContain("Required-checks declaration missing");
    });

    it("runs the REMOTE arm on a schedule, because offline snapshots rot", () => {
      const drift = yaml.load(
        fs.readFileSync(
          path.join(
            REPO_ROOT,
            "typescript",
            CREATE_ONLY_DIR,
            ...GITHUB_WORKFLOWS_PARTS,
            "required-checks-drift.yml"
          ),
          "utf8"
        )
      ) as { on?: Record<string, unknown>; jobs?: Record<string, WorkflowJob> };
      expect(drift.on).toHaveProperty("schedule");
      // Never on pull_request: a network-dependent check must not be able to
      // wedge a merge.
      expect(drift.on).not.toHaveProperty("pull_request");
      const run =
        drift.jobs?.drift?.steps?.map(step => step.run ?? "").join("\n") ?? "";
      expect(run).toContain(
        "node scripts/check-skipped-required-checks.mjs --remote"
      );
    });
  });

  describe("template skip_jobs defaults", () => {
    // Test hardened to kill mutant M003 (Risk Factor: Release confidence / promotion branch test coverage).
    it("keeps promotion-branch test jobs enabled in JS templates", () => {
      for (const file of [NESTJS_CI_YML, EXPO_CI_YML]) {
        const ci = yaml.load(fs.readFileSync(file, "utf8")) as QualityWorkflow;
        expect(ci.jobs.quality?.with?.skip_jobs).toBe(
          "test:e2e,playwright_e2e"
        );
      }
    });

    it("passes no token the workflow has retired", () => {
      // A caller carrying a retired token is not merely untidy: the token
      // silences nothing, so it reads as an off-switch that still works.
      // CodySwannGT/lisa#2938 retired `zap_baseline` when the pull-request ZAP
      // job was deleted, and these two templates were the only shipped callers
      // passing it.
      for (const file of [NESTJS_CI_YML, EXPO_CI_YML]) {
        const ci = yaml.load(fs.readFileSync(file, "utf8")) as QualityWorkflow;
        const tokens = (ci.jobs.quality?.with?.skip_jobs ?? "").split(",");
        const retired = tokens.filter(token =>
          Object.hasOwn(RETIRED_SKIP_JOB_TOKENS, token)
        );
        expect(retired).toEqual([]);
      }
    });
  });

  describe("SE-4551 + SE-4552 new inputs", () => {
    // The two Playwright inputs are INERT here — the suite they configured
    // moved to `playwright-e2e.yml`, which declares its own copies. What they
    // still have to be is DECLARED. A caller that passes an input a reusable
    // workflow does not declare is a `startup_failure` for its ENTIRE run,
    // decided before any `if:` is evaluated, and installed callers pass both
    // today. So deleting them would break every one of them at once, on a
    // change that is otherwise invisible to them.
    //
    // Their live behaviour is asserted against the workflow that now owns it,
    // in `playwright-e2e-workflow.test.ts`. Asserting a default here would
    // describe a value nothing reads.
    it.each(["playwright_setup_command", "playwright_shards"])(
      "keeps %s declared and optional, so installed callers still start",
      name => {
        const input = workflow.on.workflow_call?.inputs?.[name];
        expect(input).toBeDefined();
        expect(input?.required).toBe(false);
        // Says so in the description, because the only way a caller finds out
        // an input stopped doing anything is by being told.
        expect(input?.description).toContain("INERT");
      }
    );

    it("declares cache_build with default false (unchanged behavior)", () => {
      const input = workflow.on.workflow_call?.inputs?.cache_build;
      expect(input).toBeDefined();
      expect(input?.required).toBe(false);
      expect(input?.default).toBe(false);
      expect(input?.type).toBe("boolean");
    });

    // The `playwright_e2e` half of this pair moved with the job, to
    // `playwright-e2e-workflow.test.ts`. Both halves still exist; splitting
    // them was the alternative to asserting against a job that is not here,
    // where every lookup returns undefined and every assertion passes.
    it("includes the source root in the build cache key", () => {
      const buildCache = workflow.jobs.build.steps?.find(
        step => step.id === "build_cache"
      );

      // The key derives from the git-based fingerprint step rather than
      // inlining a hashFiles glob — see the node_modules regression test below.
      expect(buildCache?.with?.key).toContain(
        "steps.build_fingerprint.outputs.hash"
      );

      const fingerprint = workflow.jobs.build.steps?.find(
        step => step.id === "build_fingerprint"
      );
      expect(
        fingerprint,
        "build must compute a build fingerprint"
      ).toBeDefined();
      // The source roots and the lockfiles still drive invalidation.
      expect(fingerprint?.run).toContain("git ls-files");
      for (const path of ["'src'", "'bun.lock'", "'package.json'"]) {
        expect(fingerprint?.run).toContain(path);
      }
    });

    // Regression guard for CodySwannGT/lisa#2418.
    //
    // `hashFiles('**/src/**')` is unanchored, so it also matches
    // `node_modules/**/src/**`. On AcmeOrgA/frontend that walked 116,353
    // paths and hashed 26,955 node_modules files, blowing past the runner's
    // 120-second hashFiles ceiling and failing the job in the cache's POST
    // step — after every test had already passed. A green Playwright nightly
    // (73/73) was reported as red, blocking merges repo-wide.
    it("never derives a build cache key from an unanchored source glob", () => {
      const fingerprintSteps = (workflow.jobs.build.steps ?? []).filter(
        step => step.id === "build_fingerprint" || step.id === "build_cache"
      );

      // Two here, two in `playwright-e2e-workflow.test.ts`. Counted on both
      // sides so a step that disappears cannot leave an empty loop passing.
      expect(fingerprintSteps.length).toBe(2);

      for (const step of fingerprintSteps) {
        const text = `${step.run ?? ""}${step.with?.key ?? ""}`;
        for (const glob of [
          "**/src/**",
          "**/app/**",
          "**/components/**",
          "**/features/**",
        ]) {
          expect(
            text,
            `${step.id} must not hash ${glob} — it traverses node_modules`
          ).not.toContain(glob);
        }
      }
    });
  });

  describe("cross-run concurrency mutex (opt-in)", () => {
    it("declares concurrency_group input defaulting to '' (no serialization)", () => {
      const input = workflow.on.workflow_call?.inputs?.concurrency_group;
      expect(input).toBeDefined();
      expect(input?.required).toBe(false);
      expect(input?.default).toBe("");
      expect(input?.type).toBe("string");
    });

    it("sets a top-level concurrency that queues rather than cancels", () => {
      // cancel-in-progress must be false so opted-in runs queue (serialize)
      // instead of cancelling each other — cancelling mid-run is what leaves
      // shared external state (e.g. a test user's server-side org) dirty.
      expect(workflow.concurrency).toBeDefined();
      expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false);
    });

    it("falls back to a per-run unique group when the input is unset", () => {
      // Default behavior must be identical to having no concurrency: when
      // concurrency_group is empty the group resolves to a github.run_id-keyed
      // string, so no run ever waits on another (and no parent/child deadlock).
      const group = workflow.concurrency?.group ?? "";
      expect(group).toContain("inputs.concurrency_group");
      expect(group).toContain("github.run_id");
    });
  });

  describe("verification coverage labels", () => {
    it("passes event labels to the coverage script without live GitHub context", () => {
      const job = workflow.jobs.verification_coverage;
      // This job used to inherit the workflow-level floor (#1769); that floor is
      // now written onto each job directly, because as a workflow-level block it
      // also zeroed the scopes it omitted for work_item_traceability. The scope
      // this job resolves to is unchanged — assert it where it now lives.
      //
      // What must never change is that it gains no `pull-requests` scope: the
      // gate reads PR labels from the event payload, not the API.
      expect(job.permissions).toEqual({ contents: "read" });
      expect(job.permissions?.["pull-requests"]).toBeUndefined();

      const steps = job.steps ?? [];
      const check = steps.find(s =>
        s.run?.includes("check-verification-coverage.mjs")
      );
      expect(check).toBeDefined();
      expect(check?.env?.VERIFY_PR_NUMBER).toBeUndefined();
      expect(check?.env?.VERIFY_GITHUB_REPOSITORY).toBeUndefined();
      expect(check?.env?.VERIFY_GITHUB_TOKEN).toBeUndefined();
      expect(check?.env?.VERIFY_LABELS).toContain(
        "github.event.pull_request.labels"
      );
    });
  });

  describe("coverage job service inputs", () => {
    it("declares inert coverage service and env inputs", () => {
      const inputs = workflow.on.workflow_call?.inputs ?? {};

      expect(inputs.coverage_services).toEqual({
        description:
          "Optional JSON service-container spec for the coverage job. Empty string preserves prior behavior. Accepts an object map or array with image plus optional name, ports, env, options, and healthTimeoutSeconds.",
        required: false,
        default: "",
        type: "string",
      });
      expect(inputs.coverage_env).toEqual({
        description:
          "Optional JSON object of extra environment variables scoped to the coverage job before test:cov. Empty string preserves prior behavior.",
        required: false,
        default: "",
        type: "string",
      });
    });

    it("starts optional service containers and applies env before coverage", () => {
      const steps = workflow.jobs.test_unit.steps ?? [];
      const checkIndex = steps.findIndex(step => step.id === "check_script");
      const serviceIndex = steps.findIndex(
        step => step.name === "🧰 Start coverage service containers"
      );
      const envIndex = steps.findIndex(
        step => step.name === "🧪 Apply coverage environment"
      );
      const coverageIndex = steps.findIndex(
        step => step.name === "🧪 Run unit tests with coverage"
      );

      expect(checkIndex).toBeGreaterThanOrEqual(0);
      expect(serviceIndex).toBeGreaterThan(checkIndex);
      expect(envIndex).toBeGreaterThan(serviceIndex);
      expect(coverageIndex).toBeGreaterThan(envIndex);

      const serviceStep = steps[serviceIndex];
      expect(serviceStep?.if).toBe(
        "steps.check_script.outputs.exists == 'true' && inputs.coverage_services != ''"
      );
      expect(serviceStep?.env?.COVERAGE_SERVICES).toBe(
        "${{ inputs.coverage_services }}"
      );
      expect(serviceStep?.run).toContain("docker rm -f");
      expect(serviceStep?.run).toContain("docker inspect");
      expect(serviceStep?.run).toContain(
        "options must be an array of docker flags"
      );
      expect(serviceStep?.run).toContain(
        "Math.trunc(Number(service.healthTimeoutSeconds ?? 60))"
      );
      expect(serviceStep?.run).not.toContain("optionSuffix");

      const envStep = steps[envIndex];
      expect(envStep?.if).toBe(
        "steps.check_script.outputs.exists == 'true' && inputs.coverage_env != ''"
      );
      expect(envStep?.env?.COVERAGE_ENV).toBe("${{ inputs.coverage_env }}");
      expect(envStep?.run).toContain(
        'const { randomUUID } = require("node:crypto");'
      );
      expect(envStep?.run).toContain("randomUUID().replace");
      expect(envStep?.run).toContain("JSON.stringify(value)");
      expect(envStep?.run).not.toContain('lines.push("LISA_COVERAGE_ENV")');
      expect(envStep?.run).toContain(
        "fs.appendFileSync(process.env.GITHUB_ENV"
      );
    });
  });

  describe("retained release artifact inputs", () => {
    it("derives exact scoped fetches from the certificate generator authority", () => {
      const retainedRefspecs = RETAINED_RELEASES.map(
        ref => `refs/tags/${ref}:refs/tags/${ref}`
      );
      for (const jobId of ["declared_gates", "test_unit"]) {
        const checkout = workflow.jobs[jobId]?.steps?.find(
          step => step.uses === "actions/checkout@v6"
        );
        expect(checkout, `${jobId} checkout`).toBeDefined();
        expect(checkout?.with?.["fetch-tags"], `${jobId} all tags`).toBeFalsy();
        const fetch = workflow.jobs[jobId]?.steps?.find(
          step => step.name === "📎 Fetch retained nightly guard release tags"
        );
        const actualRefspecs = [
          ...(fetch?.run ?? "").matchAll(
            /refs\/tags\/v[^\s:]+:refs\/tags\/v[^\s\\]+/gu
          ),
        ].map(match => match[0]);
        expect(actualRefspecs, `${jobId} retained refs`).toEqual(
          retainedRefspecs
        );
        expect(fetch?.if, `${jobId} caller scope`).toContain(
          "github.repository == 'CodySwannGT/lisa'"
        );
        expect(fetch?.env?.GH_TOKEN, `${jobId} step token`).toBe(
          "${{ github.token }}"
        );
        expect(fetch?.run, `${jobId} artifact scope`).toContain(
          "scripts/generate-nightly-e2e-guard-certificate.mjs"
        );
        expect(fetch?.run, `${jobId} ephemeral authentication`).toContain(
          "credential.helper"
        );
        expect(fetch?.run, `${jobId} retained tag fetch`).not.toContain(
          "refs/tags/*"
        );
      }
    });
  });

  describe("e2e route coverage dependencies", () => {
    it("installs host dependencies after detection and before route analysis", () => {
      const steps = workflow.jobs.e2e_coverage.steps ?? [];
      const checkIndex = steps.findIndex(step => step.id === "check_script");
      const bunIndex = steps.findIndex(step => step.name === "🍞 Setup Bun");
      const installIndex = steps.findIndex(
        step => step.name === "📦 Install dependencies"
      );
      const requireIndex = steps.findIndex(
        step => step.name === "🧭 Require e2e route/screen coverage thresholds"
      );

      expect(checkIndex).toBeGreaterThanOrEqual(0);
      expect(bunIndex).toBeGreaterThan(checkIndex);
      expect(installIndex).toBeGreaterThan(bunIndex);
      expect(requireIndex).toBeGreaterThan(installIndex);

      const setupBun = steps[bunIndex];
      expect(setupBun?.if).toContain(
        "steps.check_script.outputs.exists == 'true'"
      );
      expect(setupBun?.if).toContain("inputs.package_manager == 'bun'");

      const gateIndex = steps.findIndex(step => step.id === "gate");
      const gateRunIndex = steps.findIndex(
        step => step.name === "🧭 Run the journey-coverage gate"
      );
      // The gate resolves BEFORE the probe and both proving steps run after
      // the install, because either of them may need the project's
      // dependencies.
      expect(gateIndex).toBeGreaterThanOrEqual(0);
      expect(gateIndex).toBeLessThan(checkIndex);
      expect(gateRunIndex).toBeGreaterThan(installIndex);

      const install = steps[installIndex];
      // Both disjuncts, as one exact string. The gate arm is load-bearing: a
      // project that declared `journey-coverage` with its own task and has no
      // shipped script would otherwise run that task against a tree with no
      // node_modules.
      expect(install?.if).toBe(
        "steps.check_script.outputs.exists == 'true' || steps.gate.outputs.configured == 'true'"
      );
      expect(install?.env?.PACKAGE_MANAGER).toBe(
        "${{ inputs.package_manager }}"
      );
      expect(install?.run).not.toContain("${{ inputs.package_manager }}");
      expect(install?.run).toMatch(
        /if \[\s*"\$PACKAGE_MANAGER"\s*=\s*"npm"\s*\]; then[\s\S]*npm ci/
      );
      expect(install?.run).toContain("yarn install --frozen-lockfile");
      expect(install?.run).toContain("bun install --frozen-lockfile");
      expect(install?.["working-directory"]).toBe(
        "${{ inputs.working_directory || '.' }}"
      );
    });
  });

  describe("least-privilege permissions floor", () => {
    it("declares NO workflow-level floor, because a floor is really a ceiling", () => {
      // Reverses #1769, which assumed a workflow-level block only *caps* callers
      // that grant too much. It does the opposite as well: it sets every scope it
      // OMITS to `none` for every job declaring none of its own. `contents: read`
      // here therefore capped work_item_traceability at contents+metadata no
      // matter what the caller granted.
      //
      // Measured 2026-08-14: AcmeOrgA/backend and acmeorgb/backend-v2
      // both granted contents/issues/pull-requests read on the calling job and
      // both received `Contents: read, Metadata: read`. The gate reported
      // "could verify NOTHING" and named the caller — which was already correct.
      //
      // The fix cannot be to add the scopes here. A called workflow requesting a
      // scope the caller never held is a startup_failure for the caller's ENTIRE
      // run (#2046, #2566), and these workflows are consumed @main by repos whose
      // ci.yml is create-only. So the old floor moved down onto every job that
      // relied on it, byte-for-byte, and only work_item_traceability is left
      // blank — the one job that must inherit the caller's grant.
      expect(workflow.permissions).toBeUndefined();
    });

    it("keeps the old floor on every job that used to inherit it", () => {
      // The floor-move must not have widened anything. Every job except the one
      // deliberate blank carries an explicit block, so a job added later cannot
      // silently inherit the caller's full grant.
      const blank = Object.entries(workflow.jobs)
        .filter(([, job]) => job.permissions === undefined)
        .map(([name]) => name);
      expect(blank).toEqual(["work_item_traceability"]);

      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        if (jobName === "work_item_traceability") {
          continue;
        }
        // Either the moved floor, or a stricter block the job already declared.
        const scopes = job.permissions ?? {};
        expect(
          scopes.contents === "read" || Object.keys(scopes).length === 0,
          `${jobName} lost or widened the moved floor: ${JSON.stringify(scopes)}`
        ).toBe(true);
      }
    });

    it("gives summary-only jobs an empty permissions block", () => {
      // These jobs neither check out the repository nor call the API.
      // `playwright_e2e_setup` left this list with the job: it moved to
      // `playwright-e2e.yml`, where the same assertion is made against it.
      // Leaving it here would have read `undefined?.permissions` and compared
      // it to `{}` — a failing assertion, and had it been written with `??`
      // it would have been a passing one about a job that is not there.
      for (const jobName of [
        "security_tools_summary",
        "compliance_validation",
        "performance_summary",
      ]) {
        expect(workflow.jobs[jobName]?.permissions, jobName).toEqual({});
      }
    });

    it("resolves every job to a scope with no write access", () => {
      // Effective scope = job-level block when present, otherwise the
      // workflow-level floor. An audit of all jobs found zero uses of `gh`,
      // `github.rest.*`, `GITHUB_TOKEN`, or `github.token`, so no job needs a
      // write scope. This assertion catches a future job silently regressing
      // the floor by declaring one.
      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        const effective = job.permissions ?? workflow.permissions ?? {};
        const writeScopes = Object.entries(effective)
          .filter(([, value]) => value === "write")
          .map(([scope]) => scope);
        expect(writeScopes, `${jobName} must not hold a write scope`).toEqual(
          []
        );
      }
    });

    it("checks out without persisting the git credential", () => {
      // A persisted credential outlives the checkout step and is readable by
      // every later step (and any compromised third-party action) in the job.
      // No job in this workflow reuses the checkout credential.
      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        for (const step of job.steps ?? []) {
          if (!step.uses?.startsWith("actions/checkout@")) {
            continue;
          }

          expect(step.with?.["persist-credentials"], jobName).toBe(false);
        }
      }
    });
  });

  describe("cross-repo reusable workflow token handling", () => {
    it("does not declare reserved GITHUB_* environment keys", () => {
      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        for (const step of job.steps ?? []) {
          const envKeys = Object.keys(step.env ?? {});
          const reservedKeys = envKeys.filter(key => key.startsWith("GITHUB_"));
          expect(reservedKeys, `${jobName}: ${step.name ?? step.id}`).toEqual(
            []
          );
        }
      }
    });

    it("passes only SonarCloud's token to the SonarCloud action", () => {
      const steps = workflow.jobs.sonarcloud.steps ?? [];
      const scan = steps.find(
        s =>
          s.uses ===
          // The pinned SHA for v6.0.0 (#3585); the version lives in a trailing
          // YAML comment, which the parser strips before this comparison.
          "SonarSource/sonarqube-scan-action@fd88b7d7ccbaefd23d8f36f73b59db7a3d246602"
      );

      expect(scan).toBeDefined();
      expect(scan?.env?.SONAR_TOKEN).toBe("${{ secrets.SONAR_TOKEN }}");
      expect(scan?.env).not.toHaveProperty("GITHUB_TOKEN");
    });
  });

  describe("cross-repo reusable workflow approval gate", () => {
    it("does not bind a dynamic environment in the optional approval job", () => {
      expect(workflow.jobs.approval_gate.environment).toBeUndefined();
    });
  });

  describe("GitGuardian quota exhaustion", () => {
    it.each([
      ["quality.yml", QUALITY_YML],
      ["quality-rails.yml", QUALITY_RAILS_YML],
    ])("%s soft-fails only quota exhaustion", (_label, workflowPath) => {
      const raw = fs.readFileSync(workflowPath, "utf8");
      const parsed = yaml.load(raw) as QualityWorkflow;
      const steps = parsed.jobs.secret_scanning.steps ?? [];
      const scan = steps.find(s => s.name === "🔐 GitGuardian scan");

      expect(scan).toBeDefined();
      expect(scan?.uses).toBeUndefined();
      expect(scan?.run).toContain("ggshield secret scan ci");
      expect(scan?.run).not.toContain("--show-secrets");
      expect(scan?.run).not.toContain("--all-policies");
      expect(scan?.run).toContain("no more API calls available");
      expect(scan?.run).toContain('exit "$scan_status"');
    });
  });

  describe("bun audit allowlist handling", () => {
    it("filters bun audit JSON by GHSA, advisory id, and CVE allowlists", () => {
      const steps = workflow.jobs.npm_security_scan.steps ?? [];
      const audit = steps.find(s => s.name === "🔒 Run security audit");
      const run = audit?.run ?? "";

      // Production-scoped, matching the pre-push hook and the npm/yarn paths so
      // the local and CI audit gates agree (dev/supply-chain is Snyk's job).
      expect(run).toContain("bun audit --production --json");
      expect(run).not.toContain(
        "bun audit --audit-level=high $BUN_IGNORE_FLAGS"
      );
      expect(run).not.toContain("--ignore=$_id");
      expect(run).toContain('ghsa_id: (.url // "" | split("/") | last)');
      expect(run).toContain('advisory_id: (.id // "" | tostring)');
      expect(run).toContain("cves: ([.cve?, .cves[]?]");
      expect(run).toContain("$ghsa_ids | index($id)");
      expect(run).toContain("$cve_ids | index($cve)");
    });
  });
});

describe("learnings-budget gate (#1730, #2932)", () => {
  // The host path must use the resolver-aware CLI and keep the marker assertion
  // so the gate cannot silently pass through a self-skipping CLI.
  it.each([QUALITY_YML, QUALITY_RAILS_YML])(
    "%s gates the resolved project learnings ledger",
    file => {
      const workflow = fs.readFileSync(file, "utf8");

      expect(workflow).toContain(
        'bunx "@codyswann/lisa@$version" check-learnings-budget | tee learnings-budget.out'
      );
      // #3089 added `saturated` as a third within-budget verdict at exit 0.
      // The marker grep exists to refuse a run that printed NO verdict, so it
      // has to accept that one too — otherwise a host project whose ledger
      // filled up would fail this step on the grep, which is precisely the
      // "blame the unrelated change" outcome the warning band avoids.
      expect(
        workflow.match(
          /grep -qE "learnings budget \(passed\|saturated\)\|no learnings file"/g
        )
      ).toHaveLength(1);
      expect(workflow).not.toMatch(
        /grep -qE "learnings budget passed\|no learnings file"/u
      );
      expect(workflow).not.toContain(
        "check-learnings-budget .lisa/PROJECT_LEARNINGS.md"
      );
      expect(workflow).not.toContain("learnings-budget-relocated.out");
    }
  );

  // #2932. The version was the literal `2.297.0`, written into BOTH workflows,
  // which no project could override and which sat sixty-odd releases behind —
  // so every consumer's gate enforced a learnings contract none of them was on,
  // and bumping it was an edit to a workflow they do not own. It now comes from
  // the project's own dependency range, and there is no literal to fall back
  // to: a project that declares none FAILS rather than being handed a guess.
  it.each([QUALITY_YML, QUALITY_RAILS_YML])(
    "%s takes the published CLI's version from the project, not from a literal",
    file => {
      const workflow = fs.readFileSync(file, "utf8");

      expect(workflow).not.toContain("@codyswann/lisa@2.297.0");
      expect(workflow).not.toMatch(/@codyswann\/lisa@\d+\.\d+\.\d+/u);
      expect(workflow).toContain('["@codyswann/lisa"]');
      expect(workflow).toContain(
        "Learnings budget gate cannot resolve a version"
      );
    }
  );

  // The Lisa source repo must check against its OWN in-tree contract: a
  // published version necessarily lags a release, so a commit that raises the
  // budget and migrates the ledger together would be judged by the stale budget
  // (the #2001 deploy failure). Rails hosts never carry Lisa source, so only the
  // TypeScript quality workflow grows the self-check branch.
  it("checks the Lisa source repo against its in-tree contract, not a release", () => {
    const workflow = fs.readFileSync(QUALITY_YML, "utf8");

    expect(workflow).toContain("scripts/check-learnings-budget.ts");
    expect(workflow).toContain("src/core/learnings-budget-check.ts");
    // The bare no-arg form is now the RIGHT call, and that is a change to the
    // script rather than to the workflow: it used to check only the shipped
    // all/create-only template (0 entries, always passes), so the workflow had
    // to resolve and pass the ledger path itself to keep the gate real. As of
    // #2932 it checks the template AND this repository's ledger, resolved the
    // way the contract resolves it, so the workaround is gone from here and the
    // trap is gone from the script.
    expect(workflow).toContain("bun scripts/check-learnings-budget.ts | tee");
    expect(workflow).not.toContain(
      'bun scripts/check-learnings-budget.ts "$ledger"'
    );
  });

  // #2932's core scenario. The property was enforced in three workflows and the
  // skip token reached two; the third ran the same command as one step among
  // fifteen inside `🧩 Plugin artifacts match source`, a REQUIRED context, so it
  // could not be declined at all. It moved into the gated job.
  it("no longer enforces the budget outside the gated job", () => {
    const pluginsSync = fs.readFileSync(
      path.join(REPO_ROOT, ".github", "workflows", "plugins-sync.yml"),
      "utf8"
    );

    expect(pluginsSync).not.toContain("run: bun run check:learnings-budget");
  });
});

describe("release and deploy workflows", () => {
  let releaseWorkflow: ReleaseWorkflow;
  let deployWorkflow: DeployWorkflow;
  let nestjsDeployRaw: string;
  let nestjsDeployWorkflow: DeployWorkflow;
  let expoDeployWorkflow: DeployWorkflow;
  let easBuildWorkflow: ReusableWorkflow;
  let createIssueOnFailureWorkflow: ReusableWorkflow;
  let createGithubIssueOnFailureWorkflow: ReusableWorkflow;

  beforeAll(() => {
    releaseWorkflow = yaml.load(
      fs.readFileSync(RELEASE_YML, "utf8")
    ) as ReleaseWorkflow;
    deployWorkflow = yaml.load(
      fs.readFileSync(DEPLOY_YML, "utf8")
    ) as DeployWorkflow;
    nestjsDeployRaw = fs.readFileSync(NESTJS_DEPLOY_YML, "utf8");
    nestjsDeployWorkflow = yaml.load(nestjsDeployRaw) as DeployWorkflow;
    expoDeployWorkflow = yaml.load(
      fs.readFileSync(EXPO_DEPLOY_YML, "utf8")
    ) as DeployWorkflow;
    easBuildWorkflow = yaml.load(
      fs.readFileSync(EAS_BUILD_YML, "utf8")
    ) as ReusableWorkflow;
    createIssueOnFailureWorkflow = yaml.load(
      fs.readFileSync(CREATE_ISSUE_ON_FAILURE_YML, "utf8")
    ) as ReusableWorkflow;
    createGithubIssueOnFailureWorkflow = yaml.load(
      fs.readFileSync(CREATE_GITHUB_ISSUE_ON_FAILURE_YML, "utf8")
    ) as ReusableWorkflow;
  });

  it("never requests a scope its own callers may not hold", () => {
    // release.yml is ITSELF a called workflow (host deploy.yml invokes it), so
    // a scope requested here must be granted by EVERY host or their whole run
    // dies at startup with zero jobs — and host deploy.yml is create-only, so
    // installed repos can never self-heal. quality.yml's work_item_traceability
    // job declares no permissions of its own and is pull_request-only, so this
    // push path needs nothing beyond the long-standing baseline.
    expect(releaseWorkflow.jobs.quality.permissions).toEqual({
      contents: "read",
      "pull-requests": "read",
    });
  });

  it("pushes signed release tags after creating them", () => {
    const steps = releaseWorkflow.jobs.release_signing.steps ?? [];
    const signTag = steps.find(s => s.name === "Create Signed Git Tag");
    const run = signTag?.run ?? "";

    expect(signTag).toBeDefined();
    expect(run).toContain("git tag -s");
    expect(run).toContain(
      'git push origin "refs/tags/${{ needs.version.outputs.tag }}:refs/tags/${{ needs.version.outputs.tag }}"'
    );
  });

  it("normalizes versions and bumps past existing tags before composing release tags", () => {
    // Version counters are branch-local but tags are repo-global (dev and
    // staging can compute the same next version); custom pins never bump.
    const steps = releaseWorkflow.jobs.version.steps ?? [];
    const determineVersion = steps.find(s => s.name === "Determine Version");
    const run = determineVersion?.run ?? "";

    expect(run).toContain("awk '{print $4}'");
    expect(run).toContain('npx semver -i patch "$VERSION"');
    expect(run).toContain('!= "custom"');

    expect(run).toContain('VERSION="${VERSION#v}"');

    // Environment-scoped release tags (standard-version): prod cuts a clean
    // vX.Y.Z; non-prod cuts a vX.Y.Z-<env>.<ts> pre-release tag so tag
    // namespaces never collide across branches. package.json version stays
    // clean; only the git tag carries the suffix.
    expect(determineVersion?.env).toMatchObject({
      RELEASE_ENVIRONMENT: "${{ inputs.environment }}",
      RELEASE_PRERELEASE: "${{ inputs.prerelease }}",
      RELEASE_STRATEGY: "${{ inputs.release_strategy }}",
    });
    expect(run).toContain('PRERELEASE_LABEL="$RELEASE_PRERELEASE"');
    expect(run).toContain("main|master|prod|production) PRERELEASE_LABEL=");
    expect(run).toContain('TAG="v${VERSION}-${PRERELEASE_LABEL}.$(date +%s)"');
    expect(run).toContain('echo "prerelease=true"');
    expect(run).toContain('echo "prerelease=false"');
    expect(run).toContain("git fetch --tags --force origin");
    expect(run).toContain('TAG="v$VERSION"');

    const guardIndex = run.indexOf("git rev-parse -q --verify");
    expect(guardIndex).toBeGreaterThan(run.indexOf('VERSION="${VERSION#v}"'));
    expect(run.indexOf('echo "version=$VERSION"')).toBeGreaterThan(guardIndex);
    expect(run.indexOf('echo "tag=$TAG"')).toBeGreaterThan(guardIndex);
  });

  it("fails release creation on API errors but reuses an existing release on rerun", () => {
    const steps = releaseWorkflow.jobs.github_release.steps ?? [];
    const createRelease = steps.find(s => s.name === "Create GitHub Release");
    const run = createRelease?.run ?? "";

    expect(createRelease).toBeDefined();
    expect(run).toContain('-w "%{http_code}"');
    expect(run).toContain(
      '[ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 300 ]'
    );
    expect(run).toContain("exit 1");
    expect(run).toContain('select(.code == "already_exists")');
    expect(run).toContain("releases/tags/${{ needs.version.outputs.tag }}");
    expect(run).toContain(
      '[ "$TARGET" != "${{ needs.version.outputs.release_commit }}" ]'
    );
    expect(run).toContain("jq -e -r '.html_url'");
    expect(run).toContain("jq -e -r '.id'");
    expect(run).toContain("jq -e -r '.upload_url'");
  });

  it("queues release deploy runs instead of cancelling in-flight publishes", () => {
    expect(deployWorkflow.concurrency).toBeDefined();
    expect(deployWorkflow.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  it("keeps NestJS dotenv materialization opt-in and env-driven", () => {
    const deploySteps = nestjsDeployWorkflow.jobs?.deploy.steps ?? [];
    const dotenvStep = deploySteps.find(
      step => step.name === "Materialize dotenv env file"
    );

    expect(dotenvStep).toBeDefined();
    expect(dotenvStep?.if).toBe(
      "${{ vars.DOTENV_ENV_MATERIALIZATION_KEYS != '' }}"
    );
    expect(dotenvStep?.env?.DOTENV_ENV_MATERIALIZATION_KEYS).toBe(
      "${{ vars.DOTENV_ENV_MATERIALIZATION_KEYS }}"
    );
    expect(dotenvStep?.run).toContain('printf \'%s=%s\\n\' "$key" "$value"');
    expect(dotenvStep?.run).toContain("Skipping empty dotenv key");
    expect(nestjsDeployRaw).toContain(
      "Optional project mapping for serverless-dotenv-plugin projects"
    );
  });

  it("keeps NestJS post-deploy health smoke opt-in and CloudFormation-backed", () => {
    const deploySteps = nestjsDeployWorkflow.jobs?.deploy.steps ?? [];
    const smokeStep = deploySteps.find(
      step => step.name === "Post-deploy health smoke"
    );

    expect(smokeStep).toBeDefined();
    expect(smokeStep?.if).toBe(
      "${{ vars.POST_DEPLOY_HEALTH_CHECK_ENABLED == 'true' }}"
    );
    expect(smokeStep?.env?.HEALTH_OUTPUT_KEY).toContain("HttpApiUrl");
    expect(smokeStep?.env?.HEALTH_PATH).toContain("/health");
    expect(smokeStep?.run).toContain("aws cloudformation describe-stacks");
    expect(smokeStep?.run).toContain("curl --fail --silent --show-error");
    expect(smokeStep?.run).toContain("HEALTH_EXPECTED_BODY");
  });

  it("keeps NestJS deploy output plumbing and migration skip gate valid", () => {
    const deployJob = nestjsDeployWorkflow.jobs?.deploy;
    const deployNeeds = needsList(deployJob);

    expect(deployNeeds).toEqual(
      expect.arrayContaining([
        "determine_environment",
        "release",
        "check_migration_required",
        "migrate",
        "verify_aws_credentials",
      ])
    );
    expect(deployJob?.outputs?.environment_url).toContain(
      "steps.deployment_outputs.outputs.environment_url"
    );
    expect(deployJob?.outputs?.deployment_status).toContain(
      "steps.deployment_outputs.outputs.deployment_status"
    );
    expect(deployJob?.if).toContain(
      "needs.check_migration_required.outputs.requires_migration != 'true'"
    );
    expect(deployJob?.if).toContain("needs.migrate.result == 'success'");
    expect(deployJob?.if).not.toContain(
      "needs.migrate.result == 'success' || needs.migrate.result == 'skipped'"
    );
    // A failed check_migration_required job leaves requires_migration empty
    // (which is != 'true') and its downstream jobs skipped, so without this
    // gate deploy would run despite the migration check itself failing.
    expect(deployJob?.if).toContain(
      "needs.check_migration_required.result == 'success'"
    );

    const outputStep = deployJob?.steps?.find(
      step => step.id === "deployment_outputs"
    );
    expect(outputStep).toBeDefined();
    expect(outputStep?.run).toContain("deployment_status=success");
  });

  it("does not clobber runner-provided GITHUB_OUTPUT in NestJS helper jobs", () => {
    for (const jobName of ["check_migration_required", "verify_vpn"]) {
      const job = nestjsDeployWorkflow.jobs?.[jobName];
      for (const step of job?.steps ?? []) {
        const envKeys = Object.keys(step.env ?? {});
        expect(envKeys, `${jobName}: ${step.name ?? step.id}`).not.toContain(
          "GITHUB_OUTPUT"
        );
      }
    }
  });

  it("uses explicit least-privilege permissions for read-only NestJS jobs and release caller", () => {
    expect(
      nestjsDeployWorkflow.jobs?.determine_environment.permissions
    ).toEqual({ contents: "read" });
    expect(
      nestjsDeployWorkflow.jobs?.verify_aws_credentials.permissions
    ).toEqual({ contents: "read" });
    expect(
      nestjsDeployWorkflow.jobs?.check_migration_required.permissions
    ).toEqual({ contents: "read" });
    expect(nestjsDeployWorkflow.jobs?.verify_vpn.permissions).toEqual({
      contents: "read",
    });
    // No issues scope: release.yml requests none, and a host granting a scope
    // its callee never asks for is dead weight, not defense in depth.
    expect(nestjsDeployWorkflow.jobs?.release.permissions).toEqual({
      contents: "write",
      "pull-requests": "read",
    });
  });

  it("lets Expo deploy skip EAS build cleanly when EXPO_TOKEN is absent", () => {
    const tokenSecret = easBuildWorkflow.on?.workflow_call?.secrets?.EXPO_TOKEN;
    expect(tokenSecret).toBeDefined();
    expect(tokenSecret?.required).toBe(false);

    const check = expoDeployWorkflow.jobs?.check_eas_setup;
    expect(check?.outputs?.has_eas_setup).toContain(
      "steps.check.outputs.has_eas_setup"
    );

    const trigger = expoDeployWorkflow.jobs?.trigger_eas_build;
    expect(trigger?.if).toContain(
      "needs.check_eas_setup.outputs.has_eas_setup == 'true'"
    );
    expect(trigger?.permissions).toEqual({ contents: "read" });
  });

  it("grants reusable Expo release and deploy jobs the permissions they request", () => {
    expect(expoDeployWorkflow.jobs?.release.permissions).toEqual({
      contents: "write",
      "pull-requests": "read",
    });
    expect(expoDeployWorkflow.jobs?.determine_environment.permissions).toEqual({
      contents: "read",
    });
    expect(expoDeployWorkflow.jobs?.check_eas_setup.permissions).toEqual({
      contents: "read",
    });
    expect(
      expoDeployWorkflow.jobs?.check_app_config_changes.permissions
    ).toEqual({ contents: "read" });
    expect(expoDeployWorkflow.jobs?.deploy.permissions).toEqual({
      contents: "read",
    });
  });

  it("grants GitHub issue fallback workflows enough token scope for read-only repos", () => {
    expect(
      createIssueOnFailureWorkflow.jobs?.create_github_issue.permissions
    ).toEqual({
      contents: "read",
      issues: "write",
    });
    expect(
      createGithubIssueOnFailureWorkflow.jobs?.create_issue.permissions
    ).toEqual({
      contents: "read",
      issues: "write",
    });
  });
});

/* eslint-enable max-lines -- end scoped waiver for workflow contract coverage */
