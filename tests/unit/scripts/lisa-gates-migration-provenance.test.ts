/**
 * The registry must describe the shipped migration hook as it now behaves.
 *
 * Since 2026-11-08 (operator decision) `block-migration-edits` warns and
 * permits instead of refusing; a declared `migration-provenance` task at
 * `pre-tool` still decides. The `inventory` and `explain` commands print these
 * strings to operators, so a registry that still said "refuse" would tell a
 * project its migrations are blocked when they are not.
 *
 * The strings are evaluated while the module LOADS, and per-test mutation
 * coverage credits load-time code to whichever test imported the module first.
 * So every case loads a fresh copy inside its own body, the same way
 * `lisa-gates-builtin-contract` does, which lets the mutation gate run it
 * against each mutated literal.
 * @module tests/unit/scripts/lisa-gates-migration-provenance
 */
import { describe, expect, it, vi } from "vitest";

/** The fields of one hardcoded invocation this suite reads. */
interface Invocation {
  readonly gate: string;
  readonly surface: string;
  readonly artifact: string;
  readonly command: string;
}

/** The registry fields this suite reads. */
interface Registry {
  readonly HARDCODED_INVOCATIONS: readonly Invocation[];
  readonly REGISTRY: Readonly<
    Record<string, { readonly declareOnly?: string }>
  >;
}

/**
 * Loads a fresh copy of the gate registry.
 * @returns The module's exports
 */
async function freshRegistry(): Promise<Registry> {
  vi.resetModules();
  return (await import("../../../all/copy-overwrite/scripts/lisa-gates.mjs")) as unknown as Registry;
}

/**
 * The migration hook entries on the pre-tool hook surface.
 * @param registry - A freshly loaded registry
 * @returns Its migration-provenance hook invocations
 */
function migrationHooks(registry: Registry): readonly Invocation[] {
  return registry.HARDCODED_INVOCATIONS.filter(
    entry =>
      entry.gate === "migration-provenance" &&
      entry.surface === "pre-tool-refusal-hook"
  );
}

describe("migration-provenance registry text", () => {
  it("describes the Claude hook as a warning that permits", async () => {
    const claude = migrationHooks(await freshRegistry()).find(
      entry =>
        entry.artifact === "plugins/src/nestjs/hooks/block-migration-edits.sh"
    );
    expect(claude?.command).toBe(
      "warn on (permit) any write matching */migrations/*.ts|*/migrations/*.js"
    );
  });

  it("describes the Codex hook as a warning that permits", async () => {
    const codex = migrationHooks(await freshRegistry()).find(
      entry => !entry.artifact.startsWith("plugins/")
    );
    expect(codex?.command).toBe(
      "warn on (permit) any write matching */migrations/*[0-9]*-*.ts"
    );
  });

  it("tells operators the hook only warns and a declared check decides", async () => {
    const gate = (await freshRegistry()).REGISTRY["migration-provenance"];
    expect(gate?.declareOnly).toContain(
      "The shipped agent hook only warns on a hand-edit and permits it"
    );
    expect(gate?.declareOnly).toContain(
      "declaring this gate at `pre-tool` makes your own check decide (non-zero refuses)"
    );
    expect(gate?.declareOnly).not.toContain("refuses the hand-edit outright");
  });
});
