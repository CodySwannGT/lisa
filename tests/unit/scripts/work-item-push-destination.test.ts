/**
 * `validate-push-destination`, driven as the pre-push hook drives it.
 *
 * The hook feeds this subcommand the pre-push stream —
 * `<local ref> <local sha> <remote ref> <remote sha>` per line — and the third
 * field is the destination git ACTUALLY resolved. Under
 * `push.default=upstream` that field can say `refs/heads/main` for a push the
 * operator spelled as their own feature branch (CodySwannGT/lisa#3495), which
 * is the accident these cases pin.
 *
 * Run IN-PROCESS, through the same harness as the rest of this CLI's suites.
 * That is not a style preference: the mutation gate analyses coverage per test,
 * so a case that drives the guard through a subprocess kills nothing — the
 * mutants it exercises are invisible to the analysis and score as uncovered.
 * The `--refs` file the hook already holds is what makes an in-process run
 * possible at all, since stdin cannot be supplied to one.
 *
 * The end-to-end proof that real git produces these lines, and that the guard
 * changes where a real push lands, is
 * `tests/integration/push-destination-inheritance.test.ts`.
 * @module tests/unit/scripts/work-item-push-destination
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  cleanupTemplates,
  cli,
  createFixture,
  git,
  githubConfig,
  type Fixture,
} from "../../support/work-item-cli.js";

/** A 40-zero object id, exactly as Git writes it for an absent side. */
const ZERO = "0".repeat(40);
/** Two real-shaped object ids, so a line is never two copies of one value. */
const LOCAL = "8239f41670750db3979dc8eb1ee5fa7d9cc6364c";
const REMOTE = "2163bd5b6b87fd474ab7cb9c2d2dcf5734a176af";

const FEATURE_REF = "refs/heads/feature/tracked";
const FEATURE = "feature/tracked";
const MAIN_REF = "refs/heads/main";
const DEPLOY = "main";
const SUBCOMMAND = "validate-push-destination";
/** The project config file each fixture writes its deploy map into. */
const CONFIG_FILE = ".lisa.config.json";

/** The refusal's opening words, which the hook surfaces to the operator. */
const BLOCKED = "Push blocked:";
/** The generic banner every OTHER refusal in this script carries. */
const GENERIC_BANNER = "Work-item tracking blocked this operation";
/** The generic guidance every other refusal appends. */
const GENERIC_GUIDANCE = "Mention the ticket this work relates to";

/** The defect's own line: a named branch resolving onto the deploy branch. */
const INHERITED_LINE = `${FEATURE_REF} ${LOCAL} ${MAIN_REF} ${REMOTE}`;

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/**
 * A fixture whose config declares `main` as the one deploy branch.
 * @returns The fixture
 */
function deployFixture(): Fixture {
  const config = {
    ...githubConfig("trailer"),
    deploy: { branches: { production: DEPLOY } },
  };
  const fixture = createFixture(config);
  writeFileSync(
    path.join(fixture.root, CONFIG_FILE),
    `${JSON.stringify(config, null, 2)}\n`
  );
  return fixture;
}

/**
 * Give the fixture a resolvable `refs/remotes/<remote>/HEAD`.
 *
 * That symref is how the guard learns the remote's default branch offline, and
 * a fixture repository has none until something creates it.
 * @param fixture - Repository to set up
 * @param branch - Branch the remote's HEAD should name
 */
function setRemoteDefault(fixture: Fixture, branch: string): void {
  const ref = `refs/remotes/origin/${branch}`;
  git(fixture.root, ["update-ref", ref, "HEAD"], fixture.env);
  git(
    fixture.root,
    ["symbolic-ref", "refs/remotes/origin/HEAD", ref],
    fixture.env
  );
}

/**
 * Run the guard over one pre-push stream, the way the hook runs it.
 * @param fixture - Repository to run inside
 * @param stream - The pre-push lines, without a trailing newline
 * @returns What the run printed and the exit code it set
 */
function guard(fixture: Fixture, stream: string): ReturnType<typeof cli> {
  const refs = path.join(fixture.root, "pushed-refs");
  writeFileSync(refs, stream === "" ? "" : `${stream}\n`);
  return cli(fixture, [SUBCOMMAND, "origin", "--refs", refs]);
}

