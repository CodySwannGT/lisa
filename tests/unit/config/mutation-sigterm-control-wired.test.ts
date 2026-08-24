/**
 * Keeps the SIGTERM control a control (CodySwannGT/lisa#2991).
 *
 * The residual question on that issue is narrow and specific: everything
 * measured on the failure was measured on macOS, and the failure was observed
 * on `ubuntu-latest`. The control that would settle it is the weakened
 * whole-list arm, on a hosted runner, under Node's default 1 MiB `maxBuffer` —
 * and it had never been run there.
 *
 * A control has one silent failure mode, and it is the same one the whole-list
 * bite deferral has: the thing that was supposed to run it gets renamed,
 * de-gated, or quietly stops setting its flag, and from then on nothing anywhere
 * can produce the measurement while the files still read as though something
 * can. That is worse here than for a gate, because the answer this control
 * produces is the ONLY thing standing between the issue and a fifth guess.
 *
 * So the suite and the workflow are checked against each other, and against the
 * two properties that make the draw readable at all: the untruncated capture is
 * kept, and the roster the weakened arm is built from is the same object the
 * bite test uses rather than a second copy of it.
 * @module tests/unit/config/mutation-sigterm-control-wired
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

/** The environment variable that turns the control's two arms on. */
const FLAG = "LISA_MUTATION_SIGTERM_CONTROL";

/** Repository-relative path of the control suite. */
const CONTROL_SUITE = "tests/integration/mutation-sigterm-control.test.ts";

/** The workflow that dispatches it, on the platform whose answer counts. */
const WORKFLOW = ".github/workflows/mutation-sigterm-control.yml";

/** The shared roster both arms are built from. */
const ARMS_HELPER = "tests/helpers/mutation-gate-arms.ts";

/** The bite suite, which must read the roster rather than restate it. */
const BITE_SUITE = "tests/integration/mutation-gate-bite.test.ts";

/** The capture helper whose kill signal the faithful arm has to be able to set. */
const GATE_CAPTURE = "tests/helpers/gate-capture.ts";

/**
 * Read a repository file.
 * @param relative - Repository-relative path
 * @returns Its contents
 */
const read = (relative: string): string =>
  readFileSync(path.join(REPO_ROOT, relative), "utf8");

