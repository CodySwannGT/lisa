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

import { SCRATCH_NAMESPACE } from "../../../src/configs/vitest/scratch.js";
import { withScratchAuthorityTestRoot } from "../../../src/configs/vitest/scratch-authority.js";
import {
  announceRefusal,
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
    // eslint-disable-next-line functional/immutable-data -- process env is the subject
    if (worker !== undefined) process.env[POOL_WORKER_ENV] = worker;
  });

  it("registers an exit hook that writes the summary line", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "refusal-summary-"));
    const namespace = path.join(base, SCRATCH_NAMESPACE);
    fs.mkdirSync(namespace, { mode: 0o700 });
    // Foreign names, so the sweep spares them on age and the only branch that
    // can fire is the ceiling — the same branch `scratch-refusal-order` uses.
    for (let i = 0; i <= MAX_NAMESPACE_ENTRIES; i += 1) {
      fs.mkdirSync(path.join(namespace, `filler-${String(i)}`));
    }

    // BOTH sinks are intercepted, because this block stands in for the main
    // process and the guard therefore lets a real announcement through. Left
    // alone, the banner lands in this run's transcript and the exit handler
    // arms this worker to print "❌ NO VERDICT" on a run that was never
    // refused — measured, one of each per run, which is the whole defect.
    const handlers: (() => void)[] = [];
    vi.spyOn(process, "once").mockImplementation(((
      event: string,
      handler: () => void
    ) => {
      // eslint-disable-next-line functional/immutable-data -- capturing is the mechanism
      if (event === "exit") handlers.push(handler);
      return process;
    }) as typeof process.once);

    const banner: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(chunk => {
      // eslint-disable-next-line functional/immutable-data -- capturing is the mechanism
      banner.push(String(chunk));
      return true;
    });

    expect(() => withScratchAuthorityTestRoot(base, () => setup())).toThrow(
      /without valid owner-marker authority/
    );

    // Restored before asserting, so a failure message can still reach the
    // terminal it is written for.
    vi.restoreAllMocks();

    expect(
      handlers,
      "nothing was armed for exit, so the transcript still ends in a stack " +
        "trace and the run reports no verdict at all"
    ).toHaveLength(1);
    expect(
      banner.join(""),
      "the banner is the other half of the same announcement and must still " +
        "reach the top of the transcript"
    ).toContain("REFUSED TO START");

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
    fs.mkdirSync(path.join(base, SCRATCH_NAMESPACE), { mode: 0o700 });

    const handlers: (() => void)[] = [];
    vi.spyOn(process, "once").mockImplementation(((
      event: string,
      handler: () => void
    ) => {
      // eslint-disable-next-line functional/immutable-data -- capturing is the mechanism
      if (event === "exit") handlers.push(handler);
      return process;
    }) as typeof process.once);

    withScratchAuthorityTestRoot(base, () => setup());

    expect(
      handlers,
      "a run that started normally must not announce a refusal when it ends"
    ).toEqual([]);

    fs.rmSync(base, { recursive: true, force: true });
  });
});

describe("a pool worker announces nothing", () => {
  // Both halves of an announcement outlive the call that makes them: the banner
  // is already on the run's stderr, and the summary is a handler that fires
  // whenever the process exits. Measured across ten consecutive green runs of
  // 64 files and 893 tests, exit 0 every time: two "TEST RUN REFUSED TO START"
  // banners each — shipped with #3027 — and, until this guard, two matching
  // "❌ NO VERDICT" lines that #3032's own first attempt at the fix added.
  //
  // A green run that says it was refused is the same lie as a killed gate that
  // says FAILED, and it is the one "repeated runs agree" trips over: two
  // readers of the same passing transcript can disagree about its verdict.

  it("is running in a worker, which is what the guard keys off", () => {
    // Pins vitest's side of the contract, not ours. If `VITEST_POOL_ID` is ever
    // renamed, the guard silently stops guarding and both false lines come back
    // — this fails first and says why.
    expect(
      process.env[POOL_WORKER_ENV],
      "the guard distinguishes the globalSetup process from a test worker by " +
        "this marker; without it here, it cannot tell them apart"
    ).toBeDefined();
  });

  it("writes no banner and arms no summary, however bad the namespace is", () => {
    const handlers: (() => void)[] = [];
    vi.spyOn(process, "once").mockImplementation(((
      event: string,
      handler: () => void
    ) => {
      // eslint-disable-next-line functional/immutable-data -- capturing is the mechanism
      if (event === "exit") handlers.push(handler);
      return process;
    }) as typeof process.once);

    const notices: string[] = [];
    announceRefusal("A REFUSAL A TEST PROVOKED", text => {
      // eslint-disable-next-line functional/immutable-data -- capturing is the mechanism
      notices.push(text);
    });

    vi.restoreAllMocks();

    expect(
      notices,
      "a test that provokes a refusal must not put a refusal banner in its " +
        "own run's transcript; that run may be entirely green"
    ).toEqual([]);
    expect(
      handlers,
      "and it must not make its own worker announce one on the way out either"
    ).toEqual([]);
  });
});

describe("announceRefusal from the process that may refuse", () => {
  const worker = process.env[POOL_WORKER_ENV];

  beforeEach(() => {
    // eslint-disable-next-line functional/immutable-data -- process env is the subject
    delete process.env[POOL_WORKER_ENV];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // eslint-disable-next-line functional/immutable-data -- process env is the subject
    if (worker !== undefined) process.env[POOL_WORKER_ENV] = worker;
  });

  it("speaks at both ends — banner now, summary at exit", () => {
    const handlers: (() => void)[] = [];
    vi.spyOn(process, "once").mockImplementation(((
      event: string,
      handler: () => void
    ) => {
      // eslint-disable-next-line functional/immutable-data -- capturing is the mechanism
      if (event === "exit") handlers.push(handler);
      return process;
    }) as typeof process.once);

    const notices: string[] = [];
    announceRefusal(FAILURE, text => {
      // eslint-disable-next-line functional/immutable-data -- capturing is the mechanism
      notices.push(text);
    });

    vi.restoreAllMocks();

    expect(notices.join("")).toContain("REFUSED TO START");
    expect(notices.join("")).toContain(FAILURE);
    expect(
      handlers,
      "the banner alone leaves the transcript ending in a stack trace"
    ).toHaveLength(1);
  });
});
