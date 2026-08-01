/**
 * Preservation of a foreign verdict by the enforce-verification-gate.sh Stop hook.
 *
 * `.lisa/verification-status.json` is a single path per repo, but a worktree
 * outlives any one flow. When a second `/lisa:implement` runs there, the
 * verification-specialist writes that same path — destroying the completed
 * flow's verdict, which is the record of what its evidence proved.
 *
 * Observed: a shipped SE-5494 verdict (status `pass`, six evidence entries)
 * was one write away from being lost to an unrelated SE-5780 run, and its
 * stale mtime gated that run for four consecutive stop attempts while naming
 * a criterion from the other ticket.
 *
 * The hook archives any verdict whose `plan` differs from the current run
 * before it can be overwritten. Keyed on `.plan`, so re-running the SAME plan
 * still overwrites in place and no archive accumulates.
 * @module tests/unit/hooks/enforce-verification-gate-preserve
 */
import {
  PASSING_CRITERION,
  v1Verdict,
} from "../../helpers/verification-gate-fixtures";
import type { GateScenario } from "../../helpers/verification-gate-harness";
import { createGateScenario } from "../../helpers/verification-gate-harness";

let harness: GateScenario;

beforeEach(() => {
  harness = createGateScenario(process.env);
});

afterEach(() => {
  harness.cleanup();
});

/** The completed flow whose verdict must survive the next run. */
const PRIOR_PLAN = "se-5494-player-preview-drawer";
/** Where the hook is expected to archive it. */
const PRIOR_ARCHIVE = `.lisa/verification-status.${PRIOR_PLAN}.json`;

/**
 * Builds a terminal verdict belonging to a named plan.
 * @param plan Value for the verdict's `.plan` field, which keys the archive.
 * @returns Serialized verdict JSON.
 */
const verdictForPlan = (plan: string): string =>
  JSON.stringify({
    ...JSON.parse(v1Verdict("pass", [PASSING_CRITERION])),
    plan,
  });

describe("enforce-verification-gate.sh — foreign verdict preservation", () => {
  it("archives a prior plan's verdict under a plan-scoped filename", () => {
    harness.writeVerdict(verdictForPlan(PRIOR_PLAN), {
      stale: true,
    });

    harness.armSession("s1");
    harness.stop("s1");

    const archived = harness.readProjectFile(PRIOR_ARCHIVE);

    expect(archived).not.toBeNull();
    expect(JSON.parse(archived as string).plan).toBe(PRIOR_PLAN);
  });

  it("preserves the archived verdict's claims, not just its status", () => {
    harness.writeVerdict(verdictForPlan(PRIOR_PLAN), {
      stale: true,
    });

    harness.armSession("s1");
    harness.stop("s1");

    const archived = JSON.parse(
      harness.readProjectFile(PRIOR_ARCHIVE) as string
    );

    // The point of the archive is the evidence, not the verdict word.
    expect(archived.criteria).toHaveLength(1);
    expect(archived.status).toBe("pass");
  });

  it("does not archive when the verdict has no plan to key on", () => {
    harness.writeVerdict(v1Verdict("pass", [PASSING_CRITERION]), {
      stale: true,
    });

    harness.armSession("s1");
    harness.stop("s1");

    // Nothing to name the archive after — and nothing to distinguish it from
    // the current run's own output, so leaving it alone is correct.
    expect(
      harness.readProjectFile(".lisa/verification-status.undefined.json")
    ).toBeNull();
  });

  it("leaves a fresh verdict alone — it belongs to the current run", () => {
    harness.armSession("s1");
    harness.writeVerdict(verdictForPlan("se-5780-dpl-font-enforcement"));
    harness.stop("s1");

    // Written after arming, so it is this run's own verdict. Archiving it
    // would litter the repo on every successful flow.
    expect(
      harness.readProjectFile(
        ".lisa/verification-status.se-5780-dpl-font-enforcement.json"
      )
    ).toBeNull();
  });

  it("does not overwrite an archive that already exists", () => {
    harness.writeVerdict(verdictForPlan(PRIOR_PLAN), {
      stale: true,
    });
    harness.writeEvidenceFile(
      PRIOR_ARCHIVE,
      JSON.stringify({ plan: PRIOR_PLAN, sentinel: "original" })
    );

    harness.armSession("s1");
    harness.stop("s1");

    const archived = JSON.parse(
      harness.readProjectFile(PRIOR_ARCHIVE) as string
    );

    // A second run must not clobber the first archive with a partial verdict.
    expect(archived.sentinel).toBe("original");
  });
});
