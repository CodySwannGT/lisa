/**
 * A refusal only counts when this check caused it
 * (CodySwannGT/lisa#4996).
 *
 * A commit hook refuses for many reasons: Node is not there, the carrier
 * cannot find the gate runner, some other check failed. None of those says
 * the check under proof works. So a half is judged only when git's exit
 * status, what git actually did, and the gate runner's own report line for
 * this check all agree; every other case is reported as a check that could
 * not be started, and never as a rejection.
 * @module tests/unit/controls/proof-copy-attribution
 */
import { rmSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installCarriers } from "../../../src/controls/carriers.js";
import { runnerVerdictOf } from "../../../src/controls/proof-copy-workspace.js";
import type { ProofEntryResult } from "../../../src/controls/proof-types.js";
import { withoutNode } from "../../support/carrier-install.js";
import {
  buildProofFixture,
  checks,
  declaredPart,
  F_NONE_SOURCE,
  proofFiles,
  proofPatches,
  provedGates,
  REJECTS_EVERYTHING,
} from "../../helpers/control-proofs.js";
import {
  gitIn,
  hookEnvironment,
  proveInCopy,
  removeScratch,
} from "./support/proof-copy-run.js";
import { keep, removeFixtures } from "./support/report-check-run.js";

const PATCHES = proofPatches("F-none", F_NONE_SOURCE);
const WORKING = provedGates([{ command: checks(F_NONE_SOURCE) }]);
const NOT_STARTED = { outcome: "unknown", reason: "not-started" };

/** What the gate runner calls the check under proof. */
const STYLE = "code-style in .";

const cleanups: (() => void)[] = [];

/**
 * Find one entry's result.
 * @param entries - Every result of a run
 * @param id - The entry's id
 * @returns The result
 */
function entryOf(
  entries: readonly ProofEntryResult[],
  id: string
): ProofEntryResult {
  const found = entries.find(entry => entry.entry_id === id);
  if (found === undefined) throw new Error(`no result for ${id}`);
  return found;
}

beforeEach(() => {
  hookEnvironment();
});

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => {
    cleanup();
  });
  removeScratch();
  removeFixtures();
});

describe("a refusal that is not the check's own", () => {
  it("is not a rejection when the carrier cannot find the gate runner", async () => {
    const { repoPath } = keep(buildProofFixture(WORKING));

    const { run } = await proveInCopy(repoPath, {
      install: async (root, options, dependencies) => {
        const installed = await installCarriers(root, options, dependencies);
        rmSync(path.join(root, "scripts", "lisa-run-gates.mjs"));
        return installed;
      },
    });

    const [entry] = run.entries;
    const [violation] = entry?.halves ?? [];
    expect(entry).toMatchObject(NOT_STARTED);
    expect(violation).toMatchObject({ ...NOT_STARTED, exit_status: 1 });
    expect(violation?.output_excerpt).toContain(
      "scripts/lisa-run-gates.mjs is missing"
    );
    expect(violation?.detail).toContain(
      "git refused the commit, but the gate runner's report does not show code-style in . failing"
    );
  });

  it("is not a rejection when Node is missing where the hook runs", async () => {
    const { repoPath } = keep(buildProofFixture(WORKING));
    const without = withoutNode({ PATH: process.env.PATH });
    cleanups.push(without.cleanup);
    vi.stubEnv("PATH", without.env.PATH ?? "");

    const { run } = await proveInCopy(repoPath);

    const [violation, clean] = run.entries[0]?.halves ?? [];
    expect(run.entries[0]).toMatchObject(NOT_STARTED);
    expect(violation).toMatchObject({ ...NOT_STARTED, exit_status: 1 });
    expect(violation?.output_excerpt).toContain("Node.js is missing");
    expect(clean).toMatchObject({ ...NOT_STARTED, exit_status: 1 });
  });

  it("is not a rejection when another check at the same moment refuses the commit", async () => {
    const gates = {
      ...WORKING,
      ...provedGates(
        [{ command: REJECTS_EVERYTHING, name: "tests" }],
        "conflict-residue",
        ["commit"]
      ),
    };
    const { repoPath } = keep(
      buildProofFixture(gates, {
        ...proofFiles(PATCHES),
        ...proofFiles(PATCHES, "tests"),
      })
    );

    const { run } = await proveInCopy(repoPath);

    const style = entryOf(run.entries, "code-style@.");
    const clean = style.halves[1];
    // The other check prints the very text this entry declares, and git
    // refuses the clean commit. Only the gate runner's own line for this
    // check tells that refusal from a rejection by this check.
    expect(clean).toMatchObject({ ...NOT_STARTED, exit_status: 1 });
    expect(clean?.output_excerpt).toContain("Found 1 error");
    expect(clean?.detail).toContain(
      "does not show code-style in . failing, so the refusal came from something else in the hook"
    );
    expect(style.outcome).toBe("unknown");
    expect(entryOf(run.entries, "conflict-residue@.").outcome).toBe("failed");
  });
});

