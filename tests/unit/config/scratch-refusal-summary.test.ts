/**
 * Guards that a refused run still ends in a summary line.
 *
 * A refused run was measured emitting NO verdict line at all — the outcome
 * #2883 recorded as NO-RESULT, and the clause of "repeated runs agree" that
 * #3032 carries forward as independently unmet: *every* run must emit a summary
 * line, and a refused one emitted none.
 *
 * #3027 fixed the other end of the page. The reason is now announced BEFORE
 * collection, above the 0% coverage table, so it can no longer be read as a
 * coverage failure. The tail was still wrong: measured on vitest 4.1.9, the
 * last thing a refused run printed was a stack trace through
 * `TestProject._initializeGlobalSetup`, with no line anywhere saying what the
 * run concluded. An operator reading the bottom of a transcript — which is
 * where every other run puts its verdict — got a frame in vitest's internals.
 *
 * So the refusal now speaks twice, and the two are not redundant: the banner is
 * read by someone who starts at the top, and the summary line by someone who
 * starts at the end. Both say the same thing, which is that no test ran and
 * therefore nothing was proved either way.
 * @module tests/unit/config/scratch-refusal-summary
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  SCRATCH_NAMESPACE,
  SCRATCH_ROOT_ENV,
} from "../../../src/configs/vitest/scratch.js";
import {
  armRefusalSummary,
  MAX_NAMESPACE_ENTRIES,
  POOL_WORKER_ENV,
  renderRefusalSummary,
  setup,
} from "../../../src/configs/vitest/scratch-global-setup.js";

const FAILURE = "NAMESPACE HELD 600 ENTRIES";

describe("renderRefusalSummary", () => {
  it("is exactly one line, so it reads as a summary and not a second banner", () => {
    const summary = renderRefusalSummary(FAILURE);

    expect(summary.trimEnd().includes("\n")).toBe(false);
    expect(summary.endsWith("\n")).toBe(true);
  });

  it("says the run reached no verdict, in those terms", () => {
    const summary = renderRefusalSummary(FAILURE);

    expect(summary).toContain("NO VERDICT");
    expect(
      summary,
      "a reader who sees only this line must not conclude the code passed " +
        "or failed; a refused run measured neither"
    ).toContain("0 test");
  });

  it("carries the reason, so the tail is actionable without scrolling up", () => {
    expect(renderRefusalSummary(FAILURE)).toContain(FAILURE);
  });
});

describe("setup: the refusal is also the last word", () => {
  const worker = process.env[POOL_WORKER_ENV];

  beforeEach(() => {
    // This file runs inside a pool worker, where arming is refused on purpose.
    // Clearing the marker is how a test stands in for the one process that may
    // arm — the main process vitest runs `globalSetup` in.
    // eslint-disable-next-line functional/immutable-data -- process env is the subject
    delete process.env[POOL_WORKER_ENV];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // eslint-disable-next-line functional/immutable-data -- process env is the subject
    delete process.env[SCRATCH_ROOT_ENV];
    // eslint-disable-next-line functional/immutable-data -- process env is the subject
    if (worker !== undefined) process.env[POOL_WORKER_ENV] = worker;
  });

  it("registers an exit hook that writes the summary line", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "refusal-summary-"));
    const namespace = path.join(base, SCRATCH_NAMESPACE);
    fs.mkdirSync(namespace);
    // Foreign names, so the sweep spares them on age and the only branch that
    // can fire is the ceiling — the same branch `scratch-refusal-order` uses.
    for (let i = 0; i <= MAX_NAMESPACE_ENTRIES; i += 1) {
      fs.mkdirSync(path.join(namespace, `filler-${String(i)}`));
    }
    process.env[SCRATCH_ROOT_ENV] = base;

    // `process.once` is intercepted rather than allowed through. Letting the
    // real registration stand would arm this worker's own exit to print a
    // refusal banner for a run that was never refused.
    const handlers: (() => void)[] = [];
    vi.spyOn(process, "once").mockImplementation(((
      event: string,
      handler: () => void
    ) => {
      // eslint-disable-next-line functional/immutable-data -- capturing is the mechanism
      if (event === "exit") handlers.push(handler);
      return process;
    }) as typeof process.once);

    expect(() => {
      setup();
    }).toThrow(/past the ceiling/);

    expect(
      handlers,
      "nothing was armed for exit, so the transcript still ends in a stack " +
        "trace and the run reports no verdict at all"
    ).toHaveLength(1);

    vi.restoreAllMocks();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it("writes the summary line when that exit hook fires", () => {
    // The writer is a parameter because fd 2 is not interceptable from inside
    // an ESM test — `vi.spyOn(fs, "writeSync")` cannot redefine a module
    // namespace export. The default is `fs.writeSync`, not
    // `process.stderr.write`: at exit an async write to a pipe can be dropped,
    // which would leave this line green and the transcript unchanged.
    const written: string[] = [];
    const handlers: (() => void)[] = [];
    vi.spyOn(process, "once").mockImplementation(((
      event: string,
      handler: () => void
    ) => {
      // eslint-disable-next-line functional/immutable-data -- capturing is the mechanism
      if (event === "exit") handlers.push(handler);
      return process;
    }) as typeof process.once);

    armRefusalSummary(FAILURE, text => {
      // eslint-disable-next-line functional/immutable-data -- capturing is the mechanism
      written.push(text);
    });

    expect(written, "the line must be written at exit, not at arming").toEqual(
      []
    );

    handlers[0]?.();
    vi.restoreAllMocks();

    expect(written.join("")).toContain("NO VERDICT");
    expect(written.join("")).toContain(FAILURE);
  });

  it("arms nothing when the namespace is healthy", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "refusal-summary-ok-"));
    fs.mkdirSync(path.join(base, SCRATCH_NAMESPACE));
    process.env[SCRATCH_ROOT_ENV] = base;

    const handlers: (() => void)[] = [];
    vi.spyOn(process, "once").mockImplementation(((
      event: string,
      handler: () => void
    ) => {
      // eslint-disable-next-line functional/immutable-data -- capturing is the mechanism
      if (event === "exit") handlers.push(handler);
      return process;
    }) as typeof process.once);

    setup();

    expect(
      handlers,
      "a run that started normally must not announce a refusal when it ends"
    ).toEqual([]);

    fs.rmSync(base, { recursive: true, force: true });
  });
});

describe("a pool worker never arms a refusal", () => {
  // The defect this pins was committed by the fix above and measured in the
  // wild: ten consecutive green runs of 64 files each printed two
  // "❌ NO VERDICT" lines, because tests that call the real `setup` against an
  // overfull namespace left an exit handler behind in their worker. A passing
  // run reporting no verdict is the same lie as a killed run reporting FAILED.

  it("is running in a worker, which is what the guard keys off", () => {
    // Pins vitest's side of the contract, not ours. If `VITEST_POOL_ID` is ever
    // renamed, the guard silently stops guarding and the false line comes back
    // — this fails first and says why.
    expect(
      process.env[POOL_WORKER_ENV],
      "the guard distinguishes the globalSetup process from a test worker by " +
        "this marker; without it here, it cannot tell them apart"
    ).toBeDefined();
  });

  it("arms nothing from inside one, however bad the namespace is", () => {
    const handlers: (() => void)[] = [];
    vi.spyOn(process, "once").mockImplementation(((
      event: string,
      handler: () => void
    ) => {
      // eslint-disable-next-line functional/immutable-data -- capturing is the mechanism
      if (event === "exit") handlers.push(handler);
      return process;
    }) as typeof process.once);

    armRefusalSummary("A REFUSAL A TEST PROVOKED");

    vi.restoreAllMocks();

    expect(
      handlers,
      "a test that provokes a refusal must not make its own worker announce " +
        "one; the run it belongs to may be entirely green"
    ).toEqual([]);
  });
});
