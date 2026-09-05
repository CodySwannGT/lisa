/**
 * Tests for the second vector `block-blind-automerge.sh` closes: a base ref no
 * ruleset covers, where every gate runs and none of them can block.
 *
 * The discriminating case, and the reason a check-shaped suite would prove
 * nothing: the pull request reads IDENTICALLY whether its base carries fifteen
 * required contexts or none. Nothing in `gh pr view` distinguishes them. Only a
 * second question, asked of `repos/{o}/{r}/rules/branches/{ref}`, tells them
 * apart — which is why every case here supplies a fake `gh` that answers the
 * two endpoints separately, and why a test that mocked one payload would pass
 * against the pre-fix guard.
 *
 * Measured on this repository, live: `main` returns fifteen required contexts
 * across two rulesets; `stack/queue-drain-20260904-b` returns `[]`. So does any
 * ordinary feature branch. CodySwannGT/lisa#3922 records a pull request blocked
 * by two failing required checks being re-targeted onto such a ref, both
 * blockers ceasing to apply because they were no longer required, and an
 * already-armed auto-merge firing.
 *
 * The properties pinned, in order of how easily each is lost:
 *
 *   1. Both arms bite. Arming on an uncovered base is refused; re-targeting a
 *      failing pull request onto one is refused. A fix closing only the second
 *      leaves the pull requests already armed, which is how #3922 happened.
 *   2. The CONTROL holds. A covered base is untouched on both arms. A guard
 *      that refused every arming would satisfy arms 1 and 2 and break normal
 *      operation, which is exactly what #3922's fourth scenario exists to catch.
 *   3. Coverage is counted by CONTEXTS, not by rules. A `required_status_checks`
 *      rule with an empty list enforces nothing.
 *   4. The sanctioned workflow survives. A green pull request re-targeted onto
 *      a stack base is announced, not refused — batching is how this repository
 *      drains its queue, and a guard that broke it would be switched off.
 *   5. Inability to measure degrades to ALLOW and says so, on both arms.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ARM,
  bash,
  CHECK_BLOCKED_PR,
  COVERED_PR,
  COVERED_RULES,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  RETARGET,
  routingGh,
  STACK_BASE,
  STACK_BASED_PR,
  UNCOVERED_RULES,
  VACUOUS_RULES,
  runHook,
} from "./support/blind-automerge.js";

/** The marker every degrade-loudly path prints, whatever the cause. */
const DEGRADED = "NOT active";

/** The arming command, aimed at the PR every fixture here describes. */
const ARM_3922 = "gh pr merge 3922 --auto --merge";

/** The head of a mutation, up to the field naming its subject. */
const MUTATION_HEAD =
  "gh api graphql -f query='mutation{updatePullRequest(input:{";

