/** One-shot process-tree authority for gated lisa-test-run fixtures. */
import { boundedSpawnSync } from "./io-latency-budget.js";
import {
  identitiesFromProcessSnapshot,
  parseCompleteProcessSnapshot,
  requireExactInvocationClosure,
  uniqueProcessSnapshotRow,
  type ProcessSnapshotRow,
} from "./lisa-test-run-invocation-closure.js";
import type { ExactProcessIdentity } from "./lisa-test-run-exact-process-state.js";

/** Marker values validated before any process authority is published. */
export interface ValidatedPayloadMarker {
  readonly pid: number;
  readonly root: string;
  readonly opaque: string;
  readonly birth: string;
}

/** Complete process authority derived from one bounded system snapshot. */
export interface ValidatedInvocationSnapshot {
  readonly wrapper: ExactProcessIdentity;
  readonly reaper: ExactProcessIdentity;
  readonly bootstrap: ExactProcessIdentity;
  readonly payload: ExactProcessIdentity;
  readonly companions: readonly ExactProcessIdentity[];
}

/** Named invocation roles from one complete bounded process snapshot. */
interface InvocationSnapshotRows {
  readonly wrapper: ProcessSnapshotRow;
  readonly reaper: ProcessSnapshotRow;
  readonly bootstrap: ProcessSnapshotRow;
  readonly payload: ProcessSnapshotRow;
}

/**
 * Parse and validate the payload's bounded JSON marker schema.
 * @param text - Complete marker bytes
 * @param expectedRoot - Exact observed run-root path
 * @param expectedOpaque - Invocation-unique opaque control
 * @param expectedBirth - Worker-owner birth bound to the marker PID
 * @returns Validated marker fields
 */
export function parseValidatedPayloadMarker(
  text: string,
  expectedRoot: string,
  expectedOpaque: string,
  expectedBirth: string
): ValidatedPayloadMarker {
  const value = JSON.parse(text) as Partial<
    Omit<ValidatedPayloadMarker, "birth">
  >;
  if (
    typeof value !== "object" ||
    value === null ||
    !Number.isSafeInteger(value.pid) ||
    (value.pid ?? 0) <= 0 ||
    value.root !== expectedRoot ||
    value.opaque !== expectedOpaque ||
    Object.keys(value).some(key => !["opaque", "pid", "root"].includes(key))
  ) {
    throw new Error(
      "Payload marker does not match the exact invocation schema"
    );
  }
  return { ...value, birth: expectedBirth } as ValidatedPayloadMarker;
}

/**
 * Locate and structurally validate every named invocation process row.
 * @param rows - Complete rows from one bounded process snapshot
 * @param wrapper - Original shell PID and birth captured before GO
 * @param marker - Fully validated payload marker
 * @returns Structurally validated wrapper, reaper, bootstrap, and payload rows
 */
function namedInvocationRows(
  rows: readonly ProcessSnapshotRow[],
  wrapper: ExactProcessIdentity,
  marker: ValidatedPayloadMarker
): InvocationSnapshotRows {
  const wrapperRow = uniqueProcessSnapshotRow(
    rows,
    "wrapper",
    row => row.pid === wrapper.pid
  );
  const reaperRow = uniqueProcessSnapshotRow(
    rows,
    "prearmed reaper",
    row =>
      row.ppid === wrapper.pid && row.command.includes("lisa-test-run-reaper")
  );
  const bootstrapRow = uniqueProcessSnapshotRow(
    rows,
    "bootstrap",
    row =>
      row.ppid === wrapper.pid &&
      row.command.includes("lisa-test-run-bootstrap")
  );
  if (
    reaperRow.pid !== reaperRow.pgid ||
    (reaperRow.sid !== 0 && reaperRow.pid !== reaperRow.sid) ||
    bootstrapRow.pid !== bootstrapRow.pgid ||
    (bootstrapRow.sid !== 0 && bootstrapRow.pid !== bootstrapRow.sid)
  ) {
    throw new Error(
      `Detached companion process authority is malformed: ` +
        `reaper=${reaperRow.pid}/${reaperRow.pgid}/${reaperRow.sid} ` +
        `bootstrap=${bootstrapRow.pid}/${bootstrapRow.pgid}/${bootstrapRow.sid}`
    );
  }
  const payloadRow = uniqueProcessSnapshotRow(
    rows,
    "payload",
    row => row.pid === marker.pid
  );
  if (
    payloadRow.ppid !== bootstrapRow.pid ||
    payloadRow.pgid !== bootstrapRow.pid ||
    payloadRow.sid !== bootstrapRow.sid
  ) {
    throw new Error("Payload marker PID is not owned by the armed bootstrap");
  }
  return {
    wrapper: wrapperRow,
    reaper: reaperRow,
    bootstrap: bootstrapRow,
    payload: payloadRow,
  };
}

