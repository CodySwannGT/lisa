/**
 * The inventory of hardcoded invocations has to describe the artifacts that
 * ship, not the ones that shipped when it was written.
 *
 * A table of "what runs a command nothing declared" is only worth having if it
 * cannot go stale, and it can go stale in BOTH directions:
 *
 *   * an entry naming a step, a job or a script that is gone reports a gap
 *     that no longer exists, and
 *   * a façade job, a `lisa_gate_covers` call or an `-on-edit.sh` hook with no
 *     entry is a gap the inventory silently omits — the failure mode that
 *     matters, because the whole point of the table is to be exhaustive.
 *
 * Both directions are derived from the shipped files here.
 *
 * @module tests/integration/hardcoded-invocation-inventory
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadWorkflow } from "../helpers/workflow-test-utils.js";
import {
  FACADE_WORKFLOWS,
  NOT_CONFIGURED,
  ON_EDIT_SURFACE,
  PRE_TOOL_REFUSAL_SURFACE,
  basename,
  registeredEditTimeEvents,
  PRE_PUSH_HOOK,
  PRE_PUSH_SURFACE,
  QUALITY_YML,
  REPORT_STEP,
  REPO_ROOT,
  loadGates,
  read,
} from "./hardcoded-invocation-fixture.js";
import type { GatesModule } from "./hardcoded-invocation-fixture.js";

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

describe("the hardcoded-invocation inventory", () => {
  it("names only gates the registry defines", () => {
    const unknown = gates.HARDCODED_INVOCATIONS.filter(
      entry => !Object.hasOwn(gates.REGISTRY, entry.gate)
    ).map(entry => `${entry.gate} (${entry.artifact})`);
    expect(unknown).toEqual([]);
  });

  it("names only moments and façade classes Lisa understands", () => {
    for (const entry of gates.HARDCODED_INVOCATIONS) {
      expect(gates.MOMENTS).toContain(entry.moment);
      expect(gates.FACADE_CLASSES).toContain(entry.facade);
    }
  });

  it("names only artifacts that exist", () => {
    const missing = gates.HARDCODED_INVOCATIONS.map(
      entry => entry.artifact
    ).filter(artifact => !fs.existsSync(path.join(REPO_ROOT, artifact)));
    expect(missing).toEqual([]);
  });

  describe("the pre-push hook", () => {
    it("records every property the hook hands over", () => {
      const hook = read(PRE_PUSH_HOOK);
      const calls = [
        ...hook.matchAll(/^(?:if )?lisa_gate_covers ([a-z0-9 -]+); then$/gm),
      ];
      const covered = [
        ...new Set(calls.flatMap(hit => (hit[1] ?? "").split(" "))),
      ];
      expect(covered.length).toBeGreaterThan(0);
      const recorded = new Set(
        gates.HARDCODED_INVOCATIONS.filter(
          entry => entry.surface === PRE_PUSH_SURFACE
        ).map(entry => entry.gate)
      );
      expect(covered.filter(gate => !recorded.has(gate))).toEqual([]);
      // `traceability` is resolved before the coverage file exists — it reads
      // the declaration directly, higher up the hook — so it is deliberately
      // recorded without a `lisa_gate_covers` call to derive it from.
      expect(recorded.has("traceability")).toBe(true);
    });

    it("reports what runs unconfigured before the built-in steps run", () => {
      const hook = read(PRE_PUSH_HOOK);
      expect(hook).toContain("lisa_report_unconfigured() {");
      expect(hook).toContain(
        `node "$GATE_REGISTRY" unconfigured --moment=push --surface=${PRE_PUSH_SURFACE}`
      );
      // Presence is asserted FIRST and separately. `indexOf` returns -1 for an
      // absent call, and -1 is less than every real index, so an ordering
      // assertion alone passes for a hook that never calls this at all — the
      // exact "control that reports success while proving nothing" shape this
      // work exists to remove, reproduced inside its own test.
      const call = hook.indexOf("\nlisa_report_unconfigured\n");
      expect(call).toBeGreaterThan(-1);
      expect(call).toBeLessThan(hook.indexOf("# BEGIN: built-in checks"));
    });

    it("never lets the report change the exit status", () => {
      const hook = read(PRE_PUSH_HOOK);
      const body = hook.slice(
        hook.indexOf("lisa_report_unconfigured() {"),
        hook.indexOf("# Whether a declared gate covers")
      );
      // Report-only is the whole design: seeding has to guarantee a declaration
      // before an absent one may be fatal, or this becomes a gate nobody
      // declared, failing pushes across the fleet it was shipped to measure.
      expect(body).toContain("|| true");
      expect(body).toContain("return 0");
    });
  });

  describe("the reusable workflows", () => {
    it("records every façade job, with the gate the shipped table pairs it to", () => {
      const recorded = new Map(
        gates.HARDCODED_INVOCATIONS.filter(entry => entry.job !== null).map(
          entry => [entry.job as string, entry.gate]
        )
      );
      for (const [job, gate] of Object.entries(gates.QUALITY_JOB_GATES)) {
        expect(recorded.get(job)).toBe(gate);
      }
      for (const job of recorded.keys()) {
        expect(Object.keys(gates.QUALITY_JOB_GATES)).toContain(job);
      }
    });

    it.each(FACADE_WORKFLOWS)(
      "%s: every recorded step exists and runs only when unconfigured",
      file => {
        const workflow = workflowOf(file);
        const entries = entriesFor(file);
        expect(entries.length).toBeGreaterThan(0);
        for (const entry of entries) {
          const job = workflow.jobs[entry.job as string];
          expect(job, `${entry.job} is not declared in ${file}`).toBeDefined();
          for (const name of entry.steps) {
            const step = (job?.steps ?? []).find(
              candidate => candidate.name === name
            );
            expect(
              step,
              `${entry.job} has no step named ${name}`
            ).toBeDefined();
            expect(step?.if ?? "").toContain(NOT_CONFIGURED);
          }
        }
      }
    );

    it.each(FACADE_WORKFLOWS)(
      "%s: every façade job reports its gate when nothing is configured",
      file => {
        const workflow = workflowOf(file);
        for (const entry of entriesFor(file)) {
          const steps = workflow.jobs[entry.job as string]?.steps ?? [];
          const report = steps.find(step => step.name === REPORT_STEP);
          expect(
            report,
            `${entry.job} never says it ran ungoverned`
          ).toBeDefined();
          expect(report?.if).toBe(NOT_CONFIGURED);
          // The gate id comes from the resolve step's own output, so the report
          // cannot name a gate other than the one the job resolved.
          expect(report?.env?.["GATE_ID"]).toBe(
            "${{ steps.gate.outputs.gate }}"
          );
          expect(report?.env?.["RESOLVER"]).toBe(
            "${{ steps.gate.outputs.resolver }}"
          );
          expect(report?.run).toContain("unconfigured");
          expect(report?.run).toContain("--format=github");
          // Scoped to the surface the job is ON, because a workflow's cadence
          // and the moment an entry records are different facts: this file's
          // default moment may be a nightly one the entry does not carry, and
          // an unscoped lookup then matched nothing and printed nothing.
          expect(report?.run).toContain(`--surface=${entry.surface}`);
        }
      }
    );

    it.each(FACADE_WORKFLOWS)(
      "%s: the report can never fail the job it reports on",
      file => {
        // The step calls itself REPORT ONLY, and the whole argument for
        // shipping it to every façade job at once is that it cannot change an
        // exit status. That claim has to be executable, because the body runs
        // under `set -euo pipefail` and the resolver is whichever copy of the
        // registry the consumer has installed — one predating `unconfigured`
        // exits non-zero on it. A reporter that can redden a
        // branch-protection context is a new gate nobody declared.
        for (const entry of entriesFor(file)) {
          const report = (
            workflowOf(file).jobs[entry.job as string]?.steps ?? []
          ).find(step => step.name === REPORT_STEP);
          const invocation = (report?.run ?? "")
            .split("\n")
            .find(line => line.includes("unconfigured"));
          expect(
            invocation,
            `${entry.job} never invokes the reporter`
          ).toBeDefined();
          expect(
            invocation?.trimEnd().endsWith("|| true"),
            `${entry.job} lets a failed resolver fail a required context`
          ).toBe(true);
        }
      }
    );

    it.each(FACADE_WORKFLOWS)(
      "%s: the report step is byte-identical everywhere",
      file => {
        const bodies = Object.values(workflowOf(file).jobs)
          .flatMap(job => job.steps ?? [])
          .filter(step => step.name === REPORT_STEP)
          .map(step => step.run ?? "");
        expect(bodies.length).toBeGreaterThan(0);
        expect(new Set(bodies).size).toBe(1);
      }
    );

    it("emits the gate id and the resolver before the early exit, so the report works with no resolver at all", () => {
      const source = read(QUALITY_YML);
      const emit = source.indexOf('echo "gate=$GATE_ID" >> "$GITHUB_OUTPUT"');
      const early = source.indexOf(
        'if [ -z "$RESOLVER" ]; then echo "configured=false"'
      );
      expect(emit).toBeGreaterThan(-1);
      expect(early).toBeGreaterThan(-1);
      expect(emit).toBeLessThan(early);
    });

    it("never lets a façade job report green having run nothing", () => {
      // The reason the fallbacks may not simply be deleted, as an executable
      // control rather than a comment: these job names are branch-protection
      // contexts, and a required context whose every step is skipped reports
      // GREEN. Each one must keep at least one step that runs when the gate is
      // unconfigured — and the report step does not count, because it proves
      // nothing.
      const empty: string[] = [];
      for (const file of FACADE_WORKFLOWS) {
        const workflow = workflowOf(file);
        for (const entry of entriesFor(file)) {
          const proving = (
            workflow.jobs[entry.job as string]?.steps ?? []
          ).filter(
            step =>
              step.name !== REPORT_STEP &&
              (step.if ?? "").includes(NOT_CONFIGURED)
          );
          if (proving.length === 0) empty.push(`${file}:${entry.job}`);
        }
      }
      expect(empty).toEqual([]);
    });
  });

  describe("the on-edit hooks", () => {
    it("records every shipped source hook", () => {
      // The Codex copies are swept too. The fifteen generated per-agent
      // copies are byte-identical to their originals and so fairly
      // represented by them; these four DIFFER, and all four consult
      // nothing — so representing them by the originals would describe a
      // file that is not the one that runs.
      const dirs = [
        "plugins/src/typescript/hooks",
        "plugins/src/rails/hooks",
        "src/codex/scripts",
      ];
      const shipped = dirs.flatMap(dir =>
        fs
          .readdirSync(path.join(REPO_ROOT, dir))
          .filter(name => name.endsWith("-on-edit.sh"))
          .map(name => `${dir}/${name}`)
      );
      // Deduplicated, because one script may prove more than one property —
      // the Rails hook lints AND formats, so it holds two entries. The
      // invariant is that every shipped script is recorded at least once, not
      // that the two lists are the same length.
      const recorded = new Set(
        gates.HARDCODED_INVOCATIONS.filter(
          entry => entry.surface === ON_EDIT_SURFACE
        ).map(entry => entry.artifact)
      );
      const byName = (left: string, right: string): number =>
        left.localeCompare(right);
      expect([...recorded].sort(byName)).toEqual([...shipped].sort(byName));
    });

    it("records the hook event the shipped manifest actually registers", () => {
      // DERIVED, because the version of this table that shipped first said
      // these scripts fire BEFORE the edit and nothing contradicted it. They
      // are `PostToolUse`. A `moment` field cannot carry that today — the
      // registry has no `post-tool` — so the measured value lives in
      // `hookEvent` and is checked against the manifest here rather than
      // written down and trusted.
      const registered = registeredEditTimeEvents();
      expect(registered.size).toBeGreaterThan(0);

      // BOTH write-boundary surfaces, because the manifests register both and
      // a check that read only one would report the other's absence as
      // nothing to report.
      const entries = gates.HARDCODED_INVOCATIONS.filter(
        entry =>
          entry.surface === ON_EDIT_SURFACE ||
          entry.surface === PRE_TOOL_REFUSAL_SURFACE
      );
      for (const entry of entries) {
        const script = basename(entry.artifact);
        expect(
          (entry as { hookEvent?: string }).hookEvent,
          `${script} is registered as ${registered.get(script)}`
        ).toBe(registered.get(script));
      }
      // And every registered write-boundary script is in the table, so one
      // added to a manifest cannot stay out of the inventory.
      const recorded = new Set(entries.map(entry => basename(entry.artifact)));
      expect(
        [...registered.keys()].filter(name => !recorded.has(name))
      ).toEqual([]);
    });

    it("records both properties of the hook that proves two", () => {
      // `rubocop -a` autocorrects before it checks, so the Rails hook is a
      // formatter as well as a linter — its own header calls it the
      // "Lint-and-Format-on-Edit Hook". The table recorded only the lint half,
      // which reported a formatter running on every agent edit as not running.
      const rails = gates.HARDCODED_INVOCATIONS.filter(
        entry => entry.artifact === "plugins/src/rails/hooks/rubocop-on-edit.sh"
      ).map(entry => entry.gate);
      expect([...rails].sort((a, b) => a.localeCompare(b))).toEqual([
        "code-style",
        "format-conformance",
      ]);
      expect(read("plugins/src/rails/hooks/rubocop-on-edit.sh")).toContain(
        "rubocop -a"
      );
    });

    it("classifies them consults-then-falls-back, and they really do consult", () => {
      // INVERTED when the façade landed, and the inversion is the point. The
      // previous version asserted `never-consults` and grepped for the ABSENCE
      // of a gate lookup, with a comment saying that adding one must break the
      // test rather than leave the inventory describing the script as
      // unreachable. It did break, and this is that break being honoured
      // instead of the assertion being loosened.
      for (const entry of gates.HARDCODED_INVOCATIONS.filter(
        candidate => candidate.surface === ON_EDIT_SURFACE
      )) {
        expect(entry.facade).toBe("consults-then-falls-back");
        expect(read(entry.artifact)).toMatch(/lisa_edit_gate_tasks/);
      }
    });

    it("records a moment a declaration IS legal at, and stays reported anyway", () => {
      // This assertion was inverted deliberately, and the inversion is the
      // point. It read `toBe(false)` because no gate listed either tool
      // moment, so the inventory could not describe these scripts as
      // governable at all. Once the edit moments became declarable, keeping
      // the old expectation would have pinned the entries at a moment they do
      // not fire at purely to keep a control green — the shape this epic
      // exists to remove, reproduced inside the epic's own control.
      //
      // The stronger claim now: the registry CAN represent what these scripts
      // prove, and they are ungoverned anyway, because they read no
      // declaration. The clause above pins the second half by grepping the
      // artifacts; this pins the first, and fails if those moments are
      // dropped from those gates again.
      const entries = gates.HARDCODED_INVOCATIONS.filter(
        candidate => candidate.surface === ON_EDIT_SURFACE
      );

      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(gates.isDeclarableAt(entry.gate, entry.moment)).toBe(true);
      }
    });
  });
});
