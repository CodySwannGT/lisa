import { QUALITY_JOB_GATES } from "../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  QUALITY_YML,
  jobIn,
  stepsIn,
  workflowIn,
} from "./quality-gate-facade-fixture.js";
import { REPORT_STEP } from "./hardcoded-invocation-fixture.js";
import type { WorkflowStep } from "../helpers/workflow-test-utils.js";

/**
 * One `quality.yml` job that decides what to do by looking for a script.
 *
 * The shape these jobs share is: grep for a hardcoded script name, then hang
 * the only step that proves anything off whether it was found. When it is not
 * found the job runs a ⏭️ notice and exits 0 — a check that reports satisfied
 * having proved nothing, which is the defect this inventory exists to bound.
 *
 * `jobName` is a LITERAL and not a lookup, for the same reason the façade
 * fixture keeps literals: a job name is a branch-protection context matched by
 * exact string, so a rename has to fail here rather than be followed silently.
 */
interface PresenceJob {
  /** Job id in `quality.yml`. */
  job: string;
  /** The exact context the job posts. */
  jobName: string;
  /** Exact name of the ⏭️ step that runs when the script is absent. */
  skipStep: string;
  /**
   * Whether the job consults the gate declaration before concluding it has
   * nothing to do.
   *
   * `false` is only legitimate while no registry gate NAMES the property — a
   * job cannot consult a declaration that has no vocabulary to be written in.
   * That is asserted below against `QUALITY_JOB_GATES` rather than trusted, so
   * a job cannot stay gate-blind once its gate exists.
   */
  gateAware: boolean;
}

/**
 * Every presence-gated job, exhaustively.
 *
 * Kept exhaustive by the first test below, which reads the workflow and fails
 * if it finds a `check_script` step this list omits. Deliberately not counted
 * in prose: the published count for this family has been wrong twice (it was
 * seven before the duplicate e2e job was deleted, and the reference count of
 * `check_script` was quoted as 29 against a file containing 25). The list is
 * the count.
 */
const PRESENCE_JOBS: readonly PresenceJob[] = [
  {
    job: "e2e_coverage",
    jobName: "🧭 E2E Route Coverage",
    skipStep: "⏭️ Skip e2e coverage (no check-e2e-coverage.mjs script)",
    gateAware: false,
  },
  {
    job: "state_classification",
    jobName: "🧬 State Classification",
    skipStep:
      "⏭️ Skip state classification (no check-state-classification.mjs script)",
    gateAware: false,
  },
  {
    job: "test_unit",
    jobName: "🧪 Run Unit Tests",
    skipStep: "⏭️ Skip unit tests (no test:unit script)",
    gateAware: true,
  },
  {
    job: "test_mutation",
    jobName: "🧬 Mutation Testing Gate",
    skipStep: "⏭️ Skip mutation gate (no test:mutation script)",
    gateAware: true,
  },
  {
    job: "test_integration",
    jobName: "🧪 Run Integration Tests",
    skipStep: "⏭️ Skip integration tests (no test:integration script)",
    gateAware: true,
  },
  {
    job: "performance_budget",
    jobName: "⚡ Performance Budget",
    skipStep: "⏭️ Skip the performance budget (no export:web script)",
    gateAware: true,
  },
];

/**
 * Alphabetical order both sides of the inventory comparison are put into.
 *
 * A bare `.sort()` orders by UTF-16 code unit, which is not the alphabetical
 * order the assertion reads as, so the comparator is explicit.
 * @param left One job id.
 * @param right The other.
 * @returns Negative, zero or positive, per `localeCompare`.
 */
const byName = (left: string, right: string): number =>
  left.localeCompare(right);

/** The presence-probe step id every job in the family uses. */
const PROBE_ID = "check_script";

/** The condition value the resolve step writes when nothing is declared. */
const NOT_CONFIGURED = "steps.gate.outputs.configured == 'false'";

/**
 * The `if:` of one named step, as written.
 * @param job Job id.
 * @param name Exact step name.
 * @returns The condition, or the empty string when the step has none.
 */
const conditionOf = (job: string, name: string): string => {
  const step = stepsIn(job).find(candidate => candidate.name === name);
  if (step === undefined) {
    throw new Error(
      `${job} has no step named ${JSON.stringify(name)} in quality.yml. ` +
        "A renamed step turns every assertion about it into an assertion " +
        "about undefined, which is how a gate goes quiet."
    );
  }
  return String((step as Record<string, unknown>)["if"] ?? "");
};

/**
 * The gate-resolution step of a job, if it has one.
 * @param job Job id.
 * @returns The step, or undefined when the job has no façade.
 */
