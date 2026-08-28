/** Complete process-table closure checks for gated lisa-test-run fixtures. */
import * as fs from "node:fs";
import * as path from "node:path";

import { processBirthFingerprintSnapshot } from "../../src/configs/vitest/scratch-owner.js";
import type { ExactProcessIdentity } from "./lisa-test-run-exact-process-state.js";
import { REPO_ROOT } from "./lisa-test-run-process.js";

/** One parsed row from the bounded process-table snapshot. */
export interface ProcessSnapshotRow {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  readonly sid: number;
  readonly lstart: string;
  readonly command: string;
}

/**
 * Parse every nonempty fixed-column process row without dropping uncertainty.
 * @param stdout - Complete bounded ps output
 * @returns Validated process-table rows
 */
export function parseCompleteProcessSnapshot(
  stdout: string
): readonly ProcessSnapshotRow[] {
  return stdout
    .split("\n")
    .filter(line => line.trim().length > 0)
    .map(line => {
      const fields = line.trim().split(/\s+/u);
      if (fields.length < 10) {
        throw new Error("Process snapshot contains a malformed row");
      }
      const values = fields.slice(0, 4).map(Number);
      if (
        values.some(value => !Number.isSafeInteger(value)) ||
        (values[0] ?? 0) <= 0 ||
        (values[1] ?? -1) < 0 ||
        (values[2] ?? 0) <= 0 ||
        (values[3] ?? -1) < 0
      ) {
        throw new Error("Process snapshot contains a malformed row");
      }
      return {
        pid: values[0] as number,
        ppid: values[1] as number,
        pgid: values[2] as number,
        sid: values[3] as number,
        lstart: fields.slice(4, 9).join(" "),
        command: fields.slice(9).join(" "),
      };
    });
}

/**
 * Require exactly one process row matching a structural predicate.
 * @param rows - One bounded process-table snapshot
 * @param label - Structural role named in a refusal
 * @param predicate - Invocation-ownership predicate
 * @returns The sole matching row
 */
export function uniqueProcessSnapshotRow(
  rows: readonly ProcessSnapshotRow[],
  label: string,
  predicate: (row: ProcessSnapshotRow) => boolean
): ProcessSnapshotRow {
  const matches = rows.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(
      `Process snapshot has ambiguous ${label}: ${String(matches.length)} matches`
    );
  }
  return matches[0] as ProcessSnapshotRow;
}

/**
 * Derive every descendant of one PID from the already bounded snapshot.
 * @param rows - Complete rows from the single process-table snapshot
 * @param ancestorPid - Birth-bound invocation wrapper PID
 * @param known - Descendants accumulated by prior immutable passes
 * @returns Every direct and transitive descendant PID
 */
function descendantPidList(
  rows: readonly ProcessSnapshotRow[],
  ancestorPid: number,
  known: readonly number[] = []
): readonly number[] {
  const additions = rows
    .filter(
      row =>
        !known.includes(row.pid) &&
        (row.ppid === ancestorPid || known.includes(row.ppid))
    )
    .map(row => row.pid);
  return additions.length === 0
    ? known
    : descendantPidList(rows, ancestorPid, [...known, ...additions]);
}

/**
 * Derive every descendant of one PID from the already bounded snapshot.
 * @param rows - Complete rows from the single process-table snapshot
 * @param ancestorPid - Birth-bound invocation wrapper PID
 * @returns Every direct and transitive descendant PID
 */
function descendantPids(
  rows: readonly ProcessSnapshotRow[],
  ancestorPid: number
): ReadonlySet<number> {
  return new Set(descendantPidList(rows, ancestorPid));
}

/**
 * Resolve the exact installed esbuild service command used by the tsx loader.
 * @returns Complete binary and service arguments expected in the process table
 */
function expectedEsbuildServiceCommand(): string {
  const packageRoot = path.join(REPO_ROOT, "node_modules", "esbuild");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")
  ) as { readonly version?: unknown };
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error("Installed esbuild version is unavailable");
  }
  const binary = path.join(
    REPO_ROOT,
    "node_modules",
    "@esbuild",
    `${process.platform}-${process.arch}`,
    "bin",
    "esbuild"
  );
  return `${binary} --service=${manifest.version} --ping`;
}

