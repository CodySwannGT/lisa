/**
 * Contract tests for the Android emulator CAPABILITY inputs on the Maestro
 * native e2e reusable workflow.
 *
 * `reactivecircus/android-emulator-runner` accepts `cores`, `ram-size`,
 * `heap-size` and `emulator-options`. The workflow consumed none of them, so
 * every adopter silently inherited the action's own defaults with no way to
 * ask for anything else and no indication the knobs existed. These tests pin
 * the caller surface that closes that gap.
 *
 * Two properties matter more than the passthrough itself:
 *
 * 1. A caller that sets nothing must get TODAY's emulator. The action's
 *    defaults are not all empty — `cores` defaults to 2 and
 *    `emulator-options` to a five-flag string — and a `with:` key whose
 *    expression resolves to the empty string OVERRIDES the action default
 *    rather than falling back to it. So an "empty passthrough" would silently
 *    drop `hw.cpu.ncore=2` and launch the emulator with no `-no-window`. The
 *    defaults asserted here are copies of the action's, chosen so the wired
 *    values reproduce the unwired behaviour exactly.
 * 2. The documentation must carry the runner-capacity caveat and must
 *    disclaim the animation-timeout theory. The theory that a 2-core
 *    swiftshader emulator causes Maestro's 5s `waitForAnimationsToComplete`
 *    timeouts was tested and REJECTED (the cause is upstream, in Maestro's
 *    `injectInputEvent(event, sync=true)`), and this input surface is exactly
 *    what invites the next reader to re-run it.
 *
 * @module tests/integration/maestro-native-emulator-capability
 */
import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REUSABLE_YML = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "maestro-native-e2e.yml"
);

/**
 * The action's own `emulator-options` default, copied verbatim from
 * `reactivecircus/android-emulator-runner@v2`'s `action.yml`. Hardcoded, not
 * derived: the whole point of the assertion is that Lisa's default is a
 * faithful copy of a value that lives in another repository, and computing it
 * from the workflow under test would assert nothing.
 */
const ACTION_EMULATOR_OPTIONS_DEFAULT =
  "-no-window -gpu swiftshader_indirect -no-snapshot -noaudio -no-boot-anim";

/** Shape of a single `workflow_call` input declaration. */
interface WorkflowInput {
  description?: string;
  required?: boolean;
  default?: unknown;
  type?: string;
}

