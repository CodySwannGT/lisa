/**
 * Doctor check: will `lisa apply` refuse over an override that would resolve a
 * Lisa security floor DOWNWARDS?
 *
 * `lisa apply` normalizes a forced literal override into npm's `"$name"`
 * self-reference when the same package is a direct dependency, and refuses when
 * the host's direct range starts below the floor it is replacing — because the
 * rewrite would readmit exactly the versions the floor exists to exclude. That
 * refusal is correct and this check does not soften it. What it adds is advance
 * notice: the condition is decidable from `package.json` and Lisa's templates
 * alone, with no network and no install, so an operator can be told "raise vite
 * to ^8.0.16" instead of meeting an unexplained refusal from inside a
 * `postinstall` that has already committed to updating.
 *
 * Why doctor rather than a push gate or a host-side script: the floors live in
 * the INSTALLED Lisa package, not the host repo. A shipped `.mjs` gate running
 * in a host's CI can compare an override against its own dependency line — that
 * is `lisa-floor-collisions.mjs`, which by construction skips `$name` entries
 * and has no notion of a Lisa floor. Answering this question needs both sides,
 * and the only surface that holds both is the Lisa CLI running in the host
 * checkout.
 *
 * `fail`, not `warn`: a project in this state is not degraded, it is frozen —
 * every apply refuses, so no template, guardrail, or security pin reaches it
 * until the raise is made.
 * @module cli/doctor-override-floor-conflicts
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describeSelfReferenceRemedy } from "../core/override-floors.js";
import type { SelfReferenceFloorConflict } from "../core/override-floors.js";
import {
  PackageLisaStrategy,
  type OverrideFloorAuditReport,
  type OverrideFloorPathAudit,
} from "../strategies/package-lisa.js";

const CHECK_NAME = "Override self-references safe?";
const PACKAGE_JSON = "package.json";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** One doctor check result, structurally identical to `DoctorCheck`. */
interface FloorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

/** One conflict, plus the apply paths that would refuse over it. */
interface ConflictRow {
  /** The conflict, as the guard would judge it. */
  readonly conflict: SelfReferenceFloorConflict;
  /** Apply paths that refuse over this conflict. */
  readonly paths: readonly string[];
}

/**
 * Resolve the installed Lisa package root, mirroring how apply resolves it.
 * @returns Absolute path to the Lisa package root
 */
function defaultLisaRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

/**
 * Read and parse the host manifest, keeping "absent" and "unparseable" apart.
 * @param targetPath - Project path to inspect
 * @returns The parsed manifest, or which of the two failure modes occurred
 */
async function readManifest(
  targetPath: string
): Promise<
  | { readonly kind: "parsed" }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly reason: string }
