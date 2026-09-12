/**
 * A PROMOTE through the push-side traceability gate (CodySwannGT/lisa#3873).
 *
 * The merge-only deferral added for #3851 has a regression, and it covers a
 * BACK-merge. The promote — `staging` forward onto the default branch — was
 * untested by that change and by everything before it. The argument that it is
 * already fine is a good one: a promote's non-merge commits survive
 * `parsePushGroups`'s `--not <remote default ref>` exclusion because they live
 * on a deploy-chain branch that is not the default, `commitExemption`
 * classifies them `"protected"`, and both commit-side findings are guarded on
 * `tracedWhereAuthored`. So the deferral never decides a promote; the
 * pre-existing exemption does, one branch earlier.
 *
 * **That argument is exactly what nothing here could check.** This repository's
 * `deploy.branches` declares one environment, so it has no second protected
 * branch and cannot produce the shape at all — the condition under which a
 * claim stays an argument indefinitely (#3696). These cases declare a
 * two-environment chain in the fixture's own committed config and make the
 * shape real.
 *
 * ## Why the deferral is measured as absent rather than argued about
 *
 * On the merge promote both mechanisms are live at once, so a green there
 * cannot say which one produced it. `promotes by fast-forward` is the
 * separation: a fast-forward promote's range holds no merge commit, so
 * `mergeOnlyRange` is false by construction and the deferral is not available
 * to explain anything. Same commits, same config, deferral gone, outcome
 * unchanged — which is the interaction claim rather than the exemption claim.
 *
 * Measured both ways when these cases were written, by hand, against the guard:
 * pinning `deferredToPullRequest` to `false` left all four green — the deferral
 * decides nothing on a promote — and pinning `tracedWhereAuthored` to `false`
 * turned the fast-forward case red while the merge promote stayed green, which
 * is the two mechanisms overlapping exactly where the argument says they do.
 *
 * ## What the control proves, and the one thing it does not
 *
 * A fixture whose every commit classifies as protected would pass against a
 * gate that had stopped refusing anything, so `refuses a pushed commit that is
 * on no deploy-chain branch` adds one untrailered commit to the promote and
 * nothing else. The refusal it asserts on names gate 3 and says the trailer is
 * on a COMMIT rather than in the pull-request body — the gate does NOT print
 * the offending object id, so nothing here claims it does.
 *
 * ## Why the remote is refs rather than a bare repository
 *
 * `remoteDefaultRef` reads the LOCAL `refs/remotes/<remote>/HEAD` symref and
 * never the network, and `deployChainRefs` reads `refs/remotes/<remote>/<name>`
 * the same way. Building those refs directly is the same input a clone would
 * have, without a bare repository and four pushes per case. Skipping them
 * entirely is what must not happen: with no `origin/HEAD` the range loses its
 * `--not <default>` exclusion and the fixture models a different situation
 * while appearing to pass.
 * @module tests/unit/scripts/work-item-push-promote-exemption
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  cleanupTemplates,
  cli,
  commit,
  createFixture,
  Fixture,
  git,
} from "../../support/work-item-cli.js";

/** The non-default deploy-chain branch every promote here comes from. */
const STAGING = "staging";

/** The branch a promote lands on, and the remote's default. */
const MAIN = "main";

/** The subcommand under test, driven as the pre-push hook drives it. */
const SUBCOMMAND = "validate-push";

/** The remote the hook names. */
const REMOTE = "origin";

/** The clause naming the protected-branch exemption as the reason. */
const EXEMPTED = "already on a deploy-chain branch, traced where authored";

/** The refusal a promote must never draw. */
const NO_SUBJECT = "no non-merge commit linked to a work item";

/** The clause the merge deferral renders when it is what carried the push. */
const DEFERRED = "merge commit(s), and nothing else in this range";

/** The gate a missing commit trailer belongs to. */
const COMMIT_GATE = "gate 3 (commit trailer)";

/** The refusal wording for a commit carrying no trailer. */
const NO_TRAILER = "No Work-Item trailer anywhere in the commit message";

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/**
 * A project whose deploy chain declares MORE than one environment.
 *
 * The second environment is the whole premise: with one, there is no protected
 * branch other than the default, every promote's commits are excluded from the
 * range as base history instead of exempted within it, and the shape under test
 * does not exist. `singleEnvironment` below is the same config minus that line.
 * @param environments - The `deploy.branches` map to declare.
 * @returns The config to write as `.lisa.config.json`.
 */
function chainConfig(
  environments: Record<string, string> = {
    production: MAIN,
    staging: STAGING,
  }
): object {
  return {
    deploy: { branches: environments },
    github: { org: "acme", repo: "widgets" },
    tracker: "github",
    workItem: { verify: "trailer" },
  };
}

/**
 * A repository holding a promote's inputs: a remote default branch, a second
 * deploy-chain branch, and two commits authored on it.
 *
 * The staging commits carry no trailer deliberately. They stand for work that
 * was traced on the pull requests that authored it, and asking for a trailer on
 * them has no remedy short of rewriting a protected branch's history — which is
 * the entire reason the exemption exists. A fixture whose staging commits were
 * trailered would go green whether the exemption fired or not.
 * @param config - What to write as `.lisa.config.json`.
 * @returns The fixture, checked out on `main`.
 */
