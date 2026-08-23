/**
 * A façade job must run a PROOF, not merely a step.
 *
 * The inventory's original control asks whether a step RAN when the gate was
 * undeclared. The criterion asks whether a PROOF ran, and the distinction is
 * exactly one word: a probe reporting "no token" and a notice saying "skipped"
 * both satisfy the former. Two jobs satisfied it with a bare `echo` on every
 * path, and thirteen more have at least one reachable path where the only
 * steps that execute are a probe and a skip notice.
 *
 * Every job failing the stronger bar is recorded here with a stated reason,
 * and both tables are derived-and-compared in both directions — so a job that
 * starts proving something loses its exemption, and a job that stops proving
 * one cannot join the population in silence.
 *
 * @module tests/integration/facade-proof-not-step
 */
import { beforeAll, describe, expect, it } from "vitest";

import { loadWorkflow } from "../helpers/workflow-test-utils.js";
import {
  FACADE_WORKFLOWS,
  narratesOnly,
  NOT_CONFIGURED,
  REPO_ROOT,
  REPORT_STEP,
  loadGates,
} from "./hardcoded-invocation-fixture.js";
import type { GatesModule } from "./hardcoded-invocation-fixture.js";
import * as path from "node:path";

let gates: GatesModule;

beforeAll(async () => {
  gates = await loadGates();
});

/**
 * One workflow, parsed.
 * @param file Repository-relative workflow path.
 * @returns The parsed workflow.
 */
const workflowOf = (file: string): ReturnType<typeof loadWorkflow> =>
  loadWorkflow(path.join(REPO_ROOT, file));

/**
 * The inventory entries recorded against one artifact.
 * @param file Repository-relative artifact path.
 * @returns Matching entries.
 */
const entriesFor = (file: string): GatesModule["HARDCODED_INVOCATIONS"] =>
  gates.HARDCODED_INVOCATIONS.filter(entry => entry.artifact === file);

/**
 * Alphabetical order both sides of every inventory comparison are put into.
 *
 * A bare `.sort()` orders by UTF-16 code unit, which is not the order the
 * assertion reads as.
 * @param left One job id.
 * @param right The other.
 * @returns Negative, zero or positive, per `localeCompare`.
 */
const byName = (left: string, right: string): number =>
  left.localeCompare(right);

/** One workflow step, as these assertions read it. */
interface FacadeStep {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
}

/**
 * The steps of one façade job that run when nothing declared its gate.
 *
 * The report step is excluded because it proves nothing by construction — it
 * exists to say the property is ungoverned.
 * @param file Repository-relative workflow path.
 * @param job Job id.
 * @returns The unconfigured-path steps.
 */
const unconfiguredSteps = (file: string, job: string): FacadeStep[] =>
  (workflowOf(file).jobs[job]?.steps ?? []).filter(
    step =>
      step.name !== REPORT_STEP && (step.if ?? "").includes(NOT_CONFIGURED)
  );

/**
 * Façade jobs whose unconfigured path proves nothing on ANY branch.
 * @returns Job ids, alphabetically.
 */
const narrationOnlyJobs = (): string[] => {
  const found: string[] = [];
  for (const file of FACADE_WORKFLOWS) {
    for (const entry of entriesFor(file)) {
      const steps = unconfiguredSteps(file, entry.job as string);
      if (steps.length > 0 && steps.every(narratesOnly)) {
        found.push(entry.job as string);
      }
    }
  }
  return found.sort(byName);
};

/**
 * Whether one job has a reachable unconfigured path that only narrates.
 *
 * A "path" is one distinct `if:` among the unconfigured-path steps: the steps
 * sharing a condition run together, so a condition whose whole group narrates
 * is a way for the job to finish green having proved nothing.
 * @param file Repository-relative workflow path.
 * @param job Job id.
 * @returns True when at least one such path exists.
 */
const hasNarrationOnlyPath = (file: string, job: string): boolean => {
  const paths = new Map<string, FacadeStep[]>();
  for (const step of unconfiguredSteps(file, job)) {
    const key = String(step.if ?? "");
    paths.set(key, [...(paths.get(key) ?? []), step]);
  }
  return [...paths.values()].some(
    group => group.length > 0 && group.every(narratesOnly)
  );
};

/**
 * Façade jobs with at least one reachable unconfigured path that only narrates.
 * @returns Job ids, alphabetically.
 */