/** Shape of a single step inside a workflow job's `steps:` list. */
interface WorkflowStep {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

/** Shape of a single job inside a workflow's `jobs:` map. */
interface WorkflowJob {
  steps?: WorkflowStep[];
}

/** Root shape of the parsed reusable workflow. */
interface ReusableWorkflow {
  on: {
    workflow_call?: { inputs?: Record<string, WorkflowInput> };
  };
  jobs: Record<string, WorkflowJob>;
}

describe("maestro-native-e2e android emulator capability inputs", () => {
  let workflow: ReusableWorkflow;
  let inputs: Record<string, WorkflowInput>;
  let emulatorStep: WorkflowStep | undefined;

  beforeAll(async () => {
    workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as ReusableWorkflow;
    inputs = workflow.on.workflow_call?.inputs ?? {};
    emulatorStep = Object.values(workflow.jobs)
      .flatMap(job => job.steps ?? [])
      .find(step =>
        step.uses?.startsWith("reactivecircus/android-emulator-runner")
      );
  });

  it("finds the emulator step it is asserting about", () => {
    // Guard for every `with:` assertion below: a renamed or deleted step
    // would otherwise make them vacuous rather than red.
    expect(emulatorStep).toBeDefined();
  });

  it("exposes all four capability knobs the action supports, all optional", () => {
    for (const name of [
      "android_emulator_cores",
      "android_emulator_ram_size",
      "android_emulator_heap_size",
      "android_emulator_options",
    ]) {
      expect(inputs[name], `input ${name} is missing`).toBeDefined();
      expect(inputs[name]?.required ?? false, `input ${name}`).toBe(false);
    }
  });

  it("defaults every knob to the action's CURRENT behaviour, not to empty", () => {
    // `cores` and `emulator-options` carry non-empty defaults in the action's
    // own action.yml. Wiring them to an empty default would not be a no-op —
    // it would drop `hw.cpu.ncore=2` and launch a windowed, hardware-GPU
    // emulator on a headless runner. Copy the action's values instead.
    expect(inputs.android_emulator_cores?.default).toBe(2);
    expect(inputs.android_emulator_options?.default).toBe(
      ACTION_EMULATOR_OPTIONS_DEFAULT
    );
    // `ram-size` and `heap-size` have NO default in the action, and the action
    // writes their `config.ini` lines only when the value is truthy. Empty is
    // therefore the faithful copy for these two.
    expect(inputs.android_emulator_ram_size?.default).toBe("");
    expect(inputs.android_emulator_heap_size?.default).toBe("");
  });

  it("types the knobs the way the action reads them", () => {
    expect(inputs.android_emulator_cores?.type).toBe("number");
    expect(inputs.android_emulator_ram_size?.type).toBe("string");
    expect(inputs.android_emulator_heap_size?.type).toBe("string");
    expect(inputs.android_emulator_options?.type).toBe("string");
  });

  it("reaches reactivecircus/android-emulator-runner with each caller value", () => {
    const withBlock = emulatorStep?.with ?? {};
    expect(withBlock.cores).toBe("${{ inputs.android_emulator_cores }}");
    expect(withBlock["ram-size"]).toBe(
      "${{ inputs.android_emulator_ram_size }}"
    );
    expect(withBlock["heap-size"]).toBe(
      "${{ inputs.android_emulator_heap_size }}"
    );
    // The caller's value still reaches the action unmodified and FIRST. The
    // workflow appends a redirect after it so a later step can scan the
    // emulator's own output for a FATAL (#3470) — see the FATAL scan step and
    // tests/integration/maestro-native-fatal-surface.test.ts.
    //
    // Asserted as prefix plus EXACT remainder rather than relaxed to a
    // `toContain`: this test's property is that a caller's options are passed
    // through rather than replaced, and a containment check would also pass if
    // something else were smuggled into this string.
    const emulatorOptions = withBlock["emulator-options"] ?? "";
    const callerValue = "${{ inputs.android_emulator_options }}";
    expect(emulatorOptions.startsWith(callerValue)).toBe(true);
    expect(emulatorOptions.slice(callerValue.length)).toBe(
      " > ${{ runner.temp }}/android-emulator.log 2>&1"
    );
  });

  it("keeps the settings a caller must not be able to move out of this block", () => {
    // The capability inputs are additions, not a rewrite. The device identity
    // and the animation switch stay pinned in the workflow so the four new
    // knobs cannot be read as "the emulator is now caller-defined".
    const withBlock = emulatorStep?.with ?? {};
    expect(withBlock["api-level"]).toBe(34);
    expect(withBlock.arch).toBe("x86_64");
    expect(withBlock.target).toBe("google_apis");
    expect(withBlock.profile).toBe("pixel_6");
    expect(withBlock["disable-animations"]).toBe(true);
  });

  it("documents the runner-capacity caveat on cores", () => {
    // `ubuntu-latest` has 4 vCPUs and the emulator shares them with the host
    // process that drives it. A caller reading only "the number of cores"
    // would reasonably raise this to 4 and make the run slower, so the ceiling
    // has to be in the description, not in a commit message.
    const description = inputs.android_emulator_cores?.description ?? "";
    expect(description).toContain("ubuntu-latest");
    expect(description).toContain("4 vCPU");
    expect(description).toMatch(/starv/i);
    expect(description).toMatch(/larger runner/i);
  });

  it("disclaims the disproved animation-timeout theory on cores", () => {
    // This is the documentation's load-bearing half. The resource theory for
    // Maestro's `waitForAnimationsToComplete` timeouts is superficially
    // convincing, has already cost one investigation, and was falsified by
    // the session that raised it. Anyone who arrives at this input while
    // chasing those timeouts must be turned around here.
    const description = inputs.android_emulator_cores?.description ?? "";
    expect(description).toMatch(/animation/i);
    expect(description).toMatch(/injectInputEvent/);
  });

  it("warns that emulator options REPLACE the defaults rather than extend them", () => {
    // The action takes one options string; there is no merge. A caller that
    // passes `-gpu host` and nothing else silently loses `-no-window` and the
    // emulator never comes up on a headless runner.
    const description = inputs.android_emulator_options?.description ?? "";
    expect(description).toMatch(/replace/i);
    expect(description).toContain("-no-window");
    // The full default has to be quoted in the description: a caller cannot
    // extend a list it has to go read another repository to discover.
    expect(description).toContain(ACTION_EMULATOR_OPTIONS_DEFAULT);
  });
});