function promoteInputs(config: object = chainConfig()): Fixture {
  const fixture = createFixture(config);
  const { env, root } = fixture;
  const base = git(root, ["rev-parse", MAIN], env);
  git(root, ["update-ref", `refs/remotes/${REMOTE}/${MAIN}`, base], env);
  git(
    root,
    [
      "symbolic-ref",
      `refs/remotes/${REMOTE}/HEAD`,
      `refs/remotes/${REMOTE}/${MAIN}`,
    ],
    env
  );
  git(root, ["switch", "-q", "-c", STAGING, MAIN], env);
  commit(fixture, "fix(auth): signup verification code recovery");
  commit(fixture, "fix(wallet): non-zero response code");
  git(
    root,
    [
      "update-ref",
      `refs/remotes/${REMOTE}/${STAGING}`,
      git(root, ["rev-parse", STAGING], env),
    ],
    env
  );
  git(root, ["switch", "-q", MAIN], env);
  return fixture;
}

/**
 * Land the promote on `main` and hand back the pre-push line it produces.
 *
 * The remote's side of the line is `main` as it stood before the promote, which
 * is what `refs/remotes/origin/main` still points at — so the range is exactly
 * the merge plus the promoted branch's commits, and nothing about the fixture
 * has to assume it.
 * @param fixture - The repository holding the promote's inputs.
 * @param merge - Git arguments that land `staging` on `main`.
 * @returns The one line the pre-push stream carries.
 */
function promote(fixture: Fixture, merge: string[]): string {
  const { env, root } = fixture;
  const remoteOid = git(
    root,
    ["rev-parse", `refs/remotes/${REMOTE}/${MAIN}`],
    env
  );
  git(root, merge, env);
  const localOid = git(root, ["rev-parse", "HEAD"], env);
  return `refs/heads/${MAIN} ${localOid} refs/heads/${MAIN} ${remoteOid}`;
}

/**
 * Drive `validate-push` over one pre-push line, from the captured refs file the
 * hook actually names.
 * @param fixture - The repository to run inside.
 * @param line - The pre-push line to validate.
 * @returns What the run printed and the exit code it set.
 */
function push(fixture: Fixture, line: string) {
  const file = path.join(fixture.root, "pushed-refs");
  writeFileSync(file, `${line}\n`);
  return cli(fixture, [SUBCOMMAND, REMOTE, "--refs", file]);
}

/** Merge arguments for a promote that records a merge commit. */
const MERGE_COMMIT = [
  "merge",
  "-q",
  "--no-ff",
  "-m",
  `Merge ${STAGING} into ${MAIN}`,
  STAGING,
];

/** Merge arguments for a promote that simply advances the branch. */
const FAST_FORWARD = ["merge", "-q", "--ff-only", STAGING];

describe("a promote through the push-side traceability gate", () => {
  it("passes a merge promote, reporting the commits as traced where authored", () => {
    // Names the clause, not the mechanism, and that is deliberate: on a merge
    // promote both the exemption and the deferral are live, they suppress the
    // same finding, and the output does not distinguish them. The case below is
    // what separates them.
    const fixture = promoteInputs();

    const outcome = push(fixture, promote(fixture, MERGE_COMMIT));

    expect(outcome.stdout, outcome.stderr).toContain(`2 ${EXEMPTED}`);
    expect(outcome.stderr).not.toContain(NO_SUBJECT);
    expect(outcome.exitCode).toBeUndefined();
  });

  it("promotes by fast-forward, where the merge deferral cannot fire", () => {
    // No merge commit in the range, so `mergeOnlyRange` is false and the #3851
    // deferral is unavailable. Identical outcome — which is what makes this a
    // measurement of the interaction rather than of the exemption alone.
    const fixture = promoteInputs();

    const outcome = push(fixture, promote(fixture, FAST_FORWARD));

    expect(outcome.stdout, outcome.stderr).toContain(`2 ${EXEMPTED}`);
    expect(outcome.stdout).not.toContain(DEFERRED);
    expect(outcome.stderr).not.toContain(NO_SUBJECT);
    expect(outcome.exitCode).toBeUndefined();
  });

  it("refuses a pushed commit that is on no deploy-chain branch", () => {
    // The rejection control. Without it a fixture whose commits all classify as
    // protected would pass against a gate that had stopped refusing anything.
    const fixture = promoteInputs();
    const line = promote(fixture, MERGE_COMMIT);
    commit(fixture, "chore: reconcile lockfile after promote");
    const tip = git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
    const [localRef, , remoteRef, remoteOid] = line.split(" ");

    const outcome = push(
      fixture,
      `${localRef} ${tip} ${remoteRef} ${remoteOid}`
    );

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(NO_TRAILER);
    expect(outcome.stderr).toContain(COMMIT_GATE);
  });

  it("exempts nothing on a promote the deploy chain does not declare", () => {
    // The A/B against the case above, one config line apart: this repository's
    // own single-environment chain. `staging` is then an ordinary branch, its
    // commits are neither excluded as base history nor exempted as protected,
    // and the promote is refused — which is why the shape cannot be reproduced
    // here and why the fixture above has to declare a second environment.
    const fixture = promoteInputs(chainConfig({ production: MAIN }));

    const outcome = push(fixture, promote(fixture, FAST_FORWARD));

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(NO_TRAILER);
  });
});
