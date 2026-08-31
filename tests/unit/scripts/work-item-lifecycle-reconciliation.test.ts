/**
 * Lifecycle-role reconciliation at GitHub completion.
 *
 * ## The defect
 *
 * GitHub Issues has no lifecycle beyond open and closed, so Lisa synthesises one
 * in labels. A synthesised state is a state something has to reconcile, and the
 * completion writer added the terminal role while removing exactly ONE competing
 * role — the claimed one. Every other lifecycle role the item carried survived
 * the close.
 *
 * Measured on a live tracker before this suite existed: 34 closed issues still
 * carried an active lifecycle role, six of them carrying the ready role AND the
 * terminal role simultaneously. That pair is not cosmetic. A closed item still
 * reading as ready is picked up by the build queue scan, which reads the label
 * rather than the closed state, so an already-shipped fix was independently
 * rebuilt end to end by a second agent; the push-time traceability gate caught
 * it only after the work was finished.
 *
 * ## Why the readback is the load-bearing assertion
 *
 * The cheap version of this fix computes the right set of labels and reports
 * success on the strength of having sent the request. That is the same class of
 * defect as the original: a claim about tracker state that was never checked
 * against the tracker. The cases below stage a SECOND, divergent answer for the
 * post-write read, which a writer echoing its own request cannot fail.
 * @module tests/unit/scripts/work-item-lifecycle-reconciliation
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  cleanupTemplates,
  cli,
  createFixture,
  githubConfig,
  issueJson,
  offlineFixture,
  Fixture,
  REF,
} from "../../support/work-item-cli.js";

const REF_FLAG = "--ref";
const READY = "status:ready";
const CLAIMED = "status:in-progress";
const BLOCKED = "status:blocked";
const ON_DEV = "status:on-dev";
const ON_STG = "status:on-stg";
const TERMINAL = "status:done";
const UNRELATED = [
  "type:Bug",
  "component:plugins",
  "priority:high",
  "points:2",
];

/** A project that named its lanes something other than Lisa's defaults. */
const LANE = {
  BLOCKED: "lane/parked",
  CLAIMED: "lane/building",
  ON_STG: "lane/on-stg",
  READY: "lane/queued",
  TERMINAL: "lane/shipped",
};

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/** A timeline carrying the merged pull request completion requires as evidence. */
const MERGED_TIMELINE = JSON.stringify([
  {
    event: "cross-referenced",
    source: {
      issue: {
        number: 7,
        pull_request: { merged_at: "2026-01-01T00:00:00Z" },
        repository_url: "https://api.github.com/repos/acme/widgets",
      },
    },
  },
]);

/**
 * An issue payload carrying the named labels.
 * @param names - Label names the issue carries.
 * @param overrides - Any other fields to set on the payload.
 * @returns The payload as JSON text.
 */
function withLabels(
  names: string[],
  overrides: Record<string, unknown> = {}
): string {
  return issueJson({ labels: names.map(name => ({ name })), ...overrides });
}

/** The staged answers for the before-read and the post-write readback. */
interface Reads {
  after: string;
  before: string;
}

/**
 * Run completion against staged before/after tracker reads.
 * @param fixture - The repository to run inside.
 * @param reads - What the tracker reports before the write and after it.
 * @returns The run outcome plus the fake `gh` invocation log.
 */
function complete(
  fixture: Fixture,
  reads: Reads
): { invocations: string; stderr: string; exitCode: number | undefined } {
  const log = path.join(fixture.root, "gh.log");
  const result = cli(fixture, ["complete", REF_FLAG, REF], {
    FAKE_GH_ISSUE_COUNT_FILE: path.join(fixture.root, "gh-issue.count"),
    FAKE_GH_ISSUE_JSON_1: reads.before,
    FAKE_GH_ISSUE_JSON_2: reads.after,
    FAKE_GH_LOG: log,
    FAKE_GH_TIMELINE_JSON: MERGED_TIMELINE,
  });
  return {
    exitCode: result.exitCode,
    invocations: readFileSync(log, "utf8"),
    stderr: result.stderr,
  };
}