const narrationOnlyPathJobs = (): string[] => {
  const stronger = new Set(narrationOnlyJobs());
  return FACADE_WORKFLOWS.flatMap(file =>
    entriesFor(file)
      .map(entry => entry.job as string)
      .filter(job => !stronger.has(job) && hasNarrationOnlyPath(file, job))
  ).sort(byName);
};

/**
 * Jobs that prove nothing on their whole unconfigured path, and why.
 *
 * Recorded rather than fixed, per the criterion's second clause. Both are
 * ENVIRONMENT ADAPTER gates: Lisa ships no adapter for either property, so
 * there is no built-in for the fallback to run. The notice is the honest
 * answer; what makes it defensible is that neither context may be required
 * until an adapter is declared.
 *
 * Derived-and-compared in both directions below, so a job that starts proving
 * something fails here rather than keeping its exemption.
 */
const NARRATION_ONLY_JOBS: Readonly<Record<string, string>> = Object.freeze({
  environment_reset:
    "Lisa ships no environment-reset adapter, so there is no built-in to " +
    "fall back to. The gate exists so a project can declare its own; until " +
    "one is declared the honest report is that nothing reset anything, and " +
    "the context must not be required on any ruleset.",
  environment_reseed:
    "Lisa ships no environment-reseed adapter, so there is no built-in to " +
    "fall back to. Same argument as environment_reset: declarable, not " +
    "shipped, and not requireable until a project declares an adapter.",
});

/**
 * Jobs with a reachable path on which only narration runs, and why.
 *
 * Three distinct causes, and the distinction matters to whoever picks one up:
 *
 *   * a Lisa-shipped script the project does not have — governed since #2929
 *     by `gates.unproven`, which turns the notice into a failure on request;
 *   * a config file Lisa cannot supply (`sgconfig.yml`, a Playwright config);
 *   * a third-party token Lisa cannot supply.
 *
 * The last two cannot be "fixed" by Lisa in the sense the criterion means: a
 * scan with no credential has nothing to scan with. What they need is to stay
 * off required rulesets, which is what recording them here is for.
 */
const NARRATION_ONLY_PATHS: Readonly<Record<string, string>> = Object.freeze({
  e2e_coverage:
    "The Lisa-managed check-e2e-coverage.mjs may be absent. Governed by " +
    "gates.unproven since #2929: warn keeps today's behaviour, fail turns " +
    "the notice into a non-zero exit naming both remedies.",
  license_compliance:
    "No FOSSA token, which Lisa cannot supply. A licence scan with no " +
    "credential has nothing to scan with, so the path is unavoidable; what " +
    "matters is that this context stays off required rulesets until a token " +
    "is configured.",
  maestro_e2e:
    "No Maestro token, which Lisa cannot supply. Same argument as " +
    "license_compliance: unavoidable without a credential, and therefore not " +
    "a context to require until one exists.",
  performance_budget:
    "The project may ship no export:web script, so there is no bundle to " +
    "measure. Governed by gates.unproven since #2929.",
  playwright_e2e_aggregate:
    "No Playwright config, so there are no shards to aggregate. Lisa cannot " +
    "supply a project's browser-suite config; the aggregate context must " +
    "stay optional until the project has one.",
  secret_scanning:
    "No GitGuardian token, which Lisa cannot supply. Unavoidable without a " +
    "credential; the built-in gitleaks pass at commit time is the property's " +
    "other prover and is not affected.",
  sg_scan:
    "No sgconfig.yml, so ast-grep has no ruleset to scan against. Lisa " +
    "cannot supply a project's structural rules; the path is the honest " +
    "answer and the context must stay optional until the config exists.",
  snyk:
    "No Snyk token, which Lisa cannot supply. The dependency-vulnerability " +
    "property has a second prover (the npm audit job) that does post a " +
    "required context, so the property is not left unproven by this path.",
  sonarcloud:
    "No SONAR_TOKEN, which Lisa cannot supply. Unavoidable without a " +
    "credential; the context must stay optional until one is configured.",
  state_classification:
    "The Lisa-managed check-state-classification.mjs may be absent. " +
    "Governed by gates.unproven since #2929.",
  test_integration:
    "The project may ship no test:integration script. Governed by " +
    "gates.unproven since #2929, and this context IS required on some " +
    "rulesets, which is why the enforcing mode exists.",
  test_mutation:
    "The project may ship no test:mutation script. Governed by " +
    "gates.unproven since #2929.",
  test_unit:
    "The project may ship no test:unit script. Governed by gates.unproven " +
    "since #2929, and this context IS required on some rulesets, which is " +
    "why the enforcing mode exists.",
});