/**
 * Bind every still-live tsx loader helper to its exact source-mode owner.
 * @param rows - Complete rows from the single process-table snapshot
 * @param owners - Named Node processes that may still own one loader service
 * @returns Exact loader-service rows in role order
 */
function loaderHelperRows(
  rows: readonly ProcessSnapshotRow[],
  owners: readonly (readonly [string, ProcessSnapshotRow])[]
): readonly ProcessSnapshotRow[] {
  const expectedCommand = expectedEsbuildServiceCommand();
  return owners.flatMap(([label, owner]) => {
    const matches = rows.filter(
      row =>
        row.ppid === owner.pid &&
        row.pgid === owner.pgid &&
        row.sid === owner.sid &&
        row.command === expectedCommand
    );
    if (matches.length > 1) {
      throw new Error(
        `Process snapshot has ambiguous ${label} esbuild helper: ` +
          `${String(matches.length)} matches`
      );
    }
    return matches;
  });
}

/**
 * Require the named roles to be the complete invocation-owned process closure.
 * @param rows - Complete parsed process-table snapshot
 * @param wrapper - Original birth-bound wrapper row
 * @param reaper - Detached reaper row
 * @param bootstrap - Detached bootstrap row
 * @param payload - Marker-bound payload row
 * @returns Exact loader helpers after complete set equality is established
 */
export function requireExactInvocationClosure(
  rows: readonly ProcessSnapshotRow[],
  wrapper: ProcessSnapshotRow,
  reaper: ProcessSnapshotRow,
  bootstrap: ProcessSnapshotRow,
  payload: ProcessSnapshotRow
): readonly ProcessSnapshotRow[] {
  const helpers = loaderHelperRows(rows, [
    ["wrapper", wrapper],
    ["reaper", reaper],
    ["bootstrap", bootstrap],
    ["payload", payload],
  ]);
  const descendants = descendantPids(rows, wrapper.pid);
  const detachedAuthorities = new Set([reaper.pid, bootstrap.pid]);
  const observed = rows
    .filter(
      row =>
        row.pid === wrapper.pid ||
        descendants.has(row.pid) ||
        detachedAuthorities.has(row.pgid) ||
        detachedAuthorities.has(row.sid)
    )
    .map(row => row.pid)
    .toSorted((left, right) => left - right);
  const expected = [
    wrapper.pid,
    reaper.pid,
    bootstrap.pid,
    payload.pid,
    ...helpers.map(row => row.pid),
  ].toSorted((left, right) => left - right);
  if (
    observed.length !== expected.length ||
    observed.some((pid, index) => pid !== expected[index])
  ) {
    const expectedPids = new Set(expected);
    const extra = rows
      .filter(row => observed.includes(row.pid) && !expectedPids.has(row.pid))
      .map(
        row => `${row.pid}:${row.ppid}:${row.pgid}:${row.sid}:${row.command}`
      );
    throw new Error(
      `Process snapshot contains unexpected invocation-owned members: ${extra.join(" | ")}`
    );
  }
  return helpers;
}

/**
 * Bind all named roles to one batched platform birth observation.
 * @param rows - Named rows from the same bounded process-table snapshot
 * @returns Exact identities keyed by PID
 */
export function identitiesFromProcessSnapshot(
  rows: readonly ProcessSnapshotRow[]
): ReadonlyMap<number, ExactProcessIdentity> {
  const births =
    process.platform === "darwin"
      ? new Map(rows.map(row => [row.pid, `darwin:${row.lstart}`]))
      : processBirthFingerprintSnapshot(rows.map(row => row.pid));
  return new Map(
    rows.map(row => {
      const birth = births.get(row.pid);
      if (birth === undefined) {
        throw new Error(
          `Process birth authority unavailable for PID ${String(row.pid)}`
        );
      }
      return [row.pid, { pid: row.pid, birth }];
    })
  );
}