/** The tracker state a correct reconciliation produces. */
const RECONCILED = withLabels([TERMINAL, ...UNRELATED], {
  state: "CLOSED",
  stateReason: "COMPLETED",
});

describe("GitHub completion: competing lifecycle roles", () => {
  it("removes EVERY competing lifecycle role, not just the claimed one", () => {
    // The reported shape: an item that accumulated roles on its way through the
    // lifecycle and would otherwise close carrying all of them.
    const run = complete(offlineFixture(), {
      after: RECONCILED,
      before: withLabels([READY, CLAIMED, BLOCKED, ON_DEV, ...UNRELATED]),
    });

    expect(run.exitCode).toBeUndefined();
    for (const role of [READY, CLAIMED, BLOCKED, ON_DEV])
      expect(run.invocations).toContain(`--remove-label ${role}`);
    expect(run.invocations).toContain(`--add-label ${TERMINAL}`);
  });

  it("removes a stale ready role on an item that was never claimed", () => {
    // The skipped-stage case. An item can reach completion without passing
    // through the claimed lane at all, and a writer that only knows how to
    // retire the claimed role leaves the ready role behind — which is exactly
    // what puts a closed item back in front of the build queue scan.
    const run = complete(offlineFixture(), {
      after: RECONCILED,
      before: withLabels([READY, ...UNRELATED]),
    });

    expect(run.exitCode).toBeUndefined();
    expect(run.invocations).toContain(`--remove-label ${READY}`);
    expect(run.invocations).not.toContain(`--remove-label ${CLAIMED}`);
  });

  it("removes an intermediate environment role superseded by the terminal", () => {
    const run = complete(offlineFixture(), {
      after: RECONCILED,
      before: withLabels([ON_DEV, ON_STG, ...UNRELATED]),
    });

    expect(run.exitCode).toBeUndefined();
    expect(run.invocations).toContain(`--remove-label ${ON_DEV}`);
    expect(run.invocations).toContain(`--remove-label ${ON_STG}`);
  });

  it("preserves type, component, priority and provenance labels", () => {
    const run = complete(offlineFixture(), {
      after: RECONCILED,
      before: withLabels([READY, BLOCKED, ...UNRELATED, "self-hardening"]),
    });

    expect(run.exitCode).toBeUndefined();
    for (const label of [...UNRELATED, "self-hardening"])
      expect(run.invocations).not.toContain(`--remove-label ${label}`);
  });

  it("never asks to remove a lifecycle role the item does not carry", () => {
    // Removing an absent label is a 404 from the GitHub API, so a writer that
    // blindly names every configured role turns a clean completion into a
    // failure the operator has to interpret.
    const run = complete(offlineFixture(), {
      after: RECONCILED,
      before: withLabels([BLOCKED, ...UNRELATED]),
    });

    expect(run.exitCode).toBeUndefined();
    expect(run.invocations).toContain(`--remove-label ${BLOCKED}`);
    for (const absent of [READY, CLAIMED, ON_DEV, ON_STG])
      expect(run.invocations).not.toContain(`--remove-label ${absent}`);
  });

  it("does not remove the terminal role it is applying", () => {
    // The terminal role is a member of the configured lifecycle set, so a naive
    // "remove every lifecycle role" would retire the very label being added.
    const run = complete(offlineFixture(), {
      after: RECONCILED,
      before: withLabels([CLAIMED, ...UNRELATED]),
    });

    expect(run.exitCode).toBeUndefined();
    expect(run.invocations).not.toContain(`--remove-label ${TERMINAL}`);
  });
});

