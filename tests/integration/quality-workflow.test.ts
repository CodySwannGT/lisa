import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as path from "node:path";

import {
  REPO_ROOT,
  CREATE_ONLY_DIR,
  QUALITY_WORKFLOW_FILE,
  QUALITY_RAILS_WORKFLOW_FILE,
  QUALITY_YML,
  QUALITY_RAILS_YML,
  type WorkflowJob,
  type QualityWorkflow,
  needsList,
  GITHUB_WORKFLOWS_PARTS,
} from "./quality-workflow-fixtures.js";

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
    // `lint` is a strict prefix of `lint_slow`. That job was deleted in #3052,
    // but callers may still pass its retired token, and it must not reach the
    // plain lint job through a substring match.
    it("does not let the retired lint_slow token skip the plain lint job", () => {
      const lint = workflow.jobs.lint?.if ?? "";

      expect(lint).toContain(
        "!contains(format(',{0},', inputs.skip_jobs), ',lint,')"
      );
      expect(lint).not.toContain("inputs.skip_jobs), ',lint_slow,')");
      expect(workflow.jobs.lint_slow).toBeUndefined();
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

      it("'lint,test:integration' — written correctly, skips both", () => {
        const skip = "lint,test:integration";
        expect(jobRuns(workflow.jobs.lint, skip)).toBe(false);
        expect(jobRuns(workflow.jobs.test_integration, skip)).toBe(false);
      });

      it("'lint, test:integration' — the space makes the second RUN anyway (fails closed)", () => {
        const skip = "lint, test:integration";
        expect(jobRuns(workflow.jobs.lint, skip)).toBe(false);
        expect(jobRuns(workflow.jobs.test_integration, skip)).toBe(true);
      });

      it("' lint ' — padded on both sides, skips nothing at all", () => {
        expect(jobRuns(workflow.jobs.lint, " lint ")).toBe(true);
        expect(jobRuns(workflow.jobs.test_integration, " lint ")).toBe(true);
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
    it("runs the OUTCOME arm as a job on every pull request", () => {
      const job = workflow.jobs.skipped_required_checks;
      expect(job).toBeDefined();
      // NO SKIP CONDITION, as of #2933 — and `always()` is not one. The job
      // carried a `skipped_required_checks` skip token, so the guard against
      // silencing a required check had an off-switch of exactly the kind it
      // exists to refuse. The owner's ruling was to remove it rather than
      // relocate it into the gate registry. It now `needs:` every sibling to
      // read their outcomes, and `always()` is what stops a failed or skipped
      // sibling from skipping it in turn. `quality-non-declarable-jobs.test.ts`
      // holds the general rule; this case pins the job's own condition.
      expect(job?.if).toBe("always()");
      const run = job?.steps?.map(step => step.run ?? "").join("\n") ?? "";
      expect(run).toContain("check-skipped-required-checks.mjs");
      expect(run).toContain("--outcomes");
      // The #3385 shortcut: pass without a prover whenever `skip_jobs` was
      // empty. Once `skip_jobs` was retired that was every pull request.
      expect(run).not.toContain("SKIP_JOBS");
      const guardStep = job?.steps?.find(step =>
        step.run?.includes("check-skipped-required-checks.mjs")
      );
      expect(guardStep?.env?.LISA_JOB_RESULTS).toBe("${{ toJSON(needs) }}");
      expect(guardStep?.env?.LISA_GATE_MOMENT).toBe("${{ inputs.moment }}");
      // The enforced pull-request path may not depend on network or `gh` auth:
      // a flaky gate gets skipped, and a skipped gate is the false-green class
      // this guard exists to refuse. Since #3599 there is no remote arm to
      // reach for at all — it was removed with its `administration:read`
      // token, and the drift it caught is now discovered by consequence.
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

    it("ships NO scheduled workflow that reads a live ruleset (#3599)", () => {
      // The replacement for the deleted "runs the REMOTE arm on a schedule"
      // case. The removal is about a standing credential, so the assertion is
      // about the credential and the schedule, not about one file name — a
      // lighter-weight detector under any other name fails this too.
      const seeded = path.join(
        REPO_ROOT,
        "typescript",
        CREATE_ONLY_DIR,
        ...GITHUB_WORKFLOWS_PARTS
      );
      const names = fs.readdirSync(seeded);
      expect(names.length).toBeGreaterThan(0);
      expect(names).not.toContain("required-checks-drift.yml");
      for (const name of names) {
        const body = fs.readFileSync(path.join(seeded, name), "utf8");
        expect(
          body,
          `${name} must not request administration:read`
        ).not.toMatch(/administration:\s*read/u);
        expect(
          body,
          `${name} must not name a ruleset-read token`
        ).not.toContain("RULESET_READ_TOKEN");
      }
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
