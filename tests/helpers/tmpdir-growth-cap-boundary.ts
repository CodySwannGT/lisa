/**
 * Bounded direct-entry cap-boundary evidence for the temp-growth command.
 *
 * The refusal branch this proves is `scanDirectNames` exceeding its entry cap,
 * which exits 2 and leaves prior evidence untouched. That branch does not care
 * how large the cap is, so the production `MAX_TMPDIR_ENTRIES` is LOWERED
 * through the module's existing injection seam and the fixture is sized to the
 * lowered cap. Two consequences, both deliberate:
 *
 * - The corpus is `cap + 1` real entries instead of 200,001, so a suite run no
 *   longer writes six-figure entry counts into the shared platform temp root.
 * - The pair is a true boundary control: exactly-at-cap must SUCCEED and
 *   one-past-cap must REFUSE. The prior 1-versus-200,001 fixture varied the
 *   entry count and the cap together and so never touched the boundary itself.
 *
 * The production default stays pinned separately by the zero-I/O generator
 * case in the unit suite, which drives `collectBoundedEntryNames` to the real
 * 200,000 limit without touching a filesystem.
 */
import * as fs from "node:fs";

import { expect } from "vitest";

import {
  populatedTmpdirRoot,
  timedTmpdirMeasurement,
  TMPDIR_GROWTH_COMMAND_BUDGET_MS,
} from "./tmpdir-growth-command-harness.js";
import { type TmpdirGrowthOverCapTrace } from "./tmpdir-growth-performance-types.js";

/** Lowered direct-entry cap driven through the module's injection seam. */
export const BOUNDARY_ENTRY_CAP = 500;

/** Import the module in-child so the lowered cap reaches the real run. */
const INJECTED_CAP_RUNNER = `
import { pathToFileURL } from "node:url";
const [script, root, artifact, nowMs, maxEntries] = process.argv.slice(1);
process.env.TMPDIR = root;
process.env.TMP = root;
process.env.TEMP = root;
const { runTmpdirGrowth } = await import(pathToFileURL(script).href);
process.exitCode = runTmpdirGrowth(
  ["--root", root, "--artifact", artifact, "--now-ms", nowMs],
  { maxEntries: Number(maxEntries) }
);
`;

/**
 * Run one real measurement under a lowered direct-entry cap.
 * @param script - Public measurement module
 * @param root - Populated temp root to measure
 * @param artifact - Rolling artifact path
 * @param nowMs - Deterministic observation time
 * @returns Command transport and timing facts
 */
function cappedMeasurement(
  script: string,
  root: string,
  artifact: string,
  nowMs: number
) {
  return timedTmpdirMeasurement(script, root, artifact, nowMs, [
    "--input-type=module",
    "--eval",
    INJECTED_CAP_RUNNER,
    script,
    root,
    artifact,
    String(nowMs),
    String(BOUNDARY_ENTRY_CAP),
  ]);
}

/**
 * Prove exactly-at-cap succeeds and one-past-cap refuses without replacing it.
 * @param script - Public measurement module
 * @param register - Test cleanup registry
 * @returns Complete refusal and preservation evidence
 */
export function verifyTmpdirGrowthCapBoundary(
  script: string,
  register: (directory: string) => void
): TmpdirGrowthOverCapTrace {
  const atCap = populatedTmpdirRoot(
    BOUNDARY_ENTRY_CAP,
    0,
    "tmp-growth-at-cap-",
    register
  );
  const initial = cappedMeasurement(script, atCap.root, atCap.artifact, 1_000);
  if (initial.error !== undefined) throw initial.error;
  if (initial.status !== 0) expect(initial.status, initial.stderr).toBe(0);
  const validBytes = fs.readFileSync(atCap.artifact, "utf8");
  const overCap = populatedTmpdirRoot(
    BOUNDARY_ENTRY_CAP + 1,
    1,
    "tmp-growth-over-cap-",
    register
  );
  const result = cappedMeasurement(script, overCap.root, atCap.artifact, 2_000);
  const preserved = fs.readFileSync(atCap.artifact, "utf8") === validBytes;
  const trace: TmpdirGrowthOverCapTrace = {
    entryCount: BOUNDARY_ENTRY_CAP + 1,
    budgetMs: TMPDIR_GROWTH_COMMAND_BUDGET_MS,
    commandElapsedMs: result.elapsedMs,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    validArtifactBytesPreserved: preserved,
    timeoutBehavior: "not-established",
  };

  expect(result.error).toBeUndefined();
  expect(result.status).toBe(2);
  // The exit status alone does NOT discriminate: an uncapped scan of the
  // over-cap root runs on and exits 2 anyway on the later root-identity
  // comparison. Only the exact cap message separates "refused at the cap"
  // from "refused for some other reason", so assert on it, not on `/500/`.
  expect(`${result.stdout}${result.stderr}`).toMatch(
    new RegExp(
      `Temp scan exceeds bounded entry limit ${String(BOUNDARY_ENTRY_CAP)}`,
      "u"
    )
  );
  expect(preserved).toBe(true);
  return trace;
}