describe("the narration classifier itself", () => {
  // The classifier is the whole control, so its own blind spots are the
  // control's blind spots. These cases are synthetic on purpose: they pin
  // behaviour the shipped workflows do not currently exercise, which is
  // exactly where a classifier rots unnoticed.

  it("reads a bare echo as narration", () => {
    expect(narratesOnly({ name: "notice", run: 'echo "nothing to do"' })).toBe(
      true
    );
  });

  it("reads a skip-marked step as narration whatever it runs", () => {
    // A notice that grew a `node -e` to decide how loudly to complain still
    // proves nothing about the property.
    expect(
      narratesOnly({ name: "⏭️ Skip it", run: "node -e 'process.exit(0)'" })
    ).toBe(true);
  });

  it("does not read a command that merely STARTS with a keyword as structure", () => {
    // The regression this pins: `STRUCTURE_ONLY` had no word boundary, so
    // `find`, `docker`, `format` and friends matched the `fi`/`do`/`for`
    // alternatives, dropped out of the command list, and left a step whose
    // only real work was `find ...` classified as narration-only — the same
    // blind spot this classifier exists to remove.
    for (const command of [
      "find . -name '*.ts' -delete",
      "docker run --rm scanner",
      "format-check --strict",
      "forge build",
      "done_report --emit",
    ]) {
      expect(narratesOnly({ name: "real work", run: command }), command).toBe(
        false
      );
    }
  });

  it("still filters a bare keyword, so the boundary did not stop it filtering", () => {
    // The other direction of the same fix. A keyword ALONE on its line — the
    // `fi`, `esac`, `;;` that close a block — must still be dropped, or every
    // structured body would read as a proof.
    expect(narratesOnly({ name: "notice", run: 'echo "a"\nfi' })).toBe(true);
    expect(narratesOnly({ name: "notice", run: 'echo "a"\nesac\n;;' })).toBe(
      true
    );
  });

  it("does not claim to understand a compound condition", () => {
    // An honest limit, pinned so nobody reads the classifier as more precise
    // than it is. `if [ -f x ]; then echo yes; fi` only echoes, but `[` reads
    // as a command, so this comes back "not narration". That is the SAFE
    // direction — it can call a narrating step a proof, never the reverse —
    // and it predates the boundary fix rather than arriving with it.
    expect(
      narratesOnly({ name: "probe", run: 'if [ -f x ]; then\n  echo "y"\nfi' })
    ).toBe(false);
  });

  it("reads a step that uses an action as a proof", () => {
    expect(narratesOnly({ name: "scan", uses: "some/action@v1" })).toBe(false);
  });
});

describe("a façade job must run a proof, not merely a step", () => {
  it("names every job whose unconfigured path is narration end to end", () => {
    // The control above asks whether a step RAN. This one asks whether a
    // PROOF ran, which is the distinction the criterion turns on and the
    // one word the original missed. Two jobs satisfy the weaker bar with a
    // bare notice and nothing else on any path.
    expect(narrationOnlyJobs()).toEqual(
      Object.keys(NARRATION_ONLY_JOBS).sort(byName)
    );
  });

  it.each(Object.entries(NARRATION_ONLY_JOBS))(
    "%s is recorded with a stated reason rather than passing quietly",
    (_job, reason) => {
      // A recorded exemption is only honest while it says why. An empty
      // string here would be the exemption outliving its argument.
      expect(reason.length).toBeGreaterThan(40);
    }
  );

  it("names every job with a reachable path on which only narration runs", () => {
    // Wider than the two above and a different defect: these jobs DO have
    // a proving step, but it is conditioned on a probe, so there is a
    // reachable path — script absent, config absent, token absent — where
    // the only steps that execute are the probe and a notice. Each one is
    // a required-context job that can complete green having proved
    // nothing, so each is recorded with what governs it.
    // Jobs already counted by the stronger table are excluded, because
    // recording them twice would let one table be satisfied by the other's
    // entry.
    expect(narrationOnlyPathJobs()).toEqual(
      Object.keys(NARRATION_ONLY_PATHS).sort(byName)
    );
  });

  it.each(Object.entries(NARRATION_ONLY_PATHS))(
    "%s's narration-only path is recorded with a stated reason",
    (_job, reason) => {
      expect(reason.length).toBeGreaterThan(40);
    }
  );
});