describe("the SIGTERM control suite", () => {
  const source = read(CONTROL_SUITE);

  it("gates both arms on the flag", () => {
    expect(source).toContain(`process.env["${FLAG}"] === "1"`);
    // Two arms, both gated. An ungated arm puts a ~7-minute whole-list Stryker
    // run on every pull request, which is most of the cost the gating exists to
    // avoid.
    expect(source.match(/it\.runIf\(CONTROL_ENABLED\)\(/gu) ?? []).toHaveLength(
      3
    );
  });

  it("runs an arm under a signal Stryker can catch", () => {
    // Stryker reaches `143` by CATCHING SIGTERM and exiting `128 + 15` itself.
    // `captureGateRun` defaults to SIGKILL, which is uncatchable — so an arm
    // that inherits that default cannot produce a `143` whatever the child
    // does, and is not evidence about the mechanism it was built to test. The
    // first run of this control had exactly that flaw.
    expect(source).toContain('"SIGTERM"');
    expect(read(GATE_CAPTURE)).toContain(
      "readonly killSignal?: NodeJS.Signals"
    );
    expect(read(GATE_CAPTURE)).toContain(
      'const killSignal = options.killSignal ?? "SIGKILL";'
    );
  });

  it("runs the faithful arm at Node's default 1 MiB, not at today's cap", () => {
    // The whole point of the faithful arm is to reproduce the ORIGINAL
    // conditions. Running it at the 256 MiB cap CodySwannGT/lisa#2962
    // introduced would measure a world in which the overflow cannot happen,
    // which is the world the failure already stopped reproducing in.
    expect(source).toContain("const NODE_DEFAULT_MAX_BUFFER = 1024 * 1024;");
    expect(source).toContain("NODE_DEFAULT_MAX_BUFFER,");
    expect(source).toContain("MAX_GATE_OUTPUT_BYTES,");
  });

  it("refuses to assert which draw came back", () => {
    // A control that asserted the answer would be the fifth guess this issue
    // exists to refuse. What it may assert is that the measurement is valid:
    // the arm produced output, and it was not killed by this harness's own
    // deadline — a draw produced by our own SIGKILL is evidence about us.
    expect(source).toContain("assertMeasurementIsValid");
    expect(source).toContain('not.toContain("ETIMEDOUT")');
  });

  it("gates the concurrency-pressure arms on their own flag", () => {
    // Separate from the baseline flag on purpose: the baseline arms answer a
    // settled question and are kept as controls, so a dispatch that only wants
    // the new measurement should not re-pay for the old ones.
    expect(source).toContain('process.env["LISA_MUTATION_SIGTERM_PRESSURE"]');
    expect(source).toContain("it.runIf(PRESSURE_ENABLED)(");
    // Two levels, not one. A single level cannot tell "no effect" from "not
    // enough pressure"; two bracket the threshold or eliminate the axis.
    expect(source).toContain(
      "const PRESSURE_LEVELS: readonly number[] = [8, 16];"
    );
  });

  it("removes both known confounds from the pressure arms", () => {
    // 256 MiB so the eliminated overflow cannot produce the kill and be
    // mistaken for the thing being hunted, and SIGTERM because SIGKILL is
    // uncatchable — an arm run under it cannot draw a `143` by construction.
    const arm = source.slice(
      source.indexOf("it.runIf(PRESSURE_ENABLED)("),
      source.indexOf("it.runIf(CONTROL_ENABLED)(")
    );

    expect(arm).toContain("MAX_GATE_OUTPUT_BYTES");
    expect(arm).toContain('"SIGTERM"');
    expect(arm).not.toContain("NODE_DEFAULT_MAX_BUFFER");
  });

  it("keeps the untruncated capture, not just a tail", () => {
    // `lisa-mutation.mjs` keeps a 256 KiB tail, which would discard an early
    // resource warning — and an early resource warning is exactly what a
    // runner-side reaper leaves behind.
    expect(source).toContain("LISA_SIGTERM_CONTROL_OUT");
    expect(source).toContain("run.output");
  });

  it("builds the weakened arm from the shared roster", () => {
    // Two copies of the roster is how the two callers silently stop running the
    // same experiment.
    expect(source).toContain("../helpers/mutation-gate-arms.js");
    expect(read(BITE_SUITE)).toContain("../helpers/mutation-gate-arms.js");
    expect(read(ARMS_HELPER)).toContain("export const WITHHELD_GUARDS");
    // The literal roster may exist in exactly one place.
    expect(read(BITE_SUITE)).not.toContain(
      '"all/copy-overwrite/scripts/lisa-work-item.mjs",'
    );
  });
});

describe("the workflow that produces the measurement", () => {
  const body = read(WORKFLOW);

  it("runs on the platform whose answer counts", () => {
    // macOS has already answered. `ubuntu-latest` is where the failure was
    // seen and the only place a draw settles anything.
    expect(body).toContain("runs-on: ubuntu-latest");
  });

  it("sets the flag and names the control suite", () => {
    expect(body).toContain(`${FLAG}: '1'`);
    expect(body).toContain(`bun run test ${CONTROL_SUITE}`);
  });

  it("uploads the captures even when an arm dies", () => {
    // A killed arm is the interesting outcome, and its capture is the only
    // place the kill leaves a trace. An upload conditioned on success discards
    // exactly the run worth reading.
    expect(body).toContain("upload-artifact");
    expect(body).toMatch(/if:\s*always\(\)/u);
  });

  it("reads the KERNEL log, which is the only place a reap would say so", () => {
    // Five captures of Stryker's own log showed twelve expected lines and
    // nothing else — because a process reaped by the kernel writes NOTHING to
    // its own stdout. Reading the same log harder cannot settle it.
    expect(body).toContain("oom-kill");
    expect(body).toContain("killed process");
    expect(body).toContain("dmesg");
  });

  it("samples memory during the run, not only before it", () => {
    // A pressure spike that resolves before the job ends is invisible to a
    // before/after reading, and a spike is what a reap would follow.
    expect(body).toContain("memory-samples.txt");
    expect(body).toMatch(/while true; do/u);
  });

  it("records the runner before the arms run", () => {
    // A draw is a property of the machine as much as of the code, and this is
    // a machine nobody here can inspect afterwards.
    expect(body).toContain("nproc");
    expect(body).toContain("free -m");
  });

  it("is dispatched by hand and by nothing else", () => {
    expect(body).toMatch(/^\s{2}workflow_dispatch:$/mu);
    expect(body).not.toMatch(/^\s{2}pull_request:/mu);
    expect(body).not.toMatch(/^\s{2}push:/mu);
    expect(body).not.toMatch(/^\s{2}schedule:/mu);
  });
});
