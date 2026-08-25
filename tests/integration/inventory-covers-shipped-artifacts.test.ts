/**
 * The inventory has to cover every shipped artifact with a written-in
 * invocation — not just the ones the first sweep happened to look at.
 *
 * `hardcoded-invocation-inventory` derives its population from two named
 * templates and two plugin hook directories. Three shipped populations fell
 * outside that scope and were therefore absent from the table while the suite
 * reported it exhaustive:
 *
 *   * `typescript/copy-contents/.husky/pre-commit` — three `lisa_gate_covers`
 *     sites guarding five properties, each with a written-in else branch, and
 *     not one `commit`-moment entry anywhere in the inventory;
 *   * the four Codex copies of the on-edit scripts, which unlike the fifteen
 *     generated per-agent copies DIFFER from their originals;
 *   * `phaser/copy-overwrite/.husky/pre-push.verify`, sourced by the pre-push
 *     hook and consulting nothing at all.
 *
 * This is the failure mode the inventory's own header warns about — "a
 * `lisa_gate_covers` call with no entry is a gap the inventory silently omits"
 * — reproduced in the scope the sweep chose. Every derivation here runs in
 * BOTH directions, so a new artifact with no entry fails and an entry for an
 * artifact that is gone fails too.
 *
 * @module tests/integration/inventory-covers-shipped-artifacts
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { EDIT_TIME_HOOK_SCRIPTS } from "../../src/codex/hooks-installer.js";
import { loadGates, read, REPO_ROOT } from "./hardcoded-invocation-fixture.js";
import type { GatesModule } from "./hardcoded-invocation-fixture.js";

let gates: GatesModule;

beforeAll(async () => {
  gates = await loadGates();
});

/** The shipped pre-commit hook template, repository-relative. */
const PRE_COMMIT_HOOK = "typescript/copy-contents/.husky/pre-commit";

/** The `pre-commit-hook` surface name, as the shipped table spells it. */
const PRE_COMMIT_SURFACE = "pre-commit-hook";

/** Where the shipped `.husky` pre-push extensions live. */
const PRE_PUSH_VERIFY_DIR = "phaser/copy-overwrite/.husky";

/** The call the hooks use to hand a property over to a declaration. */
const GATE_COVERS = /^(?:if )?lisa_gate_covers ([a-z0-9 -]+); then$/gm;

/** Anything that would make a script consult a declaration at all. */
const CONSULTS = /lisa_gate_covers|lisa-run-gates|lisa-gates/;

/**
 * Alphabetical order both sides of every comparison are put into.
 * @param left One id.
 * @param right The other.
 * @returns Negative, zero or positive, per `localeCompare`.
 */
const byName = (left: string, right: string): number =>
  left.localeCompare(right);

/**
 * The gate ids recorded against one surface.
 * @param surface The surface name, as the shipped table spells it.
 * @returns The gate ids.
 */
const recordedOn = (surface: string): Set<string> =>
  new Set(
    gates.HARDCODED_INVOCATIONS.filter(entry => entry.surface === surface).map(
      entry => entry.gate
    )
  );

describe("the pre-commit hook", () => {
  it("records every property the hook hands over", () => {
    // Same derivation as the pre-push hook, over the file that had NO
    // commit-moment entries at all.
    const hook = read(PRE_COMMIT_HOOK);
    const covered = [
      ...new Set(
        [...hook.matchAll(GATE_COVERS)].flatMap(hit =>
          (hit[1] ?? "").split(" ")
        )
      ),
    ];
    const recorded = recordedOn(PRE_COMMIT_SURFACE);

    expect(covered.length).toBeGreaterThan(0);
    expect(covered.filter(gate => !recorded.has(gate))).toEqual([]);
    // And the other direction: an entry for a property the hook no longer
    // hands over reports a gap that does not exist.
    expect([...recorded].filter(gate => !covered.includes(gate))).toEqual([]);
  });

  it("records the shared invocation once per property it proves", () => {
    // `lint-staged` runs oxlint/eslint, prettier and `ast-grep scan` in ONE
    // pass, which is why the hook stands down only when all three are
    // declared. An inventory naming one of them would report the other two as
    // not running — the same defect the Rails on-edit hook had.
    const shared = gates.HARDCODED_INVOCATIONS.filter(
      entry =>
        entry.surface === PRE_COMMIT_SURFACE &&
        entry.command.includes("lint-staged")
    ).map(entry => entry.gate);

    expect([...shared].sort(byName)).toEqual([
      "code-style",
      "format-conformance",
      "structural-rules",
    ]);
    expect(read(PRE_COMMIT_HOOK)).toContain(
      "lisa_gate_covers code-style format-conformance structural-rules"
    );
  });

  it("records the moment the hook actually runs at", () => {
    for (const entry of gates.HARDCODED_INVOCATIONS.filter(
      candidate => candidate.surface === PRE_COMMIT_SURFACE
    )) {
      expect(entry.moment).toBe("commit");
    }
  });
});

