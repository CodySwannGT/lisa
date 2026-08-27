/**
 * Guards the ORDER in which a refused run explains itself.
 *
 * Split out of `vitest-scratch.test.ts` only because that file is at its
 * max-lines budget; the subject is the same guard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { SCRATCH_NAMESPACE } from "../../../src/configs/vitest/scratch.js";
import { withProcessPlatformTempRoot } from "../../helpers/template-toolchain.js";
import {
  MAX_NAMESPACE_ENTRIES,
  POOL_WORKER_ENV,
  renderRefusalNotice,
  setup,
} from "../../../src/configs/vitest/scratch-global-setup.js";

describe("a refusal is announced before it is thrown", () => {
  // The throw alone was measured to arrive 392 lines BELOW the verdict, under a
  // 0%-across-the-board coverage table, on a run whose first line reads "No test
  // files found". The guard bit correctly and was presented as a coverage
  // failure. What is pinned here is the ORDER: the reason is emitted at the
  // moment of refusal, from a hook that runs before collection, so it precedes
  // every line Vitest goes on to print.

  const worker = process.env[POOL_WORKER_ENV];

  beforeEach(() => {
    // Only the process vitest runs `globalSetup` in may announce a refusal, and
    // that is the one without this marker. A test lives in a worker, so it has
    // to stand in for the main process deliberately — the alternative is what
    // was measured before the guard: two "TEST RUN REFUSED TO START" banners in
    // the transcript of every green run (CodySwannGT/lisa#3032).
    delete process.env[POOL_WORKER_ENV];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (worker !== undefined) process.env[POOL_WORKER_ENV] = worker;
  });

  it("names the refusal and says the zeroes below it are not a measurement", () => {
    const notice = renderRefusalNotice("NAMESPACE HELD 600 ENTRIES");

    expect(notice).toContain("NAMESPACE HELD 600 ENTRIES");
    expect(notice).toContain("REFUSED TO START");
    expect(notice).toContain("NOT a coverage failure");
    expect(
      notice,
      "an operator reading a 0% table needs to be told it measured nothing, " +
        "because 0% otherwise reads as a verdict on the code"
    ).toContain("No test ran");
  });

  it("writes the reason to stderr before the throw that ends the run", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "refusal-order-"));
    const namespace = path.join(base, SCRATCH_NAMESPACE);
    fs.mkdirSync(namespace, { mode: 0o700 });
    // Foreign names, so the sweep spares them on age and the ONLY branch that
    // can fire is the ceiling — the branch Arm B run 8 of #2883 hit.
    for (let i = 0; i <= MAX_NAMESPACE_ENTRIES; i += 1) {
      fs.mkdirSync(path.join(namespace, `filler-${String(i)}`));
    }

    const written: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(chunk => {
      written.push(String(chunk));
      return true;
    });
    // The announcement has a second half — an exit handler that writes the
    // summary line. Allowed through, it arms THIS worker to announce a refusal
    // when it exits, on a run that was never refused. Intercepted here for the
    // same reason the banner is: neither belongs in this run's transcript.
    vi.spyOn(process, "once").mockImplementation(
      (() => process) as typeof process.once
    );

    expect(() => withProcessPlatformTempRoot(base, () => setup())).toThrow(
      /without valid owner-marker authority/
    );

    // Restored before asserting, so a failure message can still reach the
    // terminal it is written for.
    vi.restoreAllMocks();

    expect(
      written.join(""),
      "the run failed without announcing why, so the reason lands below the " +
        "coverage report again and the refusal reads as a coverage failure"
    ).toContain("NOT a coverage failure");
    expect(written.join("")).toContain("without valid owner-marker authority");

    fs.rmSync(base, { recursive: true, force: true });
  });
});
