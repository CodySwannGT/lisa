import { describe, expect, it } from "vitest";
import {
  invariantFingerprint,
  parseEffectiveness,
  summarizeEffectiveness,
  type EffectivenessObservation,
} from "../../../src/utils/effectiveness.js";

export const OBSERVATION: EffectivenessObservation = {
  schema: 1,
  lisaVersion: "4.62.3",
  workerConfigRevision: "revision-1",
  workerWallMs: 1000,
  feedbackMs: [100, 300, 200],
  workerSource: "runtime:run-1",
  attention: [{ id: "comment-1", source: "tracker:comment-1" }],
  readyAt: "2026-09-16T12:00:00.000Z",
  acceptedAt: "2026-09-16T12:01:00.000Z",
  lifecycleSources: ["tracker:ready-1", "tracker:accepted-1"],
  reworkSources: null,
};

describe("effectiveness observations", () => {
  it("uses the gardener's normalized invariant fingerprint", () => {
    expect(invariantFingerprint("  Keep\n  Evidence ")).toBe(
      invariantFingerprint("keep evidence")
    );
    expect(invariantFingerprint("keep evidence")).toMatch(/^[a-f0-9]{12}$/u);
  });

  it("separates feedback distribution from wall and delivery clocks", () => {
    const result = summarizeEffectiveness(OBSERVATION);
    expect(result.feedback).toEqual({
      count: 3,
      minMs: 100,
      medianMs: 200,
      p95Ms: 300,
      maxMs: 300,
    });
    expect(result.workerWallMs).toBe(1000);
    expect(result.readyToAcceptedMs).toBe(60000);
    expect(result.humanInterventions).toBe(1);
  });

  it("preserves unknown versus measured zero", () => {
    const observation = {
      ...OBSERVATION,
      feedbackMs: null,
      workerWallMs: null,
      attention: null,
      readyAt: null,
    };
    expect(summarizeEffectiveness(observation)).toMatchObject({
      feedback: null,
      workerWallMs: null,
      humanInterventions: null,
      readyToAcceptedMs: null,
    });
    expect(
      summarizeEffectiveness({ ...OBSERVATION, feedbackMs: [], attention: [] })
    ).toMatchObject({
      feedback: { count: 0, minMs: null },
      humanInterventions: 0,
    });
  });

  it.each([
    { workerWallMs: -1 },
    { feedbackMs: [Number.NaN] },
    { workerSource: null },
    { attention: [{ id: "a", source: "" }] },
    { acceptedAt: "2026-09-15T00:00:00.000Z" },
    { acceptedAt: "yesterday" },
    { schema: 2 },
    { inventedMinutes: 12 },
  ])("rejects malformed or unsourced measurements: %j", invalid => {
    expect(() => parseEffectiveness({ ...OBSERVATION, ...invalid })).toThrow();
  });

  it("does not turn duplicate human evidence into extra attention", () => {
    expect(
      summarizeEffectiveness({
        ...OBSERVATION,
        attention: [...OBSERVATION.attention!, ...OBSERVATION.attention!],
      }).humanInterventions
    ).toBe(1);
  });
});