describe("block-blind-automerge.sh — uncovered base", () => {
  describe("refuses to arm where nothing can block the merge", () => {
    it("refuses arming a green PR whose base carries zero required checks", () => {
      const { bin } = routingGh({
        pr: STACK_BASED_PR,
        rules: UNCOVERED_RULES,
      });

      const { status } = runHook(bash(ARM_3922), { ghBin: bin });

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("names the base and the reason rather than reporting a red check", () => {
      const { bin } = routingGh({
        pr: STACK_BASED_PR,
        rules: UNCOVERED_RULES,
      });

      const { stderr } = runHook(bash(ARM_3922), { ghBin: bin });

      expect(stderr).toContain(STACK_BASE);
      expect(stderr).toContain("ZERO required status checks");
      expect(stderr).toContain("It is the checks being unable to say no");
    });

    it("names the deliberate merge as the way through", () => {
      const { bin } = routingGh({
        pr: STACK_BASED_PR,
        rules: UNCOVERED_RULES,
      });

      const { stderr } = runHook(bash(ARM_3922), { ghBin: bin });

      expect(stderr).toContain("gh pr checks 3922");
      expect(stderr).toContain("gh pr merge 3922 --merge");
    });

    it("counts required CONTEXTS, so a rule enforcing nothing is not coverage", () => {
      const { bin } = routingGh({ pr: STACK_BASED_PR, rules: VACUOUS_RULES });

      const { status } = runHook(bash(ARM_3922), { ghBin: bin });

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("asks the rules endpoint about the PR's own base ref", () => {
      const { bin, callLog } = routingGh({
        pr: STACK_BASED_PR,
        rules: UNCOVERED_RULES,
      });

      runHook(bash(ARM_3922), { ghBin: bin });

      expect(readFileSync(callLog, "utf-8")).toContain(
        "api repos/o/r/rules/branches/stack%2Fqueue-drain-20260904-b"
      );
    });

    it("refuses the GraphQL arming substrate on the same base", () => {
      const { bin } = routingGh({
        pr: STACK_BASED_PR,
        rules: UNCOVERED_RULES,
      });
      const command =
        "gh api graphql -f query='mutation{enablePullRequestAutoMerge(" +
        'input:{pullRequestId:"PR_kwABC"}){clientMutationId}}\'';

      const { status } = runHook(bash(command), { ghBin: bin });

      expect(status).toBe(EXIT_BLOCKED);
    });
  });

  describe("refuses to re-target a failing PR out from under its gates", () => {
    it("refuses moving a check-blocked PR onto an uncovered base", () => {
      const { bin } = routingGh({
        pr: CHECK_BLOCKED_PR,
        rules: UNCOVERED_RULES,
      });

      const { status } = runHook(bash(RETARGET), { ghBin: bin });

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("names every failing check, in both rollup shapes", () => {
      const { bin } = routingGh({
        pr: CHECK_BLOCKED_PR,
        rules: UNCOVERED_RULES,
      });

      const { stderr } = runHook(bash(RETARGET), { ghBin: bin });

      // A check-run reports `conclusion`/`name`; a commit status reports
      // `state`/`context`. #3922's two blockers arrived one on each.
      expect(stderr).toContain("🔍 Quality Checks / 🔗 Work-Item Traceability");
      expect(stderr).toContain("🧩 Plugin artifacts match source");
      expect(stderr).not.toContain("🔍 Quality Checks / 🧹 Lint");
    });

    it("says the checks would be neither fixed nor waived", () => {
      const { bin } = routingGh({
        pr: CHECK_BLOCKED_PR,
        rules: UNCOVERED_RULES,
      });

      const { stderr } = runHook(bash(RETARGET), { ghBin: bin });

      expect(stderr).toContain("would not be fixed and would not be waived");
    });

    it.each([
      ["the short flag", `gh pr edit 3922 -B ${STACK_BASE}`],
      ["an inline value", `gh pr edit 3922 --base=${STACK_BASE}`],
      [
        "--repo before the subcommand",
        `gh -R o/r pr edit 3922 -B ${STACK_BASE}`,
      ],
      ["wrapped in bash -c", `bash -c '${RETARGET}'`],
      ["after an unrelated command", `git push && ${RETARGET}`],
      [
        "a title whose value could be read as the selector",
        `gh pr edit --title "fix 12" 3922 --base ${STACK_BASE}`,
      ],
    ])("refuses %s", (_label, command) => {
      const { bin } = routingGh({
        pr: CHECK_BLOCKED_PR,
        rules: UNCOVERED_RULES,
      });

      const { status } = runHook(bash(command), { ghBin: bin });

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses the GraphQL re-target substrate", () => {
      const { bin } = routingGh({
        pr: CHECK_BLOCKED_PR,
        rules: UNCOVERED_RULES,
      });
      const command = `${
        MUTATION_HEAD
      }pullRequestId:"PR_kwABC",baseRefName:"${STACK_BASE}"}){clientMutationId}}'`;

      const { status } = runHook(bash(command), { ghBin: bin });

      expect(status).toBe(EXIT_BLOCKED);
    });
  });

  describe("leaves the sanctioned workflow and the covered case alone", () => {
    it("allows arming on a base the rulesets cover", () => {
      const { bin } = routingGh({ pr: COVERED_PR, rules: COVERED_RULES });

      const { status } = runHook(bash(ARM_3922), { ghBin: bin });

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows re-targeting a failing PR onto a covered base", () => {
      const { bin } = routingGh({
        pr: CHECK_BLOCKED_PR,
        rules: COVERED_RULES,
      });

      const { status } = runHook(bash("gh pr edit 3922 --base main"), {
        ghBin: bin,
      });

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("announces but allows batching a green PR onto a stack base", () => {
      const { bin } = routingGh({
        pr: { ...COVERED_PR, statusCheckRollup: [] },
        rules: UNCOVERED_RULES,
      });

      const { status, stderr } = runHook(bash(RETARGET), { ghBin: bin });

      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).toContain("ZERO");
    });

    it.each([
      ["an edit that changes no base", "gh pr edit 3922 --add-label ready"],
      [
        "a mutation that edits only the title",
        `${
          MUTATION_HEAD
        }pullRequestId:"PR_kwABC",title:"new"}){clientMutationId}}'`,
      ],
      ["a direct merge onto the stack base", "gh pr merge 3922 --merge"],
      ["a deliberate admin override", "gh pr merge 3922 --admin --merge"],
      ["a read", "gh pr view 3922 --json state"],
    ])("allows %s", (_label, command) => {
      const { bin } = routingGh({
        pr: CHECK_BLOCKED_PR,
        rules: UNCOVERED_RULES,
      });

      const { status } = runHook(bash(command), { ghBin: bin });

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("never asks the rules endpoint for a command it does not guard", () => {
      const { bin, callLog } = routingGh({
        pr: CHECK_BLOCKED_PR,
        rules: UNCOVERED_RULES,
      });

      runHook(bash("gh pr edit 3922 --add-label ready"), { ghBin: bin });

      expect(() => readFileSync(callLog, "utf-8")).toThrow();
    });
  });

  describe("degrades loudly when it cannot measure coverage", () => {
    it("allows and announces when the rules endpoint refuses", () => {
      const { bin } = routingGh({
        pr: STACK_BASED_PR,
        rules: UNCOVERED_RULES,
        rulesExitCode: 1,
      });

      const { status, stderr } = runHook(bash(ARM_3922), { ghBin: bin });

      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).toContain(DEGRADED);
    });

    it("allows and announces when the PR payload names no base", () => {
      const { bin } = routingGh({
        pr: { ...STACK_BASED_PR, baseRefName: "" },
        rules: UNCOVERED_RULES,
      });

      const { status, stderr } = runHook(bash(ARM_3922), { ghBin: bin });

      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).toContain(DEGRADED);
    });

    it("allows and announces when no repository can be resolved", () => {
      const { bin } = routingGh({
        pr: { ...STACK_BASED_PR, url: "" },
        rules: UNCOVERED_RULES,
      });

      const { status, stderr } = runHook(bash(ARM), { ghBin: bin });

      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).toContain(DEGRADED);
    });

    it("refuses a re-target whose GraphQL subject cannot be read", () => {
      const { bin } = routingGh({
        pr: CHECK_BLOCKED_PR,
        rules: UNCOVERED_RULES,
      });
      const command = `${
        MUTATION_HEAD
      }pullRequestId:$prId,baseRefName:"${STACK_BASE}"}){clientMutationId}}'`;

      const { status, stderr } = runHook(bash(command), { ghBin: bin });

      // Fails CLOSED, unlike the cases above. Those are the guard unable to
      // run; this is the command refusing to say what it acts on.
      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain("cannot be read");
    });
  });
});
