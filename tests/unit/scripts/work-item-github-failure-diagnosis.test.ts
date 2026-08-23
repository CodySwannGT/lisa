/**
 * The work-item guardrail must name the fault it actually hit.
 *
 * Its GitHub path shells out to `gh` and treated any non-zero exit as one
 * thing: "does not exist or is inaccessible". Three failures reach that line
 * and they send the reader to three different places — a missing binary is an
 * environment to provision, a refused credential is an access grant to obtain,
 * and only the third has anything to do with the ticket.
 *
 * The collapse cost a real round trip. On Claude Code web, where `gh` is not
 * pre-installed, every commit was refused with "GitHub issue #2202 does not
 * exist or is inaccessible" — about an issue that was open and correct. The
 * message accused the ticket, so that is where the reader went, and the run
 * ended in a `--no-verify` bypass instead.
 *
 * This file could not have existed before the module grew a main guard. The
 * script ran on import, so importing it executed the CLI, and the only way to
 * reach any branch was to spawn a process and drive it through the filesystem
 * and PATH. A branch with no way to be asserted on is how the bug shipped.
 * @module tests/unit/scripts/work-item-github-failure-diagnosis
 */
import { describe, expect, it } from "vitest";

import { githubFailureReason } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** A reference whose shape is valid, so only the `gh` outcome varies. */
const REF = "CodySwannGT/lisa#2202";

/** The noun the guardrail uses for a GitHub work item. */
const NOUN = "GitHub issue";

/** Verbatim from the Claude Code web container that hit this. */
const PROXY_REFUSAL =
  '{"message":"GitHub access is not enabled for this session. An org admin must connect the Claude GitHub App for this organization."}';

describe("work-item guardrail: which GitHub failure happened", () => {
  it("names a missing gh as an environment gap, not a bad ticket", () => {
    const reason = githubFailureReason(
      {
        status: null,
        error: Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }),
      },
      REF,
      NOUN
    );

    expect(reason).toMatch(/gh\) is not installed/i);
    expect(reason).toMatch(/not a problem with the work item/i);
    expect(reason).not.toMatch(/does not exist or is inaccessible/i);
    // The remedy, since the reader cannot be expected to know that a cloud
    // container ships without it.
    expect(reason).toMatch(/remoteEnv\.tools\.install/);
  });

  it("names a refused credential as a credential gap, and quotes the refusal", () => {
    const reason = githubFailureReason(
      { status: 1, stderr: PROXY_REFUSAL },
      REF,
      NOUN
    );

    expect(reason).toMatch(/cannot authenticate/i);
    expect(reason).toMatch(/not a problem with the work item/i);
    // Quoted verbatim, because the remedy is in the refusal and nowhere else:
    // no status code implies "an org admin must connect the GitHub App".
    expect(reason).toMatch(/org admin must connect the Claude GitHub App/);
  });

  it("treats an unauthenticated CLI as the same class of problem", () => {
    const reason = githubFailureReason(
      { status: 1, stderr: "gh auth login required" },
      REF,
      NOUN
    );

    expect(reason).toMatch(/cannot authenticate/i);
  });

  it("still says the issue is inaccessible when that is what happened", () => {
    // The original message is right for the original case, and losing it would
    // trade one misdiagnosis for another.
    const reason = githubFailureReason(
      { status: 1, stderr: "GraphQL: Could not resolve to an Issue" },
      REF,
      NOUN
    );

    expect(reason).toBe(`${NOUN} ${REF} does not exist or is inaccessible`);
  });

  it("does not mistake an empty stderr for an auth failure", () => {
    // A generic non-zero exit carries no evidence either way, and guessing
    // "credential" there would resurrect the original bug pointing elsewhere.
    const reason = githubFailureReason({ status: 1 }, REF, NOUN);

    expect(reason).toBe(`${NOUN} ${REF} does not exist or is inaccessible`);
  });
});

describe("the guardrail actually runs from both entrypoints", () => {
  // The dangerous failure here is not a crash, it is exit 0 with no output: the
  // hooks would report success while validating nothing, and nobody would know
  // until an unbound commit reached main. Adding a main guard introduced exactly
  // that for Lisa's own checkout, because its entrypoint re-exports the
  // implementation, so `import.meta.url` and `argv[1]` name different files and
  // the check could never fire.
  const entrypoints = [
    ["Lisa's re-exporting entrypoint", "scripts/lisa-work-item.mjs"],
    [
      "a host project's direct copy",
      "all/copy-overwrite/scripts/lisa-work-item.mjs",
    ],
  ] as const;

  it.each(entrypoints)("runs the CLI via %s", (_label, entry) => {
    // An unrecognised subcommand, because the only property under test is
    // whether `main()` ran at all. The first version asked for a refusal
    // about an unbound worktree, which is a fact about the machine rather
    // than about the entrypoint: any worktree with a work item bound — the
    // normal state during a task — exits 0 with empty stderr, and the test
    // failed on main within the hour.
    const result = boundedSpawnSync({
      args: [entry, "not-a-real-command"],
      command: process.execPath,
      label: "lisa-work-item.mjs not-a-real-command",
    });

    expect(result.stderr).toMatch(/Work-item tracking blocked this operation/);
    expect(result.stderr).toMatch(/Usage: lisa-work-item\.mjs/);
    expect(result.status).not.toBe(0);
  });
});
