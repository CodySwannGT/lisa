import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { load as loadYaml } from "js-yaml";
import { afterAll, describe, expect, it } from "vitest";

import { cleanGitEnv } from "../../helpers/test-utils.js";

const read = (file: string): string => readFileSync(path.resolve(file), "utf8");

// Absolute interpreter paths: a PATH-relative name would let a writable PATH
// entry shadow the binary these tests depend on.
const BASH = "/bin/bash";
const GIT = "/usr/bin/git";

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
  const result = spawnSync(GIT, args, {
    cwd: root,
    encoding: "utf8",
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
  describe("server-side validate-pr backstop in Lisa's own CI (#1978)", () => {
    const ci = loadYaml(read(".github/workflows/ci.yml")) as CiWorkflow;
    const job = ci.jobs?.["work_item_traceability"];
    const steps = job?.steps ?? [];

    it("runs validate-pr on pull requests only", () => {
      expect(job).toBeDefined();
      expect(job?.if).toContain("github.event_name == 'pull_request'");
      expect(
        steps.some(step =>
          step.run?.includes("scripts/lisa-work-item.mjs validate-pr")
        )
      ).toBe(true);
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
      const validate = steps.find(step =>
        step.run?.includes("scripts/lisa-work-item.mjs validate-pr")
      );
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
        const result = spawnSync(BASH, ["-c", script], {
          cwd: options.root,
          encoding: "utf8",
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

    it("grants the tracker reads the validator performs, and nothing more", () => {
      // `gh pr view` needs pull-requests:read and `gh issue view` needs
      // issues:read; the job writes nothing anywhere.
      expect(job?.permissions).toEqual({
        contents: "read",
        issues: "read",
        "pull-requests": "read",
      });
    });
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
