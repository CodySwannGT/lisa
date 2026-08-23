import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { load as loadYaml } from "js-yaml";
import { afterAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

const read = (file: string): string => readFileSync(path.resolve(file), "utf8");

// Absolute interpreter paths: a PATH-relative name would let a writable PATH
// entry shadow the binary these tests depend on.
const BASH = "/bin/bash";
const GIT = resolveGit();

/** The validator invocation the backstop job must actually run. */
const VALIDATE_PR = "scripts/lisa-work-item.mjs validate-pr";

/** Disposable repositories created by the CI-range cases, removed after them. */
const roots: string[] = [];

/**
 * Run Git inside a disposable repository, throwing on failure.
 *
 * GIT_DIR / GIT_WORK_TREE leak in when this suite runs under a git hook and
 * would retarget every command at the real repository, so they are stripped.
 * @param root - Repository directory
 * @param args - Git arguments
 * @returns Trimmed stdout
 */
function runGit(root: string, args: string[]): string {
  const result = boundedSpawnSync({
    label: `git ${args[0]}`,
    command: GIT,
    args,
    cwd: root,
    env: cleanGitEnv(process.env, {
      GIT_AUTHOR_EMAIL: "lisa@example.test",
      GIT_AUTHOR_NAME: "Lisa Test",
      GIT_COMMITTER_EMAIL: "lisa@example.test",
      GIT_COMMITTER_NAME: "Lisa Test",
    }),
  });
  if (result.status !== 0)
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

/**
 * Give a fresh repository three `main` commits and a `feature` branch forked
 * two commits back.
 * @param root - Repository directory
 */
function seedRepository(root: string): void {
  runGit(root, ["init", "-q", "-b", "main"]);
  for (const subject of ["base one", "base two", "base three"])
    runGit(root, ["commit", "-q", "--allow-empty", "-m", subject]);
  runGit(root, ["switch", "-q", "-c", "feature", "main~2"]);
  runGit(root, ["commit", "-q", "--allow-empty", "-m", "branch work"]);
}

/** Minimal shape of the pieces of `ci.yml` this suite asserts on. */
interface CiWorkflow {
  /** Workflow-level block. Must stay absent — see the ceiling-not-floor test. */
  readonly permissions?: Record<string, string>;
  readonly jobs?: Record<
    string,
    {
      readonly if?: string;
      readonly permissions?: Record<string, string>;
      readonly steps?: {
        readonly env?: Record<string, string>;
        readonly run?: string;
        readonly uses?: string;
        readonly with?: Record<string, unknown>;
      }[];
    }
  >;
}

describe("work-item Git enforcement wiring", () => {
  it.each([".husky", "typescript/copy-contents/.husky"])(
    "%s prepares, validates, and checks pushes through the shared validator",
    directory => {
      const prepare = path.join(directory, "prepare-commit-msg");
      expect(statSync(prepare).mode & 0o111).not.toBe(0);
      expect(read(prepare)).toContain(
        'node "$WORK_ITEM_SCRIPT" prepare-commit-msg "$@"'
      );
      expect(read(path.join(directory, "commit-msg"))).toContain(
        'node "$WORK_ITEM_SCRIPT" validate-commit "$COMMIT_MSG_FILE"'
      );
      expect(read(path.join(directory, "pre-push"))).toContain(
        'node "$WORK_ITEM_SCRIPT" validate-push "${1:-origin}"'
      );
      expect(read(path.join(directory, "commit-msg"))).not.toContain(
        "Auto-appended Jira key"
      );
    }
  );

  // Test hardened to kill mutant M001 (Risk Factor: Correctness / executable entrypoint).
  it("ships the validator to Lisa itself and downstream projects", () => {
    expect(read("scripts/lisa-work-item.mjs")).toContain(
      "../all/copy-overwrite/scripts/lisa-work-item.mjs"
    );
    const installed = read("all/copy-overwrite/scripts/lisa-work-item.mjs");
    for (const command of [
      "bind",
      "current",
      "attach-branch",
      "clear",
      "prepare-commit-msg",
      "validate-commit",
      "validate-push",
      "validate-pr",
    ]) {
      expect(installed).toContain(`command === "${command}"`);
    }
    expect(installed).toContain("WORK_ITEM_TRACKING_OK");
    expect(installed).not.toContain("await main()");
  });

  /**
   * #1978: the pre-push `validate-push` gate is client-side and fail-safe, and
   * #1956's security review proved a local bypass — an agent repoints
   * `refs/remotes/origin/HEAD` at a crafted tracking ref and the default-branch
   * exclusion empties the branch-authored range. `validate-pr` recomputes
   * `rev-list base..head` server-side with no exclusion and no symref, so it is
   * the designed backstop; it only backstops anything if CI actually runs it.
   */
  describe.each([
    ".github/workflows/quality.yml",
    ".github/workflows/quality-rails.yml",
  ])("server-side validate-pr backstop in %s (#1978, #2046)", workflow => {
    const ci = loadYaml(read(workflow)) as CiWorkflow;
    const job = ci.jobs?.["work_item_traceability"];
    const steps = job?.steps ?? [];

    it("runs validate-pr on pull requests only", () => {
      expect(job).toBeDefined();
      expect(job?.if).toContain("github.event_name == 'pull_request'");
      expect(steps.some(step => step.run?.includes(VALIDATE_PR))).toBe(true);
    });

    it("checks out enough history for rev-list base..head to resolve", () => {
      const checkout = steps.find(step => step.uses?.startsWith("actions/"));
      expect(checkout?.uses).toContain("actions/checkout");
      // A shallow clone cannot resolve `base..head`; the range would either
      // error or silently under-report, voiding the gate.
      expect(checkout?.with?.["fetch-depth"]).toBe(0);
    });

    it("checks out the PR head, not the synthetic merge ref", () => {
      const checkout = steps.find(step => step.uses?.startsWith("actions/"));
      // refs/pull/N/merge does not exist while the PR has conflicts and can lag
      // head.sha right after a push — both would redden this job for reasons
      // that have nothing to do with work-item traceability.
      expect(checkout?.with?.["ref"]).toContain(
        "github.event.pull_request.head.sha"
      );
    });

    it("ships a PR template carrying the Work-Item line the validator demands", () => {
      // `prWorkItem` requires EXACTLY ONE `Work-Item:` line in the PR body, and
      // nothing else makes one appear — lisa-git-submit-pr never emits it. A
      // template with zero or two lines fails every PR.
      const template = read(".github/pull_request_template.md");
      const lines = template
        .split(/\r?\n/u)
        .filter(line => /^Work-Item:\s*\S/u.test(line));

      expect(lines).toHaveLength(1);
    });

    it("passes the server-supplied range and PR number through the env-var form", () => {
      const validate = steps.find(step => step.run?.includes(VALIDATE_PR));
      // Env-var form (not shell-interpolated argv) keeps event payload values
      // out of the `run:` string entirely.
      expect(validate?.env?.["LISA_PR_BASE_SHA"]).toBeTruthy();
      expect(validate?.env?.["LISA_PR_HEAD_SHA"]).toContain(
        "github.event.pull_request.head.sha"
      );
      expect(validate?.env?.["LISA_PR_NUMBER"]).toContain(
        "github.event.pull_request.number"
      );
      expect(validate?.env?.["GH_TOKEN"]).toBeTruthy();
    });

    /**
     * The base-resolution step is shell embedded in YAML, so it would
     * otherwise ship unexercised. These cases run the workflow's OWN `run:`
     * block — read straight out of ci.yml — against disposable repositories.
     */
    describe("base resolution shell", () => {
      const script =
        steps.find(step => step.run?.includes("refs/remotes/origin/"))?.run ??
        "";

      afterAll(() => {
        for (const root of roots)
          rmSync(root, { force: true, recursive: true });
      });

      /**
       * Create a repository with `main` at three commits and a `feature`
       * branch forked two commits back — the shape of a PR whose base branch
       * advanced after the PR opened.
       * @returns The repository path and the SHAs the step reasons about
       */
      function scenario(): {
        base: string;
        head: string;
        root: string;
        tip: string;
      } {
        const root = mkdtempSync(path.join(tmpdir(), "lisa-ci-range-"));
        roots.push(root);
        seedRepository(root);
        return {
          base: runGit(root, ["rev-parse", "main~2"]),
          head: runGit(root, ["rev-parse", "feature"]),
          root,
          tip: runGit(root, ["rev-parse", "main"]),
        };
      }

      /**
       * Execute the workflow's own base-resolution block and read what it
       * exported.
       * @param options - Repository path plus the env the step receives
       * @param options.baseRef - `github.event.pull_request.base.ref`
       * @param options.baseSha - `github.event.pull_request.base.sha`
       * @param options.root - Repository the step runs in
       * @returns The `base=` value written to `GITHUB_OUTPUT`
       */
      function resolveBase(options: {
        baseRef: string;
        baseSha: string;
        root: string;
      }): string {
        const outputFile = path.join(options.root, "github-output");
        const result = boundedSpawnSync({
          label: "work-item base-resolution block",
          command: BASH,
          args: ["-c", script],
          cwd: options.root,
          env: cleanGitEnv(process.env, {
            GITHUB_OUTPUT: outputFile,
            PR_BASE_REF: options.baseRef,
            PR_BASE_SHA: options.baseSha,
            PR_HEAD_SHA: "0".repeat(40),
          }),
        });
        expect(result.stderr).toBe("");
        expect(result.status).toBe(0);
        return (/^base=(.+)$/mu.exec(readFileSync(outputFile, "utf8")) ??
          [])[1] as string;
      }

      it("advances to the base-branch tip so merge-synced base commits leave the range", () => {
        const { base, root, tip } = scenario();
        // origin/main sits ahead of the payload's base.sha, exactly as it does
        // on a PR whose base advanced and was then merge-synced in.
        runGit(root, ["update-ref", "refs/remotes/origin/main", tip]);

        expect(resolveBase({ baseRef: "main", baseSha: base, root })).toBe(tip);
      });

      it("keeps base.sha when the base branch was not fetched", () => {
        const { base, root } = scenario();

        expect(resolveBase({ baseRef: "main", baseSha: base, root })).toBe(
          base
        );
      });

      it("keeps base.sha when the tracked tip is not a descendant", () => {
        const { root, tip } = scenario();
        // Base branch rewound behind the payload's base.sha. A rewritten or
        // unrelated base must never widen the exclusion — emptying the range is
        // precisely the #1956 failure mode this job exists to catch.
        runGit(root, ["update-ref", "refs/remotes/origin/main", `${tip}~1`]);

        expect(resolveBase({ baseRef: "main", baseSha: tip, root })).toBe(tip);
      });
    });

    it("declares no workflow-level permissions block, so blank means inherit", () => {
      // A workflow-level block is not a floor, it is a CEILING: it also sets
      // every scope it omits to `none` for any job declaring none of its own.
      // Both files used to carry one, which silently capped work_item_traceability
      // at the top-level set no matter what the caller granted — contents+metadata
      // in quality.yml, and no `issues: read` in quality-rails.yml. Two consumers
      // granting all three read scopes were measured receiving only
      // `Contents: read, Metadata: read` (2026-08-14).
      //
      // The fix cannot be to ADD the scopes here: requesting a scope the caller
      // never held startup_fails the caller's ENTIRE run (#2046, #2566). So the
      // old floor was pushed down onto each job individually and the top-level
      // block removed, which leaves this job's blank block meaning what it says.
      expect(ci.permissions).toBeUndefined();
    });

    it("gives every other job an explicit block, so blank is never accidental", () => {
      // With no workflow-level block, a job added without a `permissions:` key
      // silently inherits the caller's full grant. That is correct for exactly
      // one job and a silent widening everywhere else, so the blank must be
      // unique and deliberate rather than a default.
      const blank = Object.entries(ci.jobs ?? {})
        .filter(([, candidate]) => candidate?.permissions === undefined)
        .map(([name]) => name);
      expect(blank).toEqual(["work_item_traceability"]);
    });

    it("never escalates permissions above the caller's grant", () => {
      // Regression guard for the #2046 startup_failure. A called workflow may
      // only DOWNGRADE the caller's grant: requesting a scope the caller never
      // held fails the ENTIRE run at startup, not just this job — and it does
      // so even on push paths where this job never runs. These workflows are
      // consumed @main by repos whose ci.yml is create-only and can never
      // self-heal, so an escalation here breaks the whole fleet at once.
      // Inheriting keeps the blast radius inside this job.
      expect(job?.permissions).toBeUndefined();
    });

    it("blocks rather than reports when the inherited token cannot read the PR", () => {
      const validate = steps.find(step => step.run?.includes(VALIDATE_PR));
      // This used to warn and `exit 0`, which reported SUCCESS for a gate that
      // had verified nothing — measured green on a private consumer whose PR
      // carried no trailer, no body line and no backlink (#2476). A check that
      // cannot verify must not claim it did, so the readiness probe now fails
      // and names the exact scope and the exact caller-side edit.
      expect(validate?.run).toContain("pull-requests: read");
      expect(validate?.run).toContain("issues: read");
      expect(validate?.run).toContain("scope_gap");
      expect(validate?.run).toContain(".github/workflows/ci.yml");
    });

    it("stays skippable so a repo can adopt tracked work on its own schedule", () => {
      // The reusable workflows are consumed @main, so this job goes live
      // fleet-wide the moment it merges. Without a skip token a repo mid
      // standards-adoption has no way to land anything.
      expect(job?.if).toContain("work_item_traceability,");
    });

    it("reports instead of failing when the gate is not enforceable", () => {
      const validate = steps.find(step => step.run?.includes(VALIDATE_PR));
      // A repo with no tracker configured, or a jira/linear repo whose
      // credentials were never mapped, cannot satisfy this gate at all. Failing
      // there would be a red check nobody can fix, which teaches people to
      // ignore red checks — so those paths exit 0 with an explanation.
      expect(validate?.run).toContain("No tracker configured");
      expect(validate?.run).toContain("JIRA_API_TOKEN");
      expect(validate?.run).toContain("LINEAR_API_KEY");
    });
  });

  /**
   * #2046: the job only backstops a downstream repo if that repo's caller
   * grants the scopes it needs. A reusable workflow can only DOWNGRADE the
   * caller's grant, so a caller missing `issues: read` silently produces a job
   * that cannot read the tracker.
   */
  it.each([
    "typescript/create-only/.github/workflows/ci.yml",
    "expo/create-only/.github/workflows/ci.yml",
    "nestjs/create-only/.github/workflows/ci.yml",
    "cdk/create-only/.github/workflows/ci.yml",
    "rails/create-only/.github/workflows/ci.yml",
    "harper-fabric/copy-overwrite/.github/workflows/ci.yml",
    "phaser/copy-overwrite/.github/workflows/ci.yml",
  ])("%s grants the caller scopes the backstop needs", template => {
    const caller = loadYaml(read(template)) as CiWorkflow;
    const job = Object.values(caller.jobs ?? {}).find(candidate =>
      String((candidate as { uses?: string }).uses ?? "").includes("/quality")
    );

    expect(job?.permissions?.["issues"]).toBe("read");
    expect(job?.permissions?.["pull-requests"]).toMatch(/read|write/u);
  });

  it.each([
    [
      "typescript/github-rulesets/quality-checks.json",
      "🔍 Quality Checks / 🔗 Work-Item Traceability",
    ],
    [
      "rails/github-rulesets/quality-checks.json",
      "Quality Checks / 🔗 Work-Item Traceability",
    ],
  ])("%s requires the backstop context", (ruleset, context) => {
    // A job that reports red but is not a REQUIRED context does not gate
    // anything — auto-merge sails past it. That was the #2039 gap.
    const parsed = JSON.parse(read(ruleset)) as {
      rules: {
        parameters?: {
          required_status_checks?: { context: string }[];
        };
        type: string;
      }[];
    };
    const contexts = parsed.rules
      .filter(rule => rule.type === "required_status_checks")
      .flatMap(rule => rule.parameters?.required_status_checks ?? [])
      .map(check => check.context);

    expect(contexts).toContain(context);
  });

  it("gives Rails the same gates and a single stdin consumer", () => {
    const lefthook = read("rails/copy-overwrite/lefthook.yml");
    expect(lefthook).toContain(
      "node scripts/lisa-work-item.mjs prepare-commit-msg {1} {2} {3}"
    );
    expect(lefthook).toContain(
      "node scripts/lisa-work-item.mjs validate-commit {1}"
    );
    expect(lefthook).toContain(
      "node scripts/lisa-work-item.mjs validate-push {1}"
    );
    expect(lefthook.match(/use_stdin: true/g)).toHaveLength(1);
  });
});
