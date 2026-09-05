/**
 * Tests for block-blind-automerge.sh — the PreToolUse Bash guard that refuses
 * to ARM auto-merge on a PR GitHub already says is blocked on review.
 *
 * The discriminating case, and the reason a happy-path suite would prove
 * nothing here: a PR with ZERO failing checks and a stale `CHANGES_REQUESTED`
 * review. `reviewDecision` is not part of the check rollup, so the failing-check
 * count reads 0 and the checks tab is entirely green while the PR can never
 * merge. A test over a PR with a red check is satisfied by the *old* behaviour
 * and pins nothing. Every arming case below therefore ships a green
 * `statusCheckRollup` alongside the blocking verdict.
 *
 * The properties pinned, in order of how easily each is lost:
 *
 *   1. The refusal fires on the blocked PR and NOT on the same command once
 *      the blocker clears. One without the other is a guard that either never
 *      bites or never lets go.
 *   2. Only ARMING is intercepted. A direct merge fails loudly on its own, and
 *      `--admin` is a deliberate human override; refusing either would make the
 *      guard something to route around.
 *   3. The probe asks about the PR the command actually names. A guard that
 *      reads the wrong PR is the same defect in a new place — measuring what it
 *      can see rather than what it means.
 *   4. Inability to measure degrades to ALLOW and says so. A guard that is
 *      silently absent reads exactly like a guard that is passing.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ARM,
  bash,
  BLOCKED_PR,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  fakeGh,
  pathWith,
  READY_PR,
  REVIEW_SKIPPED_PR,
  runHook,
  TOOLS_WITHOUT_GH,
  TOOLS_WITHOUT_JQ,
} from "./support/blind-automerge.js";

/** The marker every degrade-loudly path prints, whatever the cause. */
const DEGRADED = "NOT active";

/** The head of an auto-merge arming mutation, before its subject. */
const ARM_MUTATION =
  "gh api graphql -f query='mutation{enablePullRequestAutoMerge(";