/**
 * Bind named snapshot rows to exact births and the original root owner.
 * @param rows - Complete rows from one bounded process snapshot
 * @param named - Structurally validated invocation roles
 * @param wrapper - Original shell PID and birth captured before GO
 * @param owner - Root owner identity read from the validated owner record
 * @param expectedPayloadBirth - Marker-bound payload birth fingerprint
 * @returns Exact identities for every invocation role
 */
function exactInvocationIdentities(
  rows: readonly ProcessSnapshotRow[],
  named: InvocationSnapshotRows,
  wrapper: ExactProcessIdentity,
  owner: ExactProcessIdentity,
  expectedPayloadBirth: string
): ValidatedInvocationSnapshot {
  const helpers = requireExactInvocationClosure(
    rows,
    named.wrapper,
    named.reaper,
    named.bootstrap,
    named.payload
  );
  const identities = identitiesFromProcessSnapshot([
    named.wrapper,
    named.reaper,
    named.bootstrap,
    named.payload,
    ...helpers,
  ]);
  const observedWrapper = identities.get(
    named.wrapper.pid
  ) as ExactProcessIdentity;
  if (
    observedWrapper.birth !== wrapper.birth ||
    owner.pid !== wrapper.pid ||
    owner.birth !== wrapper.birth
  ) {
    throw new Error("Root owner is not the original birth-bound wrapper");
  }
  const reaper = identities.get(named.reaper.pid) as ExactProcessIdentity;
  const bootstrap = identities.get(named.bootstrap.pid) as ExactProcessIdentity;
  const payload = identities.get(named.payload.pid) as ExactProcessIdentity;
  if (payload.birth !== expectedPayloadBirth) {
    throw new Error("Payload marker birth does not match its worker owner");
  }
  const loaderHelpers = helpers.map(
    row => identities.get(row.pid) as ExactProcessIdentity
  );
  return {
    wrapper: observedWrapper,
    reaper,
    bootstrap,
    payload,
    companions: [reaper, bootstrap, ...loaderHelpers],
  };
}

/**
 * Bind marker PID, companions, and wrapper to one invocation-owned process tree.
 * @param wrapper - Original shell PID and birth captured before GO
 * @param owner - Root owner PID and birth read from the validated owner record
 * @param marker - Fully validated payload marker
 * @returns Exact identities from one bounded process-table snapshot
 */
export function validatedInvocationSnapshot(
  wrapper: ExactProcessIdentity,
  owner: ExactProcessIdentity,
  marker: ValidatedPayloadMarker
): ValidatedInvocationSnapshot {
  const result = boundedSpawnSync({
    label: "gated lisa-test-run invocation process snapshot",
    command: "/bin/ps",
    args: ["-axo", "pid=,ppid=,pgid=,sess=,lstart=,command="],
    baseMs: 2_000,
  });
  const rows = parseCompleteProcessSnapshot(result.stdout);
  const named = namedInvocationRows(rows, wrapper, marker);
  return exactInvocationIdentities(rows, named, wrapper, owner, marker.birth);
}