describe("validate-push-destination", () => {
  it("refuses a named branch that resolved onto a deploy branch", () => {
    const fixture = deployFixture();

    const outcome = guard(fixture, INHERITED_LINE);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(BLOCKED);
    expect(outcome.stderr).toContain(
      `"${FEATURE}" would land on "${DEPLOY}", a deploy branch.`
    );
  });

  it("explains that the destination came from the upstream, not the argument", () => {
    // The whole difficulty of this defect is that the command looks correct.
    // A refusal that did not say where the destination came from would leave
    // the operator staring at a push they spelled properly.
    const fixture = deployFixture();

    const outcome = guard(fixture, INHERITED_LINE);

    expect(outcome.stderr).toContain(
      "Git resolved that destination from the branch's upstream"
    );
    expect(outcome.stderr).toContain("push.default");
    expect(outcome.stderr).toContain("bypassing branch protection");
  });

  it("names the remedy on the branch rather than a way around the hook", () => {
    const fixture = deployFixture();

    const outcome = guard(fixture, INHERITED_LINE);

    expect(outcome.stderr).toContain(`git branch --unset-upstream ${FEATURE}`);
    expect(outcome.stderr).toContain("git config --local push.default simple");
    expect(outcome.stderr).toContain(
      `git push origin ${FEATURE}:refs/heads/${FEATURE}`
    );
    expect(outcome.stderr).toContain(
      `If you genuinely mean to push to "${DEPLOY}"`
    );
    // Never the bypass. A guard that suggests --no-verify teaches that the
    // bypass is negotiable, which is the failure mode this family exists to
    // avoid.
    expect(outcome.stderr).not.toContain("--no-verify");
  });

  it("reports the refusal on its own terms, without the work-item framing", () => {
    // Every other refusal in this script IS about work-item tracking, so the
    // generic banner and its "mention the ticket" guidance are right for them.
    // Here they would point the operator away from the one thing that matters
    // while their push is landing on a deploy branch.
    const fixture = deployFixture();

    const outcome = guard(fixture, INHERITED_LINE);

    expect(outcome.stderr).not.toContain(GENERIC_BANNER);
    expect(outcome.stderr).not.toContain(GENERIC_GUIDANCE);
  });

  it("keeps the work-item framing on refusals that ARE about a work item", () => {
    // The control for the case above: the flag is set where the refusal is
    // raised, so an unrelated refusal must be unaffected by it.
    const fixture = deployFixture();

    const outcome = cli(fixture, ["not-a-real-subcommand"]);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(GENERIC_BANNER);
    expect(outcome.stderr).toContain(GENERIC_GUIDANCE);
  });

  it("is reachable only under its own subcommand name", () => {
    // A dispatch entry matching anything, or nothing, would leave the guard
    // either firing on unrelated commands or unreachable altogether.
    const fixture = deployFixture();
    const refs = path.join(fixture.root, "pushed-refs");
    writeFileSync(refs, `${INHERITED_LINE}\n`);

    const outcome = cli(fixture, [`${SUBCOMMAND}X`, "origin", "--refs", refs]);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("Usage: lisa-work-item.mjs");
    expect(outcome.stderr).not.toContain(BLOCKED);
  });

  it.each([
    [
      "a deploy-branch push from the deploy branch",
      `${MAIN_REF} ${LOCAL} ${MAIN_REF} ${REMOTE}`,
    ],
    [
      "an ordinary feature-branch push",
      `${FEATURE_REF} ${LOCAL} ${FEATURE_REF} ${ZERO}`,
    ],
    [
      "a destination the pusher spelled out, whose local ref is HEAD",
      `HEAD ${LOCAL} ${MAIN_REF} ${REMOTE}`,
    ],
    [
      "a deletion, whose local sha is zeroed",
      `(delete) ${ZERO} ${MAIN_REF} ${REMOTE}`,
    ],
    ["a tag push", `refs/tags/v1 ${LOCAL} refs/tags/v1 ${ZERO}`],
    [
      "a branch whose name merely contains the deploy branch's",
      `${FEATURE_REF} ${LOCAL} refs/heads/mainline ${ZERO}`,
    ],
  ])("allows %s", (_label, line) => {
    const fixture = deployFixture();

    const outcome = guard(fixture, line);

    expect(outcome.exitCode).toBeUndefined();
    expect(outcome.stderr).not.toContain(BLOCKED);
  });

  it("allows an empty stream rather than guessing at a destination", () => {
    const fixture = deployFixture();

    const outcome = guard(fixture, "");

    expect(outcome.exitCode).toBeUndefined();
  });

  it("refuses on the offending line even when safe lines share the push", () => {
    const fixture = deployFixture();

    const outcome = guard(
      fixture,
      `${FEATURE_REF} ${LOCAL} ${FEATURE_REF} ${ZERO}\nrefs/heads/other ${LOCAL} ${MAIN_REF} ${REMOTE}`
    );

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(`"other" would land on "${DEPLOY}"`);
  });

  it("protects every branch the deploy map names, not only the default one", () => {
    const config = {
      ...githubConfig("trailer"),
      deploy: { branches: { production: DEPLOY, staging: "release/stg" } },
    };
    const fixture = createFixture(config);
    writeFileSync(
      path.join(fixture.root, CONFIG_FILE),
      `${JSON.stringify(config, null, 2)}\n`
    );

    const outcome = guard(
      fixture,
      `${FEATURE_REF} ${LOCAL} refs/heads/release/stg ${REMOTE}`
    );

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(
      `"${FEATURE}" would land on "release/stg"`
    );
  });

  it("still protects the remote default branch when no deploy map is configured", () => {
    // A project that declares no deploy map still has exactly one branch that
    // releases, so the remote's own default is protected on its own.
    const fixture = createFixture(githubConfig("trailer"));
    writeFileSync(
      path.join(fixture.root, CONFIG_FILE),
      `${JSON.stringify(githubConfig("trailer"), null, 2)}\n`
    );
    setRemoteDefault(fixture, DEPLOY);

    const outcome = guard(fixture, INHERITED_LINE);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain(`would land on "${DEPLOY}"`);
  });

  it("stands down when neither a deploy map nor a remote default resolves", () => {
    // Recorded rather than asserted-around: with nothing naming a protected
    // branch, this guard has no opinion and must not invent one. It is a real
    // gap in a checkout that has never resolved `origin/HEAD`, and it is why
    // the guard is one of three layers rather than the only one — the config
    // normalization and the branch-creation flow do not depend on it.
    const fixture = createFixture(githubConfig("trailer"));
    writeFileSync(
      path.join(fixture.root, CONFIG_FILE),
      `${JSON.stringify(githubConfig("trailer"), null, 2)}\n`
    );

    const outcome = guard(fixture, INHERITED_LINE);

    expect(outcome.exitCode).toBeUndefined();
  });
});