const gateStep = (job: string): WorkflowStep | undefined =>
  stepsIn(job).find(step => step.id === "gate");

describe("quality.yml presence-gated jobs", () => {
  it("inventories every job that decides by looking for a script", () => {
    const found = Object.entries(workflowIn(QUALITY_YML).jobs)
      .filter(([, definition]) =>
        (definition.steps ?? []).some(step => step.id === PROBE_ID)
      )
      .map(([job]) => job)
      .sort(byName);

    expect(found).toEqual(PRESENCE_JOBS.map(entry => entry.job).sort(byName));
  });

  it.each(PRESENCE_JOBS)(
    "$job still posts the exact context $jobName",
    ({ job, jobName }) => {
      expect((jobIn(job) as { name?: string }).name).toBe(jobName);
    }
  );

  describe("the declaration is consulted before the job concludes it has nothing to do", () => {
    it.each(PRESENCE_JOBS.filter(entry => entry.gateAware))(
      "$job resolves its gate unconditionally, never behind the script probe",
      ({ job }) => {
        const resolve = gateStep(job);
        expect(resolve).toBeDefined();
        // A resolve step conditioned on the probe does not merely skip — it
        // leaves `configured` as the EMPTY STRING, which equals neither
        // 'true' nor 'false', so BOTH proving steps sit out and the ⏭️ notice
        // reports the job green. `test_mutation` shipped in exactly that
        // state.
        expect(
          String((resolve as Record<string, unknown>)["if"] ?? "")
        ).not.toContain(`steps.${PROBE_ID}.outputs`);
      }
    );

    it.each(PRESENCE_JOBS.filter(entry => entry.gateAware))(
      "$job's ⏭️ notice requires the gate to be unconfigured as well as the script absent",
      ({ job, skipStep }) => {
        expect(conditionOf(job, skipStep)).toContain(NOT_CONFIGURED);
      }
    );

    it.each(PRESENCE_JOBS.filter(entry => !entry.gateAware))(
      "$job is gate-blind only because no registry gate names its property",
      ({ job }) => {
        // The moment a gate exists for one of these, this fails and the job
        // has to start consulting it. That is what stops the exemption from
        // outliving its reason.
        expect(Object.hasOwn(QUALITY_JOB_GATES, job)).toBe(false);
        expect(gateStep(job)).toBeUndefined();
      }
    );
  });

  describe("a job that proved nothing says so where an audit can read it", () => {
    it.each(PRESENCE_JOBS)(
      "$job's ⏭️ notice emits a ::warning annotation, not a bare echo",
      ({ job, skipStep }) => {
        const step = stepsIn(job).find(
          candidate => candidate.name === skipStep
        );
        const body = String(step?.run ?? "");
        expect(body).toContain("::warning title=");
        expect(body).toContain("unproven");
      }
    );

    it.each(PRESENCE_JOBS)(
      "$job's ⏭️ notice does not narrate a skip into the log and stop there",
      ({ job, skipStep }) => {
        const body = String(
          stepsIn(job).find(candidate => candidate.name === skipStep)?.run ?? ""
        );
        // The pre-fix shape, matched as a plain substring rather than a
        // regex: `echo "Skipping <thing> - <script> not found"`, which is
        // invisible outside the job log and says nothing an audit can key on.
        const narratesOnly = body
          .split("\n")
          .some(line => line.trimStart().startsWith('echo "Skipping'));
        expect(narratesOnly).toBe(false);
      }
    );
  });

  describe("the fallback cannot run a script the project does not have", () => {
    it.each(PRESENCE_JOBS.filter(entry => entry.gateAware))(
      "$job's shipped-tooling path requires the script to exist",
      ({ job }) => {
        // The report step shares the condition but is not a fallback: it
        // runs the gate registry to say the property is ungoverned, never a
        // script from the project's package.json, so the presence probe has
        // nothing to say about it. Excluded by name for the same reason the
        // inventory's own "ran nothing" control excludes it — including it
        // would assert a proving-path property of a step that proves nothing.
        const fallbacks = stepsIn(job).filter(
          step =>
            step.name !== REPORT_STEP &&
            String((step as Record<string, unknown>)["if"] ?? "").includes(
              NOT_CONFIGURED
            )
        );
        expect(fallbacks.length).toBeGreaterThan(0);
        for (const step of fallbacks) {
          expect(
            String((step as Record<string, unknown>)["if"] ?? "")
          ).toContain(`steps.${PROBE_ID}.outputs.exists ==`);
        }
      }
    );
  });
});
