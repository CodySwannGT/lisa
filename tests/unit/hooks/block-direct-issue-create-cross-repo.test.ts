/**
 * Cross-repository filing tests for block-direct-issue-create.sh.
 *
 * The guard demands a build-ready role before it lets a tracker creation
 * through. It used to resolve that role from the CALLING project's config no
 * matter which repository the create was addressed at — so a project filing an
 * upstream defect was asked for a token the target repository does not carry.
 *
 * On a JIRA or Linear caller there was no satisfiable answer at all: the guard
 * demanded a workflow STATE as the value of a `gh --label`, which is not a
 * label the target repo has, so obeying the guard made the command fail. The
 * only way through was the `[lisa-human-gate]` marker, which stamps a
 * build-ready defect report as held for a human product call — filed, and never
 * picked up. That is the incomplete handoff the guard exists to prevent,
 * committed one repository over.
 *
 * These tests pin which repository's vocabulary answers the question. The
 * property itself is unchanged: a creation with no declaration is still
 * refused, wherever it is addressed.
 */
import { describe, expect, it } from "vitest";

import {
  bash,
  CUSTOM_ROLE,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  projectWithTracker,
  runHook,
} from "./support/direct-issue-create.js";

/** The calling project's own repository. */
const OWN_REPO = "own-org/own-repo";
/** The repository upstream defects are filed at. */
const UPSTREAM_REPO = "up-org/up-repo";
/** The local filing flow, which cannot address another repository. */
const LOCAL_FLOW = "/lisa:track";
/** The ready role the upstream repository runs its build queue off. */
const UPSTREAM_ROLE = "status:ready";

/** A GitHub-tracked caller that renamed its ready lane. */
const GITHUB_CALLER: Record<string, unknown> = {
  tracker: "github",
  github: {
    org: "own-org",
    repo: "own-repo",
    labels: { build: { ready: CUSTOM_ROLE } },
  },
  hardening: { upstreamRepo: UPSTREAM_REPO },
};

/** A JIRA-tracked caller, whose ready role is a workflow state. */
const JIRA_STATE = "Ready for Development";
const JIRA_CALLER: Record<string, unknown> = {
  tracker: "jira",
  jira: { workflow: { ready: JIRA_STATE } },
  hardening: { upstreamRepo: UPSTREAM_REPO },
};