describe("block-blind-automerge.sh", () => {
  describe("bites on the discriminating case", () => {
    it("refuses to arm a green PR whose reviewDecision is CHANGES_REQUESTED", () => {
      const { bin } = fakeGh({ payload: BLOCKED_PR });

      const { status } = runHook(bash(ARM), { ghBin: bin });

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("allows the identical command once the blocker clears", () => {
      const { bin } = fakeGh({ payload: READY_PR });

      const { status } = runHook(bash(ARM), { ghBin: bin });

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("names the blocker rather than reporting a check failure", () => {
      const { bin } = fakeGh({ payload: BLOCKED_PR });

      const { stderr } = runHook(bash(ARM), { ghBin: bin });

      expect(stderr).toContain("CHANGES_REQUESTED");
      expect(stderr).toContain(BLOCKED_PR.url);
      expect(stderr).toContain("NO check-run representation");
    });

    it("names both routes out of the blocked state", () => {
      const { bin } = fakeGh({ payload: BLOCKED_PR });

      const { stderr } = runHook(bash(ARM), { ghBin: bin });

      expect(stderr).toContain("lisa-pull-request-review");
      expect(stderr).toContain("lisa-drive-pr-to-merge");
    });

    it.each([["APPROVED"], ["REVIEW_REQUIRED"], [""]])(
      "allows arming when reviewDecision is %s",
      decision => {
        const { bin } = fakeGh({
          payload: { ...READY_PR, reviewDecision: decision },
        });

        const { status } = runHook(bash(ARM), { ghBin: bin });

        expect(status).toBe(EXIT_ALLOWED);
      }
    );
  });

  describe("recognizes the arming command in every spelling", () => {
    it.each([
      ["bare", "gh pr merge --auto --merge"],
      ["with a PR number", ARM],
      ["with a URL", "gh pr merge https://github.com/o/r/pull/3720 --auto"],
      ["--auto before the selector", "gh pr merge --auto --merge 3720"],
      ["--repo before the subcommand", "gh --repo o/r pr merge --auto"],
      ["--repo=value before the subcommand", "gh --repo=o/r pr merge --auto"],
      ["--repo after the subcommand", "gh pr merge 3720 --auto -R o/r"],
      ["after a cd", "cd /tmp && gh pr merge 3720 --auto --merge"],
      ["inside a subshell", "(gh pr merge 3720 --auto --merge)"],
      ["via an absolute path", "/opt/homebrew/bin/gh pr merge 3720 --auto"],
      ["wrapped in bash -c", `bash -c '${ARM}'`],
      ["wrapped in sh -c", `sh -c '${ARM}'`],
      ["after an unrelated command", `git push && ${ARM}`],
      ["with a line continuation", "gh pr merge 3720 \\\n  --auto --merge"],
    ])("refuses %s", (_label, command) => {
      const { bin } = fakeGh({ payload: BLOCKED_PR });

      const { status } = runHook(bash(command), { ghBin: bin });

      expect(status).toBe(EXIT_BLOCKED);
    });
  });

  describe("recognizes the GraphQL substrate, not just the porcelain", () => {
    // The lesson CodySwannGT/lisa#3753 records one guard over: a control that
    // sees a single substrate reports safety about all of them. Arming has two
    // shell spellings, and matching only `gh pr merge --auto` would leave the
    // API one — reachable with the same credentials, in the same session —
    // completely unguarded while the guard read as passing.
    const INLINE_ID = `${ARM_MUTATION}input:{pullRequestId:"PR_kwABC"}){clientMutationId}}'`;
    const VARIABLE_ID =
      "gh api graphql -f query='mutation($prId:ID!)" +
      "{enablePullRequestAutoMerge(input:{pullRequestId:$prId})" +
      "{clientMutationId}}' -f prId=PR_kwABC";

    it.each([
      ["an inline node id", INLINE_ID],
      ["a node id passed as a variable", VARIABLE_ID],
    ])("refuses the mutation with %s", (_label, command) => {
      const { bin } = fakeGh({ payload: BLOCKED_PR });

      const { status } = runHook(bash(command), { ghBin: bin });

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("allows the mutation once the blocker clears", () => {
      const { bin } = fakeGh({ payload: READY_PR });

      const { status } = runHook(bash(INLINE_ID), { ghBin: bin });

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("resolves the node id rather than guessing a PR number", () => {
      const { bin, callLog } = fakeGh({ payload: BLOCKED_PR });

      runHook(bash(VARIABLE_ID), { ghBin: bin });

      const calls = readFileSync(callLog, "utf-8");
      expect(calls).toContain("-f id=PR_kwABC");
      expect(calls).toContain("... on PullRequest");
    });

    it("fails CLOSED when the mutation will not say what it arms", () => {
      const { bin } = fakeGh({ payload: READY_PR });
      const unreadable = `${ARM_MUTATION}input:{pullRequestId:$absent}){clientMutationId}}'`;

      const { status, stderr } = runHook(bash(unreadable), { ghBin: bin });

      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain("cannot be read");
    });

    it("refuses an id that is not shaped like a node id", () => {
      // Without the shape check the guard forwards whatever sits after
      // `pullRequestId:` straight to the API, so a malformed mutation reads as
      // a clean PR rather than as one nobody could inspect.
      const { bin } = fakeGh({ payload: READY_PR });
      const malformed = `${
        ARM_MUTATION
      }input:{pullRequestId:"PR kw ABC!"}){clientMutationId}}'`;

      const { status, stderr } = runHook(bash(malformed), { ghBin: bin });

      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain("cannot be read");
    });

    it.each([
      [
        "a disarm",
        "gh api graphql -f query='mutation{disablePullRequestAutoMerge(" +
          'input:{pullRequestId:"PR_kwABC"}){clientMutationId}}\'',
      ],
      [
        "an unrelated mutation",
        "gh api graphql -f query='mutation{resolveReviewThread(" +
          'input:{threadId:"T_kwABC"}){thread{id}}}\'',
      ],
      ["a plain query", "gh api graphql -f query='{viewer{login}}'"],
    ])("allows %s", (_label, command) => {
      const { bin } = fakeGh({ payload: BLOCKED_PR });

      const { status } = runHook(bash(command), { ghBin: bin });

      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("leaves everything that is not an arming alone", () => {
    it.each([
      // A direct merge against a blocked PR fails loudly and immediately, so it
      // is not the invisible failure this guard exists to close.
      ["a direct merge", "gh pr merge 3720 --merge"],
      ["a deliberate admin override", "gh pr merge 3720 --admin --merge"],
      ["a read", "gh pr view 3720 --json state"],
      ["a disarm", "gh pr merge 3720 --disable-auto"],
      ["an unrelated gh call", "gh pr list --state open"],
      // Prose. The command is TOKENIZED, so the arming text is one quoted
      // argument rather than an invocation.
      ["the text inside a commit message", `git commit -m "do not ${ARM}"`],
      ["the text inside an issue body", `gh issue comment 1 --body "${ARM}"`],
      // Heredoc payloads are data. A PR description quoting the command must
      // not be read as running it.
      ["the text inside a heredoc", `cat <<'EOF'\n${ARM}\nEOF`],
    ])("allows %s", (_label, command) => {
      const { bin } = fakeGh({ payload: BLOCKED_PR });

      const { status } = runHook(bash(command), { ghBin: bin });

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("never calls gh for a command that arms nothing", () => {
      const { bin, callLog } = fakeGh({ payload: BLOCKED_PR });

      runHook(bash("gh pr view 3720 --json state"), { ghBin: bin });

      expect(() => readFileSync(callLog, "utf-8")).toThrow();
    });

    it("allows a PR the check rollup already reports red", () => {
      // The boundary case, kept so the scope reads as decided rather than
      // missed. A base with reviews disabled produces a review bot reporting
      // `success` over a skipped review, and two failing review-evidence gates.
      // That PR cannot merge — but the failing-check count is 2, so it is not
      // invisible, which is the whole property that separates it from
      // CHANGES_REQUESTED. Policing it here would re-derive gates that run in
      // CI, on evidence CI already surfaces.
      const { bin } = fakeGh({ payload: REVIEW_SKIPPED_PR });

      const { status } = runHook(bash(ARM), { ghBin: bin });

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("ignores a non-Bash tool payload", () => {
      const { bin } = fakeGh({ payload: BLOCKED_PR });

      const { status } = runHook(
        { tool_name: "Write", tool_input: { file_path: "x", content: ARM } },
        { ghBin: bin }
      );

      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("asks about the PR the command actually names", () => {
    it("forwards the selector and the repository to gh pr view", () => {
      const { bin, callLog } = fakeGh({ payload: BLOCKED_PR });

      runHook(bash("gh pr merge 3720 --auto --merge -R o/r"), { ghBin: bin });

      expect(readFileSync(callLog, "utf-8")).toContain(
        "pr view 3720 --repo o/r --json number,reviewDecision,state,url"
      );
    });

    it("omits the selector when the command relies on the current branch", () => {
      const { bin, callLog } = fakeGh({ payload: BLOCKED_PR });

      runHook(bash("gh pr merge --auto --merge"), { ghBin: bin });

      // Exactly one call: the review refusal fires before the base-coverage
      // question is asked, so a refusal still costs a single round trip.
      expect(readFileSync(callLog, "utf-8").trim()).toBe(
        "pr view --json number,reviewDecision,state,url,baseRefName"
      );
    });

    it("does not mistake an option value for the PR selector", () => {
      const { bin, callLog } = fakeGh({ payload: BLOCKED_PR });

      runHook(bash('gh pr merge --subject "fix 12" --auto 3720'), {
        ghBin: bin,
      });

      expect(readFileSync(callLog, "utf-8")).toContain("pr view 3720 ");
    });
  });

  describe("degrades loudly when it cannot measure", () => {
    it.each([
      ["gh exits non-zero", { exitCode: 1 }],
      ["gh returns unreadable JSON", { rawStdout: "not json" }],
      ["gh returns a non-object", { rawStdout: "[]" }],
    ])("allows the command when %s", (_label, behavior) => {
      const { bin } = fakeGh(behavior);

      const { status, stderr } = runHook(bash(ARM), { ghBin: bin });

      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).toContain(DEGRADED);
    });

    it("allows and announces when gh is not installed", () => {
      const { status, stderr } = runHook(bash(ARM), {
        path: pathWith(TOOLS_WITHOUT_GH),
      });

      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).toContain("gh not found");
      expect(stderr).toContain(DEGRADED);
    });

    it("allows and announces when jq is missing", () => {
      const { status, stderr } = runHook(bash(ARM), {
        path: pathWith(TOOLS_WITHOUT_JQ),
      });

      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).toContain("jq not found");
      expect(stderr).toContain(DEGRADED);
    });
  });
});