describe("the sourced pre-push extensions", () => {
  it("records every shipped .husky extension with a written-in invocation", () => {
    // DERIVED. `pre-push.verify` was outside every sweep the inventory ran:
    // the pre-push derivation reads one named template, and the on-edit
    // derivation reads hook directories. A second extension added tomorrow
    // has to fail here rather than join the population silently.
    const shipped = fs
      .readdirSync(path.join(REPO_ROOT, PRE_PUSH_VERIFY_DIR))
      .filter(name => name.endsWith(".verify"))
      .map(name => `${PRE_PUSH_VERIFY_DIR}/${name}`);
    const recorded = new Set(
      gates.HARDCODED_INVOCATIONS.filter(entry =>
        entry.artifact.endsWith(".verify")
      ).map(entry => entry.artifact)
    );

    expect(shipped.length).toBeGreaterThan(0);
    expect(shipped.filter(file => !recorded.has(file))).toEqual([]);
    expect([...recorded].filter(file => !shipped.includes(file))).toEqual([]);
  });

  it("classifies it never-consults, and it really does consult nothing", () => {
    for (const entry of gates.HARDCODED_INVOCATIONS.filter(candidate =>
      candidate.artifact.endsWith(".verify")
    )) {
      expect(entry.facade).toBe("never-consults");
      expect(read(entry.artifact)).not.toMatch(CONSULTS);
    }
  });
});

describe("the Codex copies of the edit-time scripts", () => {
  it("records them separately from the plugins/src originals", () => {
    // The generated per-agent copies are byte-identical to their originals and
    // so fairly represented by them. These are not: they DIFFER, and
    // representing them by the originals would describe a file that is not the
    // one that runs.
    //
    // The population comes from the hook CATALOG, not from a filename suffix.
    // It was globbed as `-on-edit.sh` until #3007 — a naming convention rather
    // than a moment — so the two `PreToolUse` refusal scripts fired on the same
    // write boundary and were invisible to this control while it reported the
    // Codex surface exhaustively covered.
    const shipped = EDIT_TIME_HOOK_SCRIPTS.map(
      name => `src/codex/scripts/${name}`
    );
    // The derivation must produce something, or every assertion below passes
    // by comparing two empty lists.
    expect(shipped.length).toBeGreaterThan(0);
    for (const file of shipped) {
      expect(fs.existsSync(path.join(REPO_ROOT, file)), file).toBe(true);
    }
    const recorded = new Set(
      gates.HARDCODED_INVOCATIONS.filter(entry =>
        entry.artifact.startsWith("src/codex/scripts/")
      ).map(entry => entry.artifact)
    );

    expect(shipped.length).toBeGreaterThan(0);
    expect(shipped.filter(file => !recorded.has(file))).toEqual([]);
    expect([...recorded].filter(file => !shipped.includes(file))).toEqual([]);
  });

  it("differs from the original it would otherwise be represented by", () => {
    // The premise of recording them separately, as an executable claim. If a
    // copy becomes byte-identical to its original this fails, and the entry
    // should then be reconsidered rather than kept out of habit.
    expect(read("src/codex/scripts/lint-on-edit.sh")).not.toBe(
      read("plugins/src/typescript/hooks/lint-on-edit.sh")
    );
  });

  it("consults the declaration, exactly like the originals", () => {
    // These four were the last surface with no configurability at all, and
    // they differ from their originals — so "the originals consult, therefore
    // these do" is not an argument that holds here. Asserted directly.
    for (const entry of gates.HARDCODED_INVOCATIONS.filter(candidate =>
      candidate.artifact.startsWith("src/codex/scripts/")
    )) {
      expect(entry.facade).toBe("consults-then-falls-back");
      expect(read(entry.artifact)).toMatch(/lisa_edit_gate_tasks/);
    }
  });
});
