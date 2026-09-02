/**
 * Tests for the order gates run in at a single moment.
 *
 * Order among independent gates is arbitrary, with exactly one exception: a
 * gate that rewrites the working tree invalidates every verdict already reached
 * about it. These assert that exception holds, and they assert it on the
 * ordering itself rather than on whether some later gate passed — a fix that
 * merely stopped a downstream check complaining would satisfy an exit-code
 * assertion while leaving verdicts describing a tree that was discarded.
 * @module tests/unit/scripts/lisa-gates-order
 */

import { describe, expect, it } from "vitest";

import {
  REGISTRY,
  resolveMoment,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

describe("execution order", () => {
  /**
   * The regression this exists for, replayed exactly.
   *
   * Gates ran alphabetically, so `artifact-freshness` verified a generated
   * manifest, `code-style` then ran `lint:staged`, and prettier reformatted the
   * sources that manifest hashes. The commit landed with the freshness gate
   * reporting PASSED about bytes that were no longer the bytes committed.
   *
   * Asserting on order rather than on a later gate's exit code is the point: a
   * fix that merely stopped the manifest check complaining would satisfy an
   * exit-code assertion while leaving verdicts describing a discarded tree.
   */
  it("runs a rewriting gate before the gates that verify the tree", () => {
    const order = resolveMoment({
      gates: {
        "artifact-freshness": { commit: "required" },
        "code-style": { commit: { level: "required", run: "lint:staged" } },
        "structural-rules": { commit: "required" },
      },
      moment: "commit",
    }).map(gate => gate.id);

    expect(order.indexOf("code-style")).toBeLessThan(
      order.indexOf("artifact-freshness")
    );
    expect(order).toEqual([
      "code-style",
      "artifact-freshness",
      "structural-rules",
    ]);
  });

  it("holds for every moment of every gate the registry declares", () => {
    // A gate added later with a --fix task inherits the guarantee only if the
    // rule is general, so assert the property rather than one arrangement.
    for (const moment of ["commit", "push", "pull-request"]) {
      const gates = Object.fromEntries(
        Object.entries(REGISTRY)
          .filter(([, definition]) => definition.moments.includes(moment))
          .map(([id]) => [id, { [moment]: "required" }])
      );
      const resolved = resolveMoment({ gates, moment });
      const lastRewriter = resolved.findLastIndex(gate => gate.mayRewrite);
      const firstVerifier = resolved.findIndex(gate => !gate.mayRewrite);
      expect(resolved.length, moment).toBeGreaterThan(1);
      expect(lastRewriter, moment).toBeLessThan(firstVerifier);
    }
  });

  /**
   * The second ordering rule, and the reason it is not a preference.
   *
   * A push refused for something knowable from the commit range in
   * milliseconds used to pay the whole ~20-minute suite before being told,
   * because `traceability` sorts after `test-*` in the alphabet and nothing
   * else decided the order. The alphabet was never a statement about cost.
   */
  it("runs the cheap gates before the costly ones", () => {
    const order = resolveMoment({
      gates: {
        traceability: { push: "required" },
        "test-correctness": { push: "required" },
        "test-integration": { push: "required" },
        "type-correctness": { push: "required" },
      },
      moment: "push",
    }).map(gate => gate.id);
    expect(order).toEqual([
      "traceability",
      "type-correctness",
      "test-correctness",
      "test-integration",
    ]);
  });

  it("puts every costly gate after every cheap one, at every moment", () => {
    // The property, not one arrangement: a gate marked `costly` later inherits
    // the guarantee only if the rule is general.
    for (const moment of ["commit", "push", "pull-request"]) {
      const gates = Object.fromEntries(
        Object.entries(REGISTRY)
          .filter(([, definition]) => definition.moments.includes(moment))
          .map(([id]) => [id, { [moment]: "required" }])
      );
      const resolved = resolveMoment({ gates, moment }).filter(
        gate => !gate.mayRewrite
      );
      const lastCheap = resolved.findLastIndex(gate => !gate.costly);
      const firstCostly = resolved.findIndex(gate => gate.costly);
      if (firstCostly === -1) continue;
      expect(firstCostly, moment).toBeGreaterThan(lastCheap);
    }
  });

  it("keeps ordering stable when nothing rewrites", () => {
    const order = resolveMoment({
      gates: {
        "type-correctness": { push: "required" },
        "dead-code": { push: "required" },
      },
      moment: "push",
    }).map(gate => gate.id);
    expect(order).toEqual(["dead-code", "type-correctness"]);
  });
});
