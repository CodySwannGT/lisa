/**
 * What `lisa controls attest` does when it is told to stop
 * (CodySwannGT/lisa#4996).
 *
 * The run's temporary folder holds a copy of the repository with a planted
 * violation in it. A run that is interrupted must not leave it behind, and
 * must still end the way an interrupted process ends.
 * @module tests/unit/controls/attest-interruption
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PROCESS_SIGNALS,
  removeOnTermination,
  TERMINATION_SIGNALS,
} from "../../../src/controls/commands/attest-interruption.js";
import { removeScratch, scratchFolder } from "./support/proof-copy-run.js";
import {
  processSignalListeners,
  recordedSignals,
} from "./support/recorded-signals.js";

afterEach(() => {
  removeScratch();
});

describe("a signal that ends the run", () => {
  it.each(TERMINATION_SIGNALS)(
    "%s removes the folder, stops listening, and is sent on to end the process",
    signal => {
      const folder = scratchFolder();
      mkdirSync(path.join(folder, "clone"), { recursive: true });
      writeFileSync(path.join(folder, "clone", "planted.txt"), "violation\n");
      const signals = recordedSignals();
      const said: string[] = [];
      removeOnTermination(folder, { signals, say: line => said.push(line) });
      expect(signals.listeners()).toBe(TERMINATION_SIGNALS.length);

      signals.deliver(signal);

      expect(existsSync(folder)).toBe(false);
      expect(signals.listeners()).toBe(0);
      expect(signals.raised).toEqual([signal]);
      expect(said).toEqual([
        "attest: interrupted. The temporary copy the proofs ran in was removed. Your repository was not changed.",
      ]);
    }
  );

  it("is handled even before the folder exists", () => {
    const folder = scratchFolder();
    const signals = recordedSignals();
    removeOnTermination(folder, { signals, say: () => undefined });

    signals.deliver("SIGTERM");

    expect(existsSync(folder)).toBe(false);
    expect(signals.raised).toEqual(["SIGTERM"]);
  });

  it("is no longer listened for once the watch is released, however often", () => {
    const signals = recordedSignals();
    const watch = removeOnTermination(scratchFolder(), { signals });

    watch.release();
    watch.release();

    expect(signals.listeners()).toBe(0);
    expect(signals.raised).toEqual([]);
  });

  it("is listened for on the process itself by default, and no longer once released", () => {
    const before = processSignalListeners();

    const watch = removeOnTermination(scratchFolder());

    expect(processSignalListeners()).toBe(before + TERMINATION_SIGNALS.length);
    watch.release();
    expect(processSignalListeners()).toBe(before);
    expect(typeof PROCESS_SIGNALS.raise).toBe("function");
  });
});
