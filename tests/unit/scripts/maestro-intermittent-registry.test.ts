/**
 * Tests for the known-intermittent registry that ships beside the Maestro flake
 * classifier.
 *
 * One rule is doing all the work here, and every case exists to hold it: an
 * entry that does not carry a MEASURED rate — real failure and run counts, the
 * date they were taken, and the methodology behind them — is reported as a
 * defect and annotates nothing. An unmeasured "known flake" entry is exactly
 * how a real regression gets waved off, so a claim with no measurement behind
 * it must have no power to excuse a failure.
 *
 * The shipped template `expo/create-only/.maestro/flake-classification.json` is
 * checked too: it must ship EMPTY, because a starter registry with borrowed
 * entries would let a fresh project dismiss failures it has never measured.
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  ANDROID,
  assertionFor,
  type ClassifierModule,
  failingReport,
  FLAKY_FLOW,
  loadClassifier,
  MEASURED_ENTRY,
  PRODUCT,
  reader,
} from "./maestro-flake-helpers";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const TEMPLATE_REL = "expo/create-only/.maestro/flake-classification.json";
const FLAKY_REPORT = failingReport(
  `.maestro/flows/${FLAKY_FLOW}`,
  30,
  assertionFor("saved:unsave-confirm")
);

let mod: ClassifierModule;

beforeAll(async () => {
  mod = await loadClassifier();
});

describe("registry validation", () => {
  it("accepts an entry carrying measured counts and a methodology", () => {
    const verdict = mod.validateIntermittentRegistry([MEASURED_ENTRY]);
    expect(verdict.defects).toEqual([]);
    expect(verdict.entries).toHaveLength(1);
    expect(verdict.entries[0]?.flow).toBe(FLAKY_FLOW);
  });

  it("rejects an entry with no measured rate", () => {
    const verdict = mod.validateIntermittentRegistry([
      { flow: "flaky.yaml", platforms: [ANDROID] },
    ]);
    expect(verdict.entries).toEqual([]);
    expect(verdict.defects).toHaveLength(1);
    expect(verdict.defects[0]?.reason).toMatch(/measured/i);
  });

  it("rejects an entry whose methodology is a placeholder", () => {
    const verdict = mod.validateIntermittentRegistry([
      {
        ...MEASURED_ENTRY,
        measured: { ...MEASURED_ENTRY.measured, method: "unknown" },
      },
    ]);
    expect(verdict.entries).toEqual([]);
    expect(verdict.defects[0]?.reason).toMatch(/method/i);
  });

  it("rejects an entry claiming a rate it never observed failing", () => {
    const verdict = mod.validateIntermittentRegistry([
      {
        ...MEASURED_ENTRY,
        measured: { ...MEASURED_ENTRY.measured, failures: 0 },
      },
    ]);
    expect(verdict.entries).toEqual([]);
    expect(verdict.defects[0]?.reason).toMatch(/failure/i);
  });

  it("rejects more failures than runs", () => {
    const verdict = mod.validateIntermittentRegistry([
      {
        ...MEASURED_ENTRY,
        measured: { ...MEASURED_ENTRY.measured, failures: 9, runs: 7 },
      },
    ]);
    expect(verdict.entries).toEqual([]);
    expect(verdict.defects).toHaveLength(1);
  });

  it("rejects an entry with no measurement date", () => {
    const verdict = mod.validateIntermittentRegistry([
      {
        ...MEASURED_ENTRY,
        measured: { ...MEASURED_ENTRY.measured, measuredAt: "recently" },
      },
    ]);
    expect(verdict.entries).toEqual([]);
    expect(verdict.defects[0]?.reason).toMatch(/measuredAt/);
  });
});

describe("annotation", () => {
  it("annotates a matching product failure with the measured rate", () => {
    const [result] = mod.classify(FLAKY_REPORT, {
      maestroRoot: "/m",
      readFile: reader({}),
      knownIntermittent: [MEASURED_ENTRY],
      platform: ANDROID,
    });
    expect(result?.kind).toBe(PRODUCT);
    expect(result?.intermittent?.failures).toBe(2);
    expect(result?.intermittent?.runs).toBe(7);
    expect(result?.intermittent?.ratePercent).toBe(28.6);
    expect(result?.intermittent?.ticket).toBe("TUN-560");
  });

  it("does not annotate a platform the entry was never measured on", () => {
    const [result] = mod.classify(FLAKY_REPORT, {
      maestroRoot: "/m",
      readFile: reader({}),
      knownIntermittent: [MEASURED_ENTRY],
      platform: "ios",
    });
    expect(result?.intermittent).toBeNull();
  });

  it("never annotates from an invalid entry — an unmeasured claim suppresses nothing", () => {
    const [result] = mod.classify(
      failingReport(".maestro/flows/flaky.yaml", 30, assertionFor("a:b")),
      {
        maestroRoot: "/m",
        readFile: reader({}),
        knownIntermittent: [{ flow: "flaky.yaml", platforms: [ANDROID] }],
        platform: ANDROID,
      }
    );
    expect(result?.intermittent).toBeNull();
  });
});

describe("shipped template", () => {
  it("ships an empty registry with the contract spelled out beside it", () => {
    const template = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, TEMPLATE_REL), "utf-8")
    ) as Record<string, unknown>;
    expect(template.knownIntermittent).toEqual([]);
    expect(Array.isArray(template.signInMarkers)).toBe(true);
    expect(String(template._knownIntermittent)).toMatch(/measured/i);
  });

  it("keeps the template's own example entry valid against the validator", () => {
    // A documented example that the validator would reject teaches the wrong
    // shape, and the first person to copy it gets a silent no-op.
    const template = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, TEMPLATE_REL), "utf-8")
    ) as Record<string, unknown>;
    const verdict = mod.validateIntermittentRegistry([template._exampleEntry]);
    expect(verdict.defects).toEqual([]);
    expect(verdict.entries).toHaveLength(1);
  });
});
