/**
 * Every check that fires on the agent tool boundary is declarable at the moment
 * it actually fires.
 *
 * Measured defect (CodySwannGT/lisa#2839): seven Lisa-shipped scripts enforce on
 * every agent write — the highest-frequency surface Lisa owns — and **zero** of
 * the registry's gates listed `pre-tool` in their `moments`. The moment existed
 * on the axis, the validator accepted it, and no gate could be declared at it.
 * Enforcement without a declaration, which `list`, `validate`, `contextsFor` and
 * `lisa doctor` all reported as a fully-governed project.
 *
 * Two halves are pinned here, and the second is the one that keeps being got
 * wrong.
 *
 * **The roster is derived.** It comes from the shipped hook manifests, so a
 * script registered tomorrow joins these assertions with no test edited. The
 * script-to-property mapping below is a table because the scripts carry no
 * marker naming their gate yet — but the table is asserted EXHAUSTIVE against
 * the derived roster, so an unmapped script fails here rather than sitting
 * silently outside the check.
 *
 * **The moment comes from the registration, not from an assumption.** The
 * boundary is two moments: `pre-tool` fires before the write and can refuse it;
 * `post-tool` fires after and cannot. Of the seven scripts, five are registered
 * `PostToolUse` and two `PreToolUse`. Reading all seven as `pre-tool` is the
 * error this file exists to catch — it declares five post-write checks at a
 * moment whose contract promises the write can still be refused, and an
 * operator who declares one there gets a refusal from `validate` for a line the
 * report told them to add.
 * @module tests/unit/scripts/lisa-gates-tool-moments
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MOMENTS,
  REGISTRY,
  validateGates,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { cleanGitEnv, resolveGit } from "../../support/git-executable.js";

const ROOT = process.cwd();
const GIT = resolveGit();

/**
 * The moment each tool-boundary event corresponds to.
 *
 * Both spellings ship: Codex manifests use `PreToolUse`, Cursor manifests use
 * `preToolUse`, and a check that knew only one would silently skip a whole
 * agent surface.
 */
const EVENT_MOMENTS: Readonly<Record<string, string>> = {
  pretooluse: "pre-tool",
  posttooluse: "post-tool",
};

/**
 * What each shipped edit-boundary script proves.
 *
 * A table, because the scripts name no gate themselves — wiring them through
 * the façade is the other half of #2839. It is asserted exhaustive below, so it
 * cannot quietly fall behind the roster.
 */
const PROVES: Readonly<Record<string, readonly string[]>> = {
  "lint-on-edit.sh": ["code-style"],
  "format-on-edit.sh": ["format-conformance"],
  "sg-scan-on-edit.sh": ["structural-rules"],
  // One invocation, two properties: its own header says "RuboCop serves as both
  // formatter and linter", so it may stand down only when both are covered.
  "rubocop-on-edit.sh": ["code-style", "format-conformance"],
  "block-suppress-directives.sh": ["suppression-residue"],
  "block-migration-edits.sh": ["migration-provenance"],
};

/** One shipped registration of one script at one moment. */
interface Registration {
  readonly manifest: string;
  readonly script: string;
  readonly moment: string;
}

/**
 * Every command a manifest node registers, whatever its shape.
 *
 * Codex nests `{ matcher, hooks: [{ command }] }`; Cursor puts `command`
 * directly on the node. Both are shipped, so both are read.
 * @param node - One entry from a manifest's event array
 * @returns The commands it registers
 */
function commandsOf(node: unknown): readonly string[] {
  if (typeof node !== "object" || node === null) return [];
  const entry = node as { command?: unknown; hooks?: unknown };
  if (typeof entry.command === "string") return [entry.command];
  if (!Array.isArray(entry.hooks)) return [];
  return entry.hooks.flatMap(hook =>
    typeof (hook as { command?: unknown })?.command === "string"
      ? [(hook as { command: string }).command]
      : []
  );
}

/**
 * The scripts one manifest event-array registers.
 * @param nodes - The manifest's array for one event
 * @returns Script basenames Lisa recognises as edit-boundary checks
 */