describe("block-direct-issue-create.sh cross-repository filing", () => {
  it("permits an upstream filing carrying the upstream repo's ready role", () => {
    const { status, stderr } = runHook(
      bash(
        `gh issue create --repo ${UPSTREAM_REPO} --title "x" --label "${UPSTREAM_ROLE}"`
      ),
      { cwd: projectWithTracker(GITHUB_CALLER) }
    );
    expect(stderr).not.toContain("BLOCKED");
    expect(status).toBe(EXIT_ALLOWED);
  });

  it("honours a configured upstream ready role over the default", () => {
    const cwd = projectWithTracker({
      ...GITHUB_CALLER,
      hardening: {
        upstreamRepo: UPSTREAM_REPO,
        upstreamReadyRole: "queue:open",
      },
    });
    expect(
      runHook(
        bash(
          `gh issue create --repo ${UPSTREAM_REPO} --title "x" --label "queue:open"`
        ),
        { cwd }
      ).status
    ).toBe(EXIT_ALLOWED);
    expect(
      runHook(
        bash(
          `gh issue create --repo ${UPSTREAM_REPO} --title "x" --label "${UPSTREAM_ROLE}"`
        ),
        { cwd }
      ).status
    ).toBe(EXIT_BLOCKED);
  });

  it("never demands a JIRA workflow state of a GitHub repository", () => {
    const cwd = projectWithTracker(JIRA_CALLER);
    expect(
      runHook(
        bash(
          `gh issue create --repo ${UPSTREAM_REPO} --title "x" --label "${UPSTREAM_ROLE}"`
        ),
        { cwd }
      ).status
    ).toBe(EXIT_ALLOWED);
    const { stderr } = runHook(
      bash(`gh issue create --repo ${UPSTREAM_REPO} --title "x"`),
      { cwd }
    );
    expect(stderr).not.toContain(JIRA_STATE);
  });

  it("still refuses an undeclared cross-repository creation", () => {
    expect(
      runHook(bash(`gh issue create --repo ${UPSTREAM_REPO} --title "x"`), {
        cwd: projectWithTracker(GITHUB_CALLER),
      }).status
    ).toBe(EXIT_BLOCKED);
  });

  it("leaves a same-repository filing judged by the project's own role", () => {
    const cwd = projectWithTracker(GITHUB_CALLER);
    expect(
      runHook(
        bash(
          `gh issue create --repo ${OWN_REPO} --title "x" --label "${CUSTOM_ROLE}"`
        ),
        { cwd }
      ).status
    ).toBe(EXIT_ALLOWED);
    // The upstream repo's role does not answer for the project's own repo.
    expect(
      runHook(
        bash(
          `gh issue create --repo ${OWN_REPO} --title "x" --label "${UPSTREAM_ROLE}"`
        ),
        { cwd }
      ).status
    ).toBe(EXIT_BLOCKED);
    const { stderr } = runHook(bash('gh issue create --title "x"'), { cwd });
    expect(stderr).toContain(CUSTOM_ROLE);
    expect(stderr).toContain(LOCAL_FLOW);
  });

  it("points a refused cross-repo filing at a route that reaches the target", () => {
    const { stderr } = runHook(
      bash(`gh issue create --repo ${UPSTREAM_REPO} --title "x"`),
      { cwd: projectWithTracker(GITHUB_CALLER) }
    );
    expect(stderr).toContain(UPSTREAM_REPO);
    expect(stderr).toContain(UPSTREAM_ROLE);
    expect(stderr).toContain("file-upstream");
    // `/lisa:track` writes to the caller's own tracker and cannot reach the
    // target, so recommending it is the remediation pointing away from the fix.
    expect(stderr).not.toContain(LOCAL_FLOW);
    expect(stderr).not.toContain(CUSTOM_ROLE);
  });

  it("reads the target out of a REST endpoint as well as a --repo flag", () => {
    const { status, stderr } = runHook(
      bash(`gh api repos/${UPSTREAM_REPO}/issues -f title=x`),
      { cwd: projectWithTracker(GITHUB_CALLER) }
    );
    expect(status).toBe(EXIT_BLOCKED);
    expect(stderr).toContain(UPSTREAM_ROLE);
    expect(stderr).not.toContain(CUSTOM_ROLE);
  });

  it.each([
    ["-R short flag", `-R ${UPSTREAM_REPO}`],
    ["--repo= inline value", `--repo=${UPSTREAM_REPO}`],
    ["a full repository URL", `--repo https://github.com/${UPSTREAM_REPO}`],
  ])("resolves the target from %s", (_label, target) => {
    expect(
      runHook(
        bash(
          `gh issue create ${target} --title "x" --label "${UPSTREAM_ROLE}"`
        ),
        { cwd: projectWithTracker(GITHUB_CALLER) }
      ).status
    ).toBe(EXIT_ALLOWED);
  });

  it("accepts either role, and claims nothing, when the caller declares no repo", () => {
    // A GitHub-tracked project with no `github.org`/`github.repo` cannot be
    // compared against a target, so the guard cannot know this is cross-repo.
    // Both roles are accepted, and the refusal must NOT claim another
    // repository or name a token that does not work — naming a role the caller
    // cannot satisfy is the defect this issue is about, one branch over.
    const cwd = projectWithTracker({
      tracker: "github",
      github: { labels: { build: { ready: CUSTOM_ROLE } } },
      hardening: { upstreamRepo: UPSTREAM_REPO },
    });
    for (const role of [CUSTOM_ROLE, UPSTREAM_ROLE]) {
      expect(
        runHook(
          bash(
            `gh issue create --repo ${UPSTREAM_REPO} --title "x" --label "${role}"`
          ),
          { cwd }
        ).status
      ).toBe(EXIT_ALLOWED);
    }
    const { stderr } = runHook(
      bash(`gh issue create --repo ${UPSTREAM_REPO} --title "x"`),
      { cwd }
    );
    expect(stderr).not.toContain("ANOTHER REPOSITORY");
    expect(stderr).toContain(CUSTOM_ROLE);
  });

  // The shape two consumer sessions hit in production, on two different
  // trackers, each unable to file an upstream defect at all. Reproduced here
  // with the DEFAULT upstream repo and no `hardening` block, because that is
  // what a consumer actually has — a fixture that configures the upstream repo
  // explicitly would pass while the real case stayed broken.
  describe("the reported consumer reproduction", () => {
    const LINEAR_CONSUMER: Record<string, unknown> = {
      tracker: "linear",
      linear: { workflow: { ready: "Ready" } },
    };
    const UPSTREAM = "CodySwannGT/lisa";

    it("refuses an undeclared upstream filing", () => {
      expect(
        runHook(bash(`gh issue create --repo ${UPSTREAM} --title "x"`), {
          cwd: projectWithTracker(LINEAR_CONSUMER),
        }).status
      ).toBe(EXIT_BLOCKED);
    });

    it("permits the target's own role — the step that used to fail", () => {
      // The caller passes exactly the label the target repository uses, which
      // is what the guard's own remedy text instructs. Before the fix this was
      // still refused, because it was compared against the Linear workflow
      // state `Ready` resolved from the CALLING project. An instruction that
      // does not work when followed is worse than no instruction.
      const { status, stderr } = runHook(
        bash(
          `gh issue create --repo ${UPSTREAM} --title "x" --label "status:ready"`
        ),
        { cwd: projectWithTracker(LINEAR_CONSUMER) }
      );
      expect(stderr).not.toContain("BLOCKED");
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("does not accept the caller's Linear state against a GitHub target", () => {
      // The reporter declined to pass this precisely because it would satisfy
      // the guard while filing into a lane the target's build-intake never
      // scans — causing the exact harm the guard exists to prevent, by
      // complying with it. It must not become the path of least resistance.
      expect(
        runHook(
          bash(
            `gh issue create --repo ${UPSTREAM} --title "x" --label "Ready"`
          ),
          { cwd: projectWithTracker(LINEAR_CONSUMER) }
        ).status
      ).toBe(EXIT_BLOCKED);
    });

    it("names the target and a role that works, in the operator's spelling", () => {
      const { stderr } = runHook(
        bash(`gh issue create --repo ${UPSTREAM} --title "x"`),
        { cwd: projectWithTracker(LINEAR_CONSUMER) }
      );
      // As typed, not case-folded — a lowercased slug reads as another repo.
      expect(stderr).toContain(UPSTREAM);
      expect(stderr).toContain("status:ready");
      expect(stderr).not.toContain("Ready\n");
      // The operator must not be told to reach for the human override, nor
      // sent to a local flow that cannot address another repository.
      expect(stderr).not.toContain(LOCAL_FLOW);
    });
  });

  it("ignores a target named past a bare -- , where it cannot reach the item", () => {
    const { status, stderr } = runHook(
      bash(`gh issue create --title "x" -- --repo ${UPSTREAM_REPO}`),
      { cwd: projectWithTracker(GITHUB_CALLER) }
    );
    expect(status).toBe(EXIT_BLOCKED);
    expect(stderr).toContain(CUSTOM_ROLE);
  });
});
