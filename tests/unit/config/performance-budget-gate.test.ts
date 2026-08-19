/**
 * Pins the performance-budget gate's reach and its two defaults.
 *
 * The measurement was already running on every consumer before this — through
 * a standalone `lighthouse.yml` each repository wires by hand, outside the
 * registry. Outside the registry means no level, so no way to decline it, and
 * no required-context story: a check a project cannot say `off` to is a
 * fixture, not a gate.
 *
 * The two assertions that matter are about what the gate does NOT do:
 * widening its moments must not make it run at push by default, and it must
 * not have become a required context anywhere by being registered.
 * @module tests/unit/config/performance-budget-gate
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const RESOLVER = path.join(
  REPO_ROOT,
  "all/copy-overwrite/scripts/lisa-gates.mjs"
);
const GATE = "performance-budget";

/**
 * Reads the registry's own view of a moment, through the shipped resolver
 * rather than by re-parsing the source. Re-parsing would let this suite agree
 * with itself about a registry it no longer describes.
 * @param moment - The moment to resolve
 * @returns Gate entries the registry reports for that moment
 */
function gatesAt(moment: string): readonly { id: string }[] {
  const raw = execFileSync(
    process.execPath,
    [RESOLVER, "list", `--moment=${moment}`, "--json", "--include-off"],
    { cwd: REPO_ROOT, encoding: "utf-8" }
  );
  return JSON.parse(raw) as readonly { id: string }[];
}

describe("performance-budget gate reach", () => {
  it("is declarable at pull-request and at push", () => {
    // Behavioural, not textual. An earlier version of this test sliced the
    // registry source and asserted it contained "PUSH_ONWARD" — the slice ran
    // past the gate entry into its neighbours, so it matched another gate's
    // moments and passed with this gate reverted to DEPLOY_ONLY. It pinned
    // nothing. Ask the validator instead: it is the thing that decides.
    for (const moment of ["pull-request", "push"]) {
      const config = {
        gates: { runner: "bun run", [GATE]: { [moment]: "optional" } },
      };
      const dir = mkdtempSync(path.join(tmpdir(), "lisa-perf-"));
      writeFileSync(
        path.join(dir, ".lisa.config.json"),
        JSON.stringify(config, null, 2)
      );

      const result = spawnSync(process.execPath, [RESOLVER, "validate"], {
        cwd: dir,
        encoding: "utf-8",
      });

      expect(
        result.status,
        `declaring ${GATE} at "${moment}" must validate, but the resolver said:\n` +
          `${result.stdout}${result.stderr}`
      ).toBe(0);
    }
  });

  it("does NOT run at push unless a project declares it", () => {
    // The pre-push runner falls back to a BUILT-IN check for any gate a
    // project has not declared, so widening moments could have switched a
    // browser-driving suite on for every push. There is deliberately no
    // built-in for this gate, which is what keeps push opt-in.
    const runner = readFileSync(
      path.join(REPO_ROOT, "all/copy-overwrite/scripts/lisa-run-gates.mjs"),
      "utf-8"
    );

    expect(runner).not.toContain(GATE);
    expect(runner).not.toContain("perf:check");
  });

  it("is not a required context anywhere by default", () => {
    // Registering a gate must not, by itself, start blocking merges. Only a
    // level of `required` emits a context, and this repository declares no
    // level for it at all.
    const config = JSON.parse(
      readFileSync(path.join(REPO_ROOT, ".lisa.config.json"), "utf-8")
    ) as { readonly gates?: Record<string, unknown> };

    expect(config.gates ?? {}).not.toHaveProperty(GATE);

    const contexts = execFileSync(
      process.execPath,
      [RESOLVER, "contexts", "--moment=pull-request"],
      { cwd: REPO_ROOT, encoding: "utf-8" }
    );
    expect(contexts).not.toContain("Performance Budget");
  });

  it("resolves as a known gate at both moments", () => {
    // Guards the widening itself: a moment the registry does not know is
    // refused rather than resolving to nothing, so these calls succeeding is
    // what proves push and pull-request are legal for this gate.
    for (const moment of ["pull-request", "push"]) {
      expect(() => gatesAt(moment)).not.toThrow();
    }
  });
});
