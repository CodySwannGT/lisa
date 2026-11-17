/**
 * Says what changed between a recorded gate resolution and the one resolved
 * now, in words that name the gate and the moment.
 * @remarks
 * A plain equality assertion over a whole moment prints a diff, and a diff
 * shows the changed line with a few lines either side. The gate's id sits
 * further from its task than that, so the failure would show a task changing
 * and leave the reader to work out whose. Each sentence here carries the gate,
 * the moment and the configuration itself.
 * @module tests/unit/controls/paved-road-drift
 */

/** One entry of a gate resolution, as it is stored. */
export type ResolvedGate = Readonly<Record<string, unknown>> & {
  readonly id: string;
};

/** One recorded resolution and the one to hold against it. */
export interface DriftInput {
  /** The configuration the gates were resolved from. */
  readonly configuration: string;
  /** The moment they were resolved at. */
  readonly moment: string;
  /** What the snapshot holds, or undefined when it holds nothing. */
  readonly recorded: readonly ResolvedGate[] | undefined;
  /** What resolves now. */
  readonly received: readonly ResolvedGate[];
}

/**
 * A value as it reads in a sentence.
 * @param value - Any stored value, or undefined for a field that is missing
 * @returns Its JSON spelling, or `absent`
 */
const shown = (value: unknown): string =>
  value === undefined ? "absent" : JSON.stringify(value);

/**
 * The fields on which two entries for the same gate disagree.
 * @param recorded - The stored entry
 * @param received - The entry resolved now
 * @returns One clause per differing field, in the stored field order
 */
function fieldChanges(
  recorded: ResolvedGate,
  received: ResolvedGate
): string[] {
  const fields = [
    ...new Set([...Object.keys(recorded), ...Object.keys(received)]),
  ];
  return fields
    .filter(field => shown(recorded[field]) !== shown(received[field]))
    .map(
      field =>
        `${field} was ${shown(recorded[field])}, is now ${shown(received[field])}`
    );
}

/**
 * Every way one moment's resolution differs from its snapshot.
 * @param input - The recorded and received resolutions, and where they are from
 * @returns One sentence per difference; empty when nothing changed
 */
export function resolutionDrift(input: DriftInput): string[] {
  const { configuration, moment, recorded, received } = input;
  const where = `(configuration "${configuration}")`;
  if (recorded === undefined) {
    return [
      `No snapshot is stored for moment "${moment}" ${where}. Every ` +
        `configuration needs one snapshot per moment.`,
    ];
  }

  const recordedIds = recorded.map(gate => gate.id);
  const receivedIds = received.map(gate => gate.id);
  const gone = recorded
    .filter(gate => !receivedIds.includes(gate.id))
    .map(
      gate =>
        `Gate "${gate.id}" at moment "${moment}" no longer resolves at all ` +
        `${where}. It was recorded as ${shown(gate)}.`
    );
  const arrived = received
    .filter(gate => !recordedIds.includes(gate.id))
    .map(
      gate =>
        `Gate "${gate.id}" at moment "${moment}" resolves now and was never ` +
        `recorded ${where}. It resolves as ${shown(gate)}.`
    );
  const changed = recorded.flatMap(gate => {
    const now = received.find(candidate => candidate.id === gate.id);
    const changes = now === undefined ? [] : fieldChanges(gate, now);
    return changes.length === 0
      ? []
      : [
          `Gate "${gate.id}" at moment "${moment}" no longer resolves as ` +
            `recorded ${where}: ${changes.join("; ")}.`,
        ];
  });
  const sameGates = gone.length === 0 && arrived.length === 0;
  const reordered =
    sameGates && recordedIds.join("\n") !== receivedIds.join("\n")
      ? [
          `The gates at moment "${moment}" run in a different order ${where}: ` +
            `recorded ${recordedIds.join(", ")}; now ${receivedIds.join(", ")}.`,
        ]
      : [];

  return [...gone, ...arrived, ...changed, ...reordered];
}
