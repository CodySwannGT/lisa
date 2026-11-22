/**
 * A stand-in for the affected-spec selector (`scripts/lisa-rspec-select.mjs`,
 * CodySwannGT/lisa#4612) that a Rails fixture host can carry, so a gate-runner
 * test can state that RSpec ran a partial selection without a real map, git
 * history or Ruby.
 * @module tests/integration/support/rails-partial-selector
 */

/**
 * The selector's source. It always plans a partial run of one spec, and its
 * `runRspecPlan` appends `partial <specs>` to `$EVENT_LOG`. With `escalate`
 * it then does what the real one does when a changed file falls short of its
 * floor: it reports the run as full through `LISA_SELECTION_REPORT` and runs
 * the full suite, whose verdict decides the push.
 * @param escalate - Whether the partial run escalates to the full suite
 * @returns The module source
 */
export function partialSelector(escalate: boolean): string {
  return `import { appendFileSync, writeFileSync } from "node:fs";
export const planRspecRun = () => ({ kind: "partial", specs: ["spec/a_spec.rb"], coverage: "changed-files", lines: ["selected 1 spec"] });
export const runRspecPlan = ({ plan, runFull }) => {
  appendFileSync(process.env.EVENT_LOG, "partial " + plan.specs.join(" ") + "\\n");
  if (!${escalate}) return 0;
  writeFileSync(process.env.LISA_SELECTION_REPORT, JSON.stringify({ selection: "full", escalated: true }));
  return runFull();
};
`;
}
