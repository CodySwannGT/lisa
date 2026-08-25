/**
 * The two `PreToolUse` refusal hooks must be IN the hardcoded-invocation
 * inventory, on every surface that ships them.
 *
 * They were absent from it entirely until #3007, and the reason is the same
 * one that left them unwired: the population the inventory was kept true
 * against was globbed as `-on-edit.sh`, which is a naming convention and not a
 * moment. Two shipped hooks fired on the same write boundary without that
 * suffix, so `unconfigured --moment=pre-tool` was SILENT about them rather than
 * reporting them as ungoverned — and silence is indistinguishable from nothing
 * to report, which is the failure mode the table exists to remove.
 *
 * Derived in both directions, so a refusal hook added to a new stack tomorrow
 * fails here rather than joining the population unnoticed.
 *
 * @module tests/integration/pre-tool-refusal-inventory
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import {
  EDIT_TIME_MANIFESTS,
  PRE_TOOL_REFUSAL_SURFACE,
  REPO_ROOT,
  loadGates,
  read,
  registeredEditTimeEvents,
} from "./hardcoded-invocation-fixture.js";
import type { GatesModule } from "./hardcoded-invocation-fixture.js";

let gates: GatesModule;

beforeAll(async () => {
  gates = await loadGates();
});

describe("the pre-tool refusal hooks", () => {
  it("records every shipped source copy, on both agent surfaces", () => {
    // DERIVED in both directions. The plugin-side names come from the
    // manifests — the moment, not a filename suffix — and the Codex names
    // from the hook catalog. Neither is written down here, so a refusal hook
    // added to a new stack tomorrow fails this rather than joining the
    // population silently.
    const plugin = [...registeredEditTimeEvents().entries()]
      .filter(([, event]) => event === "PreToolUse")
      .map(([name]) => name);
    const shipped = [
      ...plugin.flatMap(name =>
        EDIT_TIME_MANIFESTS.map(
          manifest => `${path.dirname(path.dirname(manifest))}/hooks/${name}`
        ).filter(candidate => fs.existsSync(path.join(REPO_ROOT, candidate)))
      ),
      ...plugin.map(name => `src/codex/scripts/${name}`),
    ];
    const recorded = new Set(
      gates.HARDCODED_INVOCATIONS.filter(
        entry => entry.surface === PRE_TOOL_REFUSAL_SURFACE
      ).map(entry => entry.artifact)
    );
    const byName = (left: string, right: string): number =>
      left.localeCompare(right);

    expect(plugin.length).toBeGreaterThan(0);
    expect([...new Set(shipped)].sort(byName)).toEqual(
      [...recorded].sort(byName)
    );
  });

  it("classifies them consults-then-falls-back, and they really do consult", () => {
    // The half a classification cannot assert about itself. #3007 flipped
    // these from reading no declaration at all; grepping the artifact is what
    // stops the table from describing a wiring that was reverted.
    const entries = gates.HARDCODED_INVOCATIONS.filter(
      entry => entry.surface === PRE_TOOL_REFUSAL_SURFACE
    );

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.facade).toBe("consults-then-falls-back");
      expect(read(entry.artifact)).toMatch(/lisa_edit_gate_tasks/);
    }
  });

  it("records a moment a declaration IS legal at", () => {
    // Both gates are `PRE_TOOL_ONWARD` in the registry, so `pre-tool` is a
    // moment a project may actually declare at. An entry recording a moment
    // its gate forbids would make the shipped `inventory` command print
    // "NOT DECLARABLE AT THIS MOMENT" about enforcement a project can in
    // fact take over.
    for (const entry of gates.HARDCODED_INVOCATIONS.filter(
      candidate => candidate.surface === PRE_TOOL_REFUSAL_SURFACE
    )) {
      expect(entry.moment).toBe("pre-tool");
      expect(gates.isDeclarableAt(entry.gate, entry.moment)).toBe(true);
    }
  });
});