> {
  const manifestPath = path.join(targetPath, PACKAGE_JSON);
  const raw = await readFile(manifestPath, "utf8").catch(() => null);
  if (raw === null) {
    return { kind: "absent" };
  }
  try {
    JSON.parse(raw);
    return { kind: "parsed" };
  } catch (error) {
    return {
      kind: "unreadable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Fold the per-path audits into one conflict list, deduplicated by section and
 * package name and labelled with the paths that refuse.
 * @param report - The audit report for one project
 * @returns Conflicts, each with the apply paths that would refuse over it
 */
function foldConflicts(
  report: OverrideFloorAuditReport
): readonly ConflictRow[] {
  const rows = report.paths.flatMap(entry =>
    (entry.audit?.conflicts ?? []).map(conflict => ({
      conflict,
      applyPath: entry.applyPath as string,
    }))
  );
  const keys = [
    ...new Set(rows.map(row => `${row.conflict.section}.${row.conflict.name}`)),
  ];
  return keys.flatMap(key => {
    const matching = rows.filter(
      row => `${row.conflict.section}.${row.conflict.name}` === key
    );
    const first = matching[0];
    return first === undefined
      ? []
      : [
          {
            conflict: first.conflict,
            paths: [...new Set(matching.map(row => row.applyPath))],
          },
        ];
  });
}

/**
 * Describe what an audit pass actually looked at, so an empty finding can never
 * be read as a clean bill of health without its denominator.
 * @param report - The audit report for one project
 * @returns Operator-readable counts
 */
function describeScope(report: OverrideFloorAuditReport): string {
  const inspected = report.paths.map(entry => {
    if (entry.audit === null) {
      return `${entry.applyPath}: not simulated`;
    }
    const counts = `${entry.audit.overridesInspected} overrides, ${entry.audit.rewritesJudged} judged`;
    return `${entry.applyPath}: ${counts}`;
  });
  return `${report.lisaFloors} Lisa floors; ${inspected.join("; ")}`;
}

/**
 * Render one conflict as a single operator-readable line.
 * @param row - Conflict plus the apply paths that refuse over it
 * @returns One line naming the package, both ranges, and the verified raise
 */
function describeConflict(row: ConflictRow): string {
  const where = `refuses on ${row.paths.join(" and ")}`;
  const ranges = `direct ${row.conflict.directRange} vs Lisa floor ${row.conflict.floorRange}`;
  const remedy = describeSelfReferenceRemedy(row.conflict);
  return `${row.conflict.section}.${row.conflict.name} (${ranges}; ${where}) — ${remedy}`;
}

/**
 * Decide the check result when every apply path failed to simulate.
 * @param paths - The per-path audits
 * @returns The failing check, or null when at least one path produced an audit
 */
function reportUnsimulatable(
  paths: readonly OverrideFloorPathAudit[]
): FloorCheck | null {
  if (paths.some(entry => entry.audit !== null)) {
    return null;
  }
  const reasons = paths.map(
    entry => `${entry.applyPath}: ${entry.error ?? "no result"}`
  );
  return {
    name: CHECK_NAME,
    status: "fail",
    detail: `Could not verify — no apply path could be simulated. ${reasons.join("; ")}`,
  };
}

/**
 * Check whether a `$name` override would resolve below a Lisa security floor.
 * @param targetPath - Project path to inspect
 * @param lisaRoot - Installed Lisa package root, injectable for tests
 * @returns Doctor check result
 */
export async function checkOverrideFloorConflicts(
  targetPath: string,
  lisaRoot: string = defaultLisaRoot()
): Promise<FloorCheck> {
  const manifest = await readManifest(targetPath);
  if (manifest.kind === "unreadable") {
    return {
      name: CHECK_NAME,
      status: "fail",
      detail: `Could not verify — ${PACKAGE_JSON} is not parseable JSON: ${manifest.reason}`,
    };
  }

  const report = await new PackageLisaStrategy()
    .auditOverrideFloors(targetPath, lisaRoot)
    .catch((error: unknown) => error);
  if (!isReport(report)) {
    return {
      name: CHECK_NAME,
      status: "fail",
      detail: `Could not verify — resolving Lisa's templates failed: ${
        report instanceof Error ? report.message : String(report)
      }`,
    };
  }

  if (report.lisaFloors === 0) {
    return describeNoFloors(report, manifest.kind === "absent");
  }
  if (manifest.kind === "absent") {
    return {
      name: CHECK_NAME,
      status: "warn",
      detail: `No ${PACKAGE_JSON} here, so no direct dependency can resolve below one of Lisa's ${report.lisaFloors} floors (0 manifests inspected)`,
    };
  }

  const unsimulatable = reportUnsimulatable(report.paths);
  if (unsimulatable !== null) {
    return unsimulatable;
  }

  const conflicts = foldConflicts(report);
  if (conflicts.length === 0) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: `No override resolves below a Lisa floor (${describeScope(report)})`,
    };
  }
  return {
    name: CHECK_NAME,
    status: "fail",
    detail: `${conflicts.length} override(s) would resolve below a Lisa security floor, so lisa apply refuses and this project receives no updates (${describeScope(report)}). ${conflicts.map(describeConflict).join(" ")}`,
  };
}

/**
 * Report a project for which Lisa resolved no floors at all.
 *
 * Split by whether any template applies. No detected type means Lisa ships
 * nothing to force here and the check is genuinely inapplicable. A detected
 * type whose templates yield zero floors means resolution produced nothing to
 * compare against — an inert check, which is a failure rather than a pass.
 * @param report - The audit report for one project
 * @param manifestAbsent - True when the project has no package.json
 * @returns Doctor check result
 */
function describeNoFloors(
  report: OverrideFloorAuditReport,
  manifestAbsent: boolean
): FloorCheck {
  if (report.detectedTypes.length === 0) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail:
        "Not applicable: no Lisa project type detected, so no package.lisa.json floors apply here (0 floors, 0 manifests inspected)",
    };
  }
  const missing = manifestAbsent ? ` and found no ${PACKAGE_JSON}` : "";
  return {
    name: CHECK_NAME,
    status: "fail",
    detail: `Could not verify — Lisa resolved 0 override floors for detected type(s) ${report.detectedTypes.join(", ")}${missing}. Nothing was compared, so this is not a pass.`,
  };
}

/**
 * Narrow a settled audit call to a report.
 * @param value - Either the report or the error the call rejected with
 * @returns True when the value is an audit report
 */
function isReport(value: unknown): value is OverrideFloorAuditReport {
  return (
    typeof value === "object" &&
    value !== null &&
    "lisaFloors" in value &&
    "paths" in value
  );
}