describe("a moment that cannot be proved through a hook", () => {
  it("is not run when git runs no carrier in the copy, and the check's command is not started instead", async () => {
    const { repoPath } = keep(
      buildProofFixture(WORKING, {
        ...proofFiles(PATCHES),
        ".husky/_/h": 'sh -e "$1"\n',
        ".husky/pre-commit": "true\n",
      })
    );

    const { run, copy } = await proveInCopy(repoPath);

    const [entry] = run.entries;
    expect(copy.unwired.commit).toContain("Husky is not switched on");
    expect(entry).toMatchObject(NOT_STARTED);
    expect(entry?.halves.map(half => half.exit_status)).toEqual([null, null]);
    expect(entry?.halves[0]?.command).toEqual([
      "git",
      "commit",
      "--quiet",
      "-m",
      "chore: control proof for code-style@.",
    ]);
    expect(entry?.halves[0]?.detail).toContain(
      "git runs no pre-commit hook in the disposable copy, so there was nothing to prove this check through, and its command was not run on its own instead"
    );
    expect(gitIn(copy.clone, "rev-parse", "HEAD")).toBe(copy.base);
  });

  it("is not run for a check declared optional there, which never refuses", async () => {
    const { repoPath } = keep(
      buildProofFixture({
        "code-style": {
          commit: "optional",
          criteria: ["SI7"],
          parts: [declaredPart({ command: checks(F_NONE_SOURCE) })],
        },
      })
    );

    const { run } = await proveInCopy(repoPath);

    expect(run.entries[0]).toMatchObject(NOT_STARTED);
    expect(run.entries[0]?.halves[0]?.detail).toContain(
      "this check is declared optional at commit"
    );
  });
});

describe("the gate runner's line for one check", () => {
  const line = (verdict: string, name: string): string =>
    [
      `  ${verdict.padEnd(11)}required `,
      `${name} `.padEnd(29),
      '["ruff","check"] (exit 1)',
    ].join("");

  it("is read by the check's exact name", () => {
    const report = [
      "🚦 Gates at commit:",
      line("PASSED", "code-style in api"),
      line("FAILED", "code-style in api v2"),
      "❌ required gate FAILED: code-style in api v2 — [",
    ].join("\n");

    expect(runnerVerdictOf(report, "code-style in api")).toBe("PASSED");
    expect(runnerVerdictOf(report, "code-style in api v2")).toBe("FAILED");
    expect(runnerVerdictOf(report, "code-style in web")).toBeNull();
  });

  it("is not read when the report has two answers, or none", () => {
    const twice = [line("PASSED", STYLE), line("FAILED", STYLE)].join("\n");

    expect(runnerVerdictOf(twice, STYLE)).toBeNull();
    expect(runnerVerdictOf(null, STYLE)).toBeNull();
    expect(
      runnerVerdictOf(`  UNPROVABLE required ${STYLE} nothing ran`, STYLE)
    ).toBeNull();
  });
});