describe("GitHub completion: configured role set", () => {
  it("reconciles against the CONFIGURED roles rather than built-in names", () => {
    // The role set is resolved from configuration on purpose: a project that
    // names its lanes differently must have its own lanes reconciled, and a
    // writer carrying Lisa's spellings would silently reconcile nothing there.
    const fixture = createFixture({
      ...githubConfig("trailer"),
      github: {
        labels: {
          build: {
            blocked: LANE.BLOCKED,
            claimed: LANE.CLAIMED,
            done: { production: LANE.TERMINAL, staging: LANE.ON_STG },
            ready: LANE.READY,
          },
        },
        org: "acme",
        repo: "widgets",
      },
    });
    const run = complete(fixture, {
      after: withLabels([LANE.TERMINAL, ...UNRELATED], {
        state: "CLOSED",
        stateReason: "COMPLETED",
      }),
      before: withLabels([LANE.READY, LANE.BLOCKED, LANE.ON_STG, ...UNRELATED]),
    });

    expect(run.exitCode).toBeUndefined();
    expect(run.invocations).toContain(`--add-label ${LANE.TERMINAL}`);
    for (const role of [LANE.READY, LANE.BLOCKED, LANE.ON_STG])
      expect(run.invocations).toContain(`--remove-label ${role}`);
    expect(run.invocations).not.toContain(`--remove-label ${READY}`);
  });
});

describe("GitHub completion: independent readback", () => {
  it("refuses when the tracker still reports a competing role afterwards", () => {
    // The whole point of re-reading. The write was accepted; the state it was
    // supposed to produce is not the state the tracker holds.
    const run = complete(offlineFixture(), {
      after: withLabels([TERMINAL, BLOCKED, ...UNRELATED], {
        state: "CLOSED",
        stateReason: "COMPLETED",
      }),
      before: withLabels([BLOCKED, ...UNRELATED]),
    });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(BLOCKED);
  });

  it("refuses when the tracker still reports the item open afterwards", () => {
    const run = complete(offlineFixture(), {
      after: withLabels([TERMINAL, ...UNRELATED], { state: "OPEN" }),
      before: withLabels([CLAIMED, ...UNRELATED]),
    });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("did not read back");
  });

  it("refuses when the terminal role is missing from the readback", () => {
    const run = complete(offlineFixture(), {
      after: withLabels([...UNRELATED], {
        state: "CLOSED",
        stateReason: "COMPLETED",
      }),
      before: withLabels([CLAIMED, ...UNRELATED]),
    });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(TERMINAL);
  });
});

describe("GitHub completion: close reason", () => {
  it("refuses to stamp a terminal role on an item closed as not planned", () => {
    // A not-planned closure is a deliberate human decision that the item will
    // NOT be done. Completion evidence and a not-planned closure disagree about
    // what happened, and the writer is not the thing that gets to settle that.
    const run = complete(offlineFixture(), {
      after: RECONCILED,
      before: withLabels([READY, ...UNRELATED], {
        state: "CLOSED",
        stateReason: "NOT_PLANNED",
      }),
    });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("not planned");
    expect(run.invocations).not.toContain(`--add-label ${TERMINAL}`);
  });

  it("still reconciles an item already closed as completed", () => {
    // Re-running after a close that left roles behind is the repair path, so it
    // must not be refused the way a not-planned closure is.
    const run = complete(offlineFixture(), {
      after: RECONCILED,
      before: withLabels([READY, TERMINAL, ...UNRELATED], {
        state: "CLOSED",
        stateReason: "COMPLETED",
      }),
    });

    expect(run.exitCode).toBeUndefined();
    expect(run.invocations).toContain(`--remove-label ${READY}`);
  });
});

describe("GitHub completion: idempotency", () => {
  it("is a no-op write when the item is already reconciled and closed", () => {
    const run = complete(offlineFixture(), {
      after: RECONCILED,
      before: RECONCILED,
    });

    expect(run.exitCode).toBeUndefined();
    expect(run.invocations).not.toContain("issue edit");
    expect(run.invocations).not.toContain("issue close");
  });

  it("closes an open item that already carries the terminal role", () => {
    const run = complete(offlineFixture(), {
      after: RECONCILED,
      before: withLabels([TERMINAL, ...UNRELATED]),
    });

    expect(run.exitCode).toBeUndefined();
    expect(run.invocations).toContain("issue close");
    expect(run.invocations).not.toContain(`--add-label ${TERMINAL}`);
  });
});