function scriptsIn(nodes: unknown): readonly string[] {
  if (!Array.isArray(nodes)) return [];
  return nodes
    .flatMap(node => commandsOf(node))
    .map(command => command.split("/").pop() ?? "")
    .filter(script => Object.hasOwn(PROVES, script));
}

/**
 * Every edit-boundary registration in one manifest.
 * @param manifest - Repo-relative manifest path
 * @returns One entry per script registered at a tool-boundary event
 */
function registrationsIn(manifest: string): readonly Registration[] {
  const parsed: unknown = JSON.parse(
    readFileSync(path.join(ROOT, manifest), "utf8")
  );
  const events = (parsed as { hooks?: unknown })?.hooks ?? parsed;
  if (typeof events !== "object" || events === null) return [];
  return Object.entries(events as Record<string, unknown>).flatMap(
    ([event, nodes]) => {
      const moment = EVENT_MOMENTS[event.toLowerCase()];
      return moment === undefined
        ? []
        : scriptsIn(nodes).map(script => ({ manifest, script, moment }));
    }
  );
}

/**
 * Every edit-boundary registration Lisa ships, derived from the manifests.
 * @returns One entry per script per manifest, sorted
 */
function shippedRegistrations(): readonly Registration[] {
  const manifests = execFileSync(GIT, ["ls-files", "-z", "*hooks.json"], {
    cwd: ROOT,
    encoding: "utf8",
    env: cleanGitEnv(),
  })
    .split("\0")
    .filter(entry => entry.length > 0);

  return manifests
    .flatMap(manifest => registrationsIn(manifest))
    .sort((a, b) =>
      `${a.manifest}${a.script}`.localeCompare(`${b.manifest}${b.script}`)
    );
}

const REGISTRATIONS = shippedRegistrations();

describe("the agent tool boundary is two declarable moments", () => {
  it("has both moments on the axis", () => {
    expect(MOMENTS).toContain("pre-tool");
    expect(MOMENTS).toContain("post-tool");
  });

  it("finds the shipped registrations at all", () => {
    // A derivation that silently resolves to nothing turns every assertion
    // below into a check over the empty set — the exact shape of failure the
    // derived roster replaces.
    expect(REGISTRATIONS.length).toBeGreaterThan(0);
  });

  it("maps every registered script to a property", () => {
    const unmapped = [
      ...new Set(
        REGISTRATIONS.filter(r => !Object.hasOwn(PROVES, r.script)).map(
          r => r.script
        )
      ),
    ];
    expect(unmapped).toEqual([]);
  });

  it("names only gates the registry defines", () => {
    const unknown = Object.values(PROVES)
      .flat()
      .filter(gate => !Object.hasOwn(REGISTRY, gate));
    expect(unknown).toEqual([]);
  });
});

describe("each script's gate is declarable where the script fires", () => {
  it("permits every (script, moment) pair the manifests register", () => {
    const illegal = REGISTRATIONS.flatMap(registration =>
      (PROVES[registration.script] ?? [])
        .filter(gate => !REGISTRY[gate].moments.includes(registration.moment))
        .map(
          gate =>
            `${registration.script} runs at ${registration.moment} but ` +
            `${gate} is not declarable there (${registration.manifest})`
        )
    );
    expect(illegal).toEqual([]);
  });

  it("validates a real declaration at each registered moment", () => {
    const refused = REGISTRATIONS.flatMap(registration =>
      (PROVES[registration.script] ?? []).flatMap(gate => {
        const problems = validateGates({
          [gate]: { [registration.moment]: "required" },
        });
        return problems.length === 0
          ? []
          : [`${gate} at ${registration.moment}: ${problems.join("; ")}`];
      })
    );
    expect(refused).toEqual([]);
  });

  it("keeps the two events distinct rather than collapsing them", () => {
    // Five of the seven scripts are post-write. If a future change reads the
    // whole boundary as one moment, this is what notices.
    const moments = new Set(REGISTRATIONS.map(r => r.moment));
    expect([...moments].sort((a, b) => a.localeCompare(b))).toEqual([
      "post-tool",
      "pre-tool",
    ]);
  });
});
